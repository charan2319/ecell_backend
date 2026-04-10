const express = require('express');
const db = require('../models/db');
const upload = require('../utils/upload');
const router = express.Router();

router.post('/brands', upload.single('image'), async (req, res) => {
    try {
        const imageUrl = req.file ? req.file.location : '';
        if (!imageUrl) return res.status(400).json({ message: 'Image is required' });
        
        await db.query('INSERT INTO trusted_brands (name, image_url) VALUES ($1, $2)', ['Brand', imageUrl]);
        res.json({ message: 'Brand added successfully', url: imageUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/brands', async (req, res) => {
    try {
        const data = await db.query('SELECT * FROM trusted_brands');
        res.json(data.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/events', upload.single('image'), async (req, res) => {
    try {
        const { title, subtitle } = req.body;
        const imageUrl = req.file ? req.file.location : '';
        await db.query('INSERT INTO upcoming_events (title, subtitle, image_url) VALUES ($1, $2, $3)', [title || '', subtitle || '', imageUrl]);
        res.json({ message: 'Event added successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/events', async (req, res) => {
    try {
        const data = await db.query('SELECT * FROM upcoming_events ORDER BY id DESC LIMIT 1');
        res.json(data.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/hero', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'Hero image is required' });
        await db.query('INSERT INTO hero_images (image_url) VALUES ($1)', [req.file.location]);
        res.json({ message: 'Hero replaced', url: req.file.location });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/hero', async (req, res) => {
    try {
        const data = await db.query('SELECT * FROM hero_images ORDER BY id DESC');
        res.json(data.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/hero/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM hero_images WHERE id = $1', [req.params.id]);
        res.json({ message: 'Hero deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/brands/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM trusted_brands WHERE id = $1', [req.params.id]);
        res.json({ message: 'Brand deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/events/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM upcoming_events WHERE id = $1', [req.params.id]);
        res.json({ message: 'Event deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- About Image ----
router.get('/about-image', async (req, res) => {
    try {
        await db.query(`CREATE TABLE IF NOT EXISTS about_image (id SERIAL PRIMARY KEY, image_url TEXT NOT NULL)`);
        const data = await db.query('SELECT * FROM about_image ORDER BY id DESC LIMIT 1');
        res.json(data.rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/about-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'Image is required' });
        await db.query(`CREATE TABLE IF NOT EXISTS about_image (id SERIAL PRIMARY KEY, image_url TEXT NOT NULL)`);
        // Replace any existing about image (only one allowed)
        await db.query('DELETE FROM about_image');
        await db.query('INSERT INTO about_image (image_url) VALUES ($1)', [req.file.location]);
        res.json({ message: 'About image updated', url: req.file.location });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/about-image', async (req, res) => {
    try {
        await db.query('DELETE FROM about_image');
        res.json({ message: 'About image removed' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
