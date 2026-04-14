const express = require('express');
const db = require('../models/db');
const upload = require('../utils/upload');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');

// Ensure product_images table exists
const ensureProductImagesTable = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS product_images (
            id SERIAL PRIMARY KEY,
            product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
            image_url TEXT NOT NULL
        )
    `);
};

router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM products ORDER BY id ASC');
        await ensureProductImagesTable();
        const imgResult = await db.query('SELECT * FROM product_images');
        const imgMap = {};
        imgResult.rows.forEach(r => {
            if (!imgMap[r.product_id]) imgMap[r.product_id] = [];
            imgMap[r.product_id].push({ id: r.id, image_url: r.image_url });
        });
        const products = result.rows.map(p => ({
            ...p,
            extra_images: imgMap[p.id] || []
        }));
        res.json(products);
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ message: 'Server error fetching products' });
    }
});

router.get('/categories', async (req, res) => {
    try {
        const result = await db.query('SELECT name FROM categories ORDER BY name ASC');
        res.json(result.rows.map(r => r.name));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/categories', verifyToken, isAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ message: 'Category name is required' });
        const result = await db.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *', [name]);
        res.status(201).json(result.rows[0] || { name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rename a category across all products
router.put('/categories/:oldCategory', verifyToken, isAdmin, async (req, res) => {
    try {
        const { oldCategory } = req.params;
        const { newName } = req.body;
        if (!newName) return res.status(400).json({ message: 'New name is required' });

        await db.query('BEGIN');
        await db.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [newName]);
        await db.query('UPDATE products SET category = $1 WHERE category = $2', [newName, oldCategory]);
        await db.query('DELETE FROM categories WHERE name = $1', [oldCategory]);
        await db.query('COMMIT');
        
        res.json({ message: `Category renamed from ${oldCategory} to ${newName}` });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error('Error renaming category:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/categories/:category', verifyToken, isAdmin, async (req, res) => {
    try {
        const { category } = req.params;
        const productsCount = await db.query('SELECT COUNT(*) FROM products WHERE category = $1', [category]);
        if (parseInt(productsCount.rows[0].count) > 0) {
            return res.status(400).json({ message: 'Cannot delete category that has products' });
        }
        await db.query('DELETE FROM categories WHERE name = $1', [category]);
        res.json({ message: 'Category deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Product not found' });
        await ensureProductImagesTable();
        const imgResult = await db.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY id ASC', [req.params.id]);
        res.json({ ...result.rows[0], extra_images: imgResult.rows });
    } catch (err) {
        console.error('Error fetching product:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/', verifyToken, isAdmin, upload.single('image'), async (req, res) => {
    try {
        const { name, price_vc, description, category, brand, is_new_arrival, original_price, delivery_location, delivery_time } = req.body;
        const imageUrl = req.file ? req.file.location : '';
        if (!name || price_vc == null) {
            return res.status(400).json({ message: 'Name and price_vc are required' });
        }
        const result = await db.query(
            'INSERT INTO products (name, description, price_vc, original_price, delivery_location, delivery_time, image_url, category, brand, stock, is_new_arrival) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
            [name, description || '', price_vc, original_price || null, delivery_location || 'Alliance University', delivery_time || '7 Days', imageUrl, category || 'Uncategorized', brand || '', 100, is_new_arrival === 'true' || is_new_arrival === true]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding product:', err);
        res.status(500).json({ message: 'Server error adding product' });
    }
});

router.put('/:id', verifyToken, isAdmin, upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price_vc, description, category, brand, is_new_arrival, original_price, delivery_location, delivery_time } = req.body;
        const currentRes = await db.query('SELECT image_url FROM products WHERE id = $1', [id]);
        if (currentRes.rows.length === 0) return res.status(404).json({ message: 'Product not found' });
        let imageUrl = currentRes.rows[0].image_url;
        if (req.file) {
            imageUrl = req.file.location;
        } else if (req.body.image_url) {
            imageUrl = req.body.image_url;
        }
        if (!name || price_vc == null) {
            return res.status(400).json({ message: 'Name and price_vc are required' });
        }
        const result = await db.query(
            'UPDATE products SET name = $1, description = $2, price_vc = $3, original_price = $4, delivery_location = $5, delivery_time = $6, image_url = $7, category = $8, brand = $9, is_new_arrival = $10 WHERE id = $11 RETURNING *',
            [name, description || '', price_vc, original_price || null, delivery_location || 'Alliance University', delivery_time || '7 Days', imageUrl || '', category || 'Uncategorized', brand || '', is_new_arrival === 'true' || is_new_arrival === true, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).json({ message: 'Server error updating product' });
    }
});

// Add extra images to a product (multiple)
router.post('/:id/images', verifyToken, isAdmin, upload.array('images', 10), async (req, res) => {
    try {
        await ensureProductImagesTable();
        const productId = req.params.id;
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'No images uploaded' });
        const inserted = [];
        for (const file of req.files) {
            const r = await db.query(
                'INSERT INTO product_images (product_id, image_url) VALUES ($1, $2) RETURNING *',
                [productId, file.location]
            );
            inserted.push(r.rows[0]);
        }
        res.json(inserted);
    } catch (err) {
        console.error('Error adding product images:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete a single extra image by its row id
router.delete('/images/:imgId', verifyToken, isAdmin, async (req, res) => {
    try {
        await ensureProductImagesTable();
        await db.query('DELETE FROM product_images WHERE id = $1', [req.params.imgId]);
        res.json({ message: 'Image deleted' });
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Delete dependent order items to satisfy foreign key constraints
        await client.query('DELETE FROM order_items WHERE product_id = $1', [req.params.id]);
        
        // 2. Delete any extra product images
        await client.query('DELETE FROM product_images WHERE product_id = $1', [req.params.id]);
        
        // 3. Delete the product itself
        await client.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        
        await client.query('COMMIT');
        res.json({ message: 'Product deleted successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error deleting product:', err);
        res.status(500).json({ message: 'Server error deleting product: ' + err.message });
    } finally {
        client.release();
    }
});

// ─── Clear All Products ───
router.delete('/clear-all/confirm', verifyToken, isAdmin, async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Delete all order items (foreign key to products)
        await client.query('DELETE FROM order_items');
        
        // 2. Delete all product images
        await client.query('DELETE FROM product_images');
        
        // 3. Delete all products
        const result = await client.query('DELETE FROM products');
        
        await client.query('COMMIT');
        
        console.log(`[Clear All] ✅ Deleted ${result.rowCount} products`);
        res.json({ message: `All ${result.rowCount} products deleted successfully`, count: result.rowCount });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error clearing all products:', err);
        res.status(500).json({ message: 'Server error clearing products: ' + err.message });
    } finally {
        client.release();
    }
});

module.exports = router;

