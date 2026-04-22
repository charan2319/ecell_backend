const express = require('express');
const db = require('../models/db');
const upload = require('../utils/upload');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');

// Ensure products table has all necessary columns
const ensureProductsColumns = async () => {
    try {
        await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS original_price INTEGER');
        await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_location TEXT DEFAULT \'Alliance University\'');
        await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_time TEXT DEFAULT \'7 Days\'');
        await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT');
        await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS is_new_arrival BOOLEAN DEFAULT FALSE');
        await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS specifications JSONB');
    } catch (err) {
        console.error('Migration error (ensureProductsColumns):', err);
    }
};

// Ensure categories table exists and is populated from products
const ensureCategoriesTable = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS categories (
            name TEXT PRIMARY KEY
        )
    `);
    // Sync existing categories from products table
    await db.query(`
        INSERT INTO categories (name)
        SELECT DISTINCT category FROM products
        WHERE category IS NOT NULL AND category != ''
        ON CONFLICT (name) DO NOTHING
    `);
};

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
        await ensureProductsColumns();
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
        await ensureCategoriesTable();
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
        const { name, price_vc, description, category, brand, is_new_arrival, original_price, delivery_location, delivery_time, specifications } = req.body;
        let imageUrl = req.file ? req.file.location : '';
        
        // Support submitting a URL directly (from scrape-link feature)
        if (!imageUrl && req.body.image_url) {
            imageUrl = req.body.image_url;
        }

        if (!name || price_vc == null) {
            return res.status(400).json({ message: 'Name and price_vc are required' });
        }
        await ensureProductsColumns();
        await ensureCategoriesTable();
        const safeCat = category || 'Uncategorized';
        await db.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [safeCat]);

        const result = await db.query(
            'INSERT INTO products (name, description, price_vc, original_price, delivery_location, delivery_time, image_url, category, brand, stock, is_new_arrival, specifications) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *',
            [name, description || '', price_vc, original_price || null, delivery_location || 'Alliance University', delivery_time || '7 Days', imageUrl, safeCat, brand || '', 100, is_new_arrival === 'true' || is_new_arrival === true, specifications ? JSON.stringify(specifications) : null]
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
        const { name, price_vc, description, category, brand, is_new_arrival, original_price, delivery_location, delivery_time, specifications } = req.body;
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
        await ensureProductsColumns();
        await ensureCategoriesTable();
        const safeCat = category || 'Uncategorized';
        await db.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [safeCat]);

        const result = await db.query(
            'UPDATE products SET name = $1, description = $2, price_vc = $3, original_price = $4, delivery_location = $5, delivery_time = $6, image_url = $7, category = $8, brand = $9, is_new_arrival = $10, specifications = $11 WHERE id = $12 RETURNING *',
            [name, description || '', price_vc, original_price || null, delivery_location || 'Alliance University', delivery_time || '7 Days', imageUrl || '', safeCat, brand || '', is_new_arrival === 'true' || is_new_arrival === true, specifications ? JSON.stringify(specifications) : null, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).json({ message: 'Server error updating product' });
    }
});

// Add extra images to a product (multiple files OR by URL)
router.post('/:id/images', verifyToken, isAdmin, upload.array('images', 10), async (req, res) => {
    try {
        await ensureProductImagesTable();
        const productId = req.params.id;
        const inserted = [];

        // Support file uploads
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const r = await db.query(
                    'INSERT INTO product_images (product_id, image_url) VALUES ($1, $2) RETURNING *',
                    [productId, file.location]
                );
                inserted.push(r.rows[0]);
            }
        }

        // Support URL-based image insertion (for scrape-link feature)
        if (req.body.image_url) {
            const r = await db.query(
                'INSERT INTO product_images (product_id, image_url) VALUES ($1, $2) RETURNING *',
                [productId, req.body.image_url]
            );
            inserted.push(r.rows[0]);
        }

        if (inserted.length === 0) return res.status(400).json({ message: 'No images provided' });
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

// ─── Clear All Products ───
router.delete('/clear-all/confirm', verifyToken, isAdmin, async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Snapshot ALL product details into order_items before deletion
        await client.query(`
            UPDATE order_items oi
            SET product_name = p.name, product_image = p.image_url
            FROM products p
            WHERE oi.product_id = p.id AND oi.product_name IS NULL
        `);
        
        // 2. Delete all product images
        await client.query('DELETE FROM product_images');
        
        // 3. Delete all products (order_items.product_id will be SET NULL automatically)
        const result = await client.query('DELETE FROM products');
        
        await client.query('COMMIT');
        
        console.log(`[Clear All] ✅ Deleted ${result.rowCount} products (order history preserved)`);
        res.json({ message: `All ${result.rowCount} products deleted successfully`, count: result.rowCount });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error clearing all products:', err);
        res.status(500).json({ message: 'Server error clearing products: ' + err.message });
    } finally {
        client.release();
    }
});

router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Snapshot product details into order_items before deletion
        //    (for any order items that haven't been snapshotted yet)
        await client.query(`
            UPDATE order_items oi
            SET product_name = p.name, product_image = p.image_url
            FROM products p
            WHERE oi.product_id = p.id AND oi.product_id = $1
        `, [req.params.id]);
        
        // 2. Delete any extra product images
        await client.query('DELETE FROM product_images WHERE product_id = $1', [req.params.id]);
        
        // 3. Delete the product itself
        //    (order_items.product_id will be SET NULL automatically via FK constraint)
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

// ─── Promote Extra Image to Main Image ───
router.put('/:id/promote-image/:imageId', verifyToken, isAdmin, async (req, res) => {
    const client = await db.pool.connect();
    try {
        const { id, imageId } = req.params;
        
        await client.query('BEGIN');
        
        // 1. Get the current product main image
        const productRes = await client.query('SELECT image_url FROM products WHERE id = $1', [id]);
        if (productRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Product not found' });
        }
        const oldMainImage = productRes.rows[0].image_url;
        
        // 2. Get the extra image URL
        const imageRes = await client.query('SELECT image_url FROM product_images WHERE id = $1 AND product_id = $2', [imageId, id]);
        if (imageRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Extra image not found' });
        }
        const newMainImage = imageRes.rows[0].image_url;
        
        // 3. Swap them
        // Update product table with new main image
        await client.query('UPDATE products SET image_url = $1 WHERE id = $2', [newMainImage, id]);
        
        // Update product_images table to replace the extra image with the old main image
        // (if the old main image existed)
        if (oldMainImage && oldMainImage.trim() !== '') {
            await client.query('UPDATE product_images SET image_url = $1 WHERE id = $2', [oldMainImage, imageId]);
        } else {
            // if product had no main image previously, just delete the extra image row since it's promoted
            await client.query('DELETE FROM product_images WHERE id = $1', [imageId]);
        }
        
        await client.query('COMMIT');
        res.json({ message: 'Image promoted successfully', new_main_image: newMainImage });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error promoting image:', err);
        res.status(500).json({ message: 'Server error: ' + err.message });
    } finally {
        client.release();
    }
});

module.exports = router;


