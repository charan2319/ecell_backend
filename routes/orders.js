const express = require('express');
const db = require('../models/db');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');

// ─── Auto-migration: ensure order_items has snapshot columns ───
(async () => {
    try {
        // Add product_name column if missing
        await db.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name VARCHAR(255)`);
        // Add product_image column if missing
        await db.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_image TEXT`);
        
        // Change product_id foreign key to allow NULL (SET NULL on delete)
        // First drop the existing FK constraint if it exists, then re-add with ON DELETE SET NULL
        const fkCheck = await db.query(`
            SELECT constraint_name FROM information_schema.table_constraints 
            WHERE table_name = 'order_items' AND constraint_type = 'FOREIGN KEY'
            AND constraint_name LIKE '%product%'
        `);
        for (const row of fkCheck.rows) {
            await db.query(`ALTER TABLE order_items DROP CONSTRAINT IF EXISTS "${row.constraint_name}"`);
        }
        // Make product_id nullable
        await db.query(`ALTER TABLE order_items ALTER COLUMN product_id DROP NOT NULL`);
        // Re-add FK with ON DELETE SET NULL
        await db.query(`
            ALTER TABLE order_items 
            ADD CONSTRAINT order_items_product_id_fkey 
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
        `);
        
        // Backfill: populate snapshot columns for existing order items that have a valid product_id
        await db.query(`
            UPDATE order_items oi
            SET product_name = p.name, product_image = p.image_url
            FROM products p
            WHERE oi.product_id = p.id AND oi.product_name IS NULL
        `);
        
        console.log('[Orders] ✅ order_items migration complete (snapshot columns + ON DELETE SET NULL)');
    } catch (err) {
        console.error('[Orders] Migration warning:', err.message);
    }
})();

router.post('/', verifyToken, async (req, res) => {
    const client = await db.pool.connect();
    try {
        const { user_id, total_vc, items, delivery_location } = req.body;
        
        // Security: Ensure user can only place an order for themselves
        if (req.user.id !== user_id && !req.user.is_admin) {
            return res.status(403).json({ message: 'Unauthorized. You can only place orders for your own account.' });
        }

        const uid = user_id;
        
        await client.query('BEGIN');

        // 1. Check & Deduct Balance
        const userReq = await client.query('SELECT points FROM users WHERE id = $1 FOR UPDATE', [uid]);
        if (userReq.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'User not found' });
        }
        if (userReq.rows[0].points < total_vc) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Insufficient Vcs' });
        }
        await client.query('UPDATE users SET points = points - $1 WHERE id = $2', [total_vc, uid]);

        // 1b. Log history for points deducted
        await client.query(
            'INSERT INTO points_history (user_id, amount, type, reason) VALUES ($1, $2, $3, $4)',
            [uid, total_vc, 'deducted', `Purchase of ${items.length} items`]
        );

        // 2. Create Order
        const orderRes = await client.query(
            'INSERT INTO orders (user_id, total_vc, status, delivery_location) VALUES ($1, $2, $3, $4) RETURNING id',
            [uid, total_vc, 'Processing', delivery_location || 'Not Specified']
        );
        const orderId = orderRes.rows[0].id;

        // 3. Insert Items WITH product snapshot (name + image preserved forever)
        for (let item of items) {
            const quantity = item.qty || item.quantity;
            // Fetch current product details to snapshot
            const productSnap = await client.query(
                'SELECT name, image_url FROM products WHERE id = $1', [item.id]
            );
            const pName = productSnap.rows[0]?.name || item.name || 'Unknown Product';
            const pImage = productSnap.rows[0]?.image_url || item.image_url || '';

            await client.query(
                'INSERT INTO order_items (order_id, product_id, quantity, price_vc, product_name, product_image) VALUES ($1, $2, $3, $4, $5, $6)',
                [orderId, item.id, quantity, item.price_vc, pName, pImage]
            );
        }

        await client.query('COMMIT');
        res.json({ message: 'Order placed successfully', order_id: orderId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Order Error:', err);
        res.status(500).json({ error: 'Failed to process order' });
    } finally {
        client.release();
    }
});

router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const data = await db.query(`
            SELECT orders.id, orders.total_vc, orders.status, orders.delivery_location, orders.created_at, users.name as user_name, users.email
            FROM orders 
            JOIN users ON orders.user_id = users.id 
            ORDER BY orders.id DESC
        `);
        res.json(data.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// GET specific details for an order
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const detailsRes = await db.query(`
            SELECT orders.*, users.name as user_name, users.email
            FROM orders
            JOIN users ON orders.user_id = users.id
            WHERE orders.id = $1
        `, [id]);

        if (detailsRes.rows.length === 0) return res.status(404).json({ message: 'Order not found' });

        // LEFT JOIN so deleted products still show with snapshot data
        const itemsRes = await db.query(`
            SELECT 
                order_items.id,
                order_items.order_id,
                order_items.product_id,
                order_items.quantity,
                order_items.price_vc,
                COALESCE(products.name, order_items.product_name, 'Deleted Product') as name,
                COALESCE(products.image_url, order_items.product_image, '') as image_url
            FROM order_items
            LEFT JOIN products ON order_items.product_id = products.id
            WHERE order_items.order_id = $1
        `, [id]);

        res.json({ ...detailsRes.rows[0], items: itemsRes.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch details' });
    }
});

// GET user specific history list (Securely checks ID)
router.get('/user/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Security check
        if (req.user.id !== parseInt(id) && !req.user.is_admin) {
            return res.status(403).json({ message: 'Unauthorized access to history.' });
        }
        const data = await db.query(`
            SELECT id, total_vc, status, created_at 
            FROM orders 
            WHERE user_id = $1 
        `, [id]);
        res.json(data.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// UPDATE order status
router.patch('/:id/status', verifyToken, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const result = await db.query(
            'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
            [status, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Order not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update order status' });
    }
});

module.exports = router;
