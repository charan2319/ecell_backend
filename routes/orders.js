const express = require('express');
const db = require('../models/db');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');

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

        // 3. Insert Items (Handling both 'qty' and 'quantity' from frontend)
        for (let item of items) {
            const quantity = item.qty || item.quantity;
            await client.query(
                'INSERT INTO order_items (order_id, product_id, quantity, price_vc) VALUES ($1, $2, $3, $4)',
                [orderId, item.id, quantity, item.price_vc]
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

        const itemsRes = await db.query(`
            SELECT order_items.*, products.name, products.image_url
            FROM order_items
            JOIN products ON order_items.product_id = products.id
            WHERE order_id = $1
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
