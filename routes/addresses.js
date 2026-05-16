const express = require('express');
const db = require('../models/db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// ── Auto-migrate: create user_addresses table if it doesn't exist ──
(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_addresses (
                id        SERIAL PRIMARY KEY,
                user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name      VARCHAR(255) NOT NULL,
                phone     VARCHAR(50)  NOT NULL,
                house     VARCHAR(255) NOT NULL,
                area      VARCHAR(255) NOT NULL,
                city      VARCHAR(100) NOT NULL,
                state     VARCHAR(100) NOT NULL,
                pincode   VARCHAR(20)  NOT NULL,
                type      VARCHAR(50)  DEFAULT 'Home',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('[Addresses] ✅ user_addresses table ready');
    } catch (err) {
        console.error('[Addresses] Migration error:', err.message);
    }
})();

// ── GET all addresses for the logged-in user ──
router.get('/', verifyToken, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY created_at ASC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Fetch addresses error:', err);
        res.status(500).json({ message: 'Failed to fetch addresses' });
    }
});

// ── POST create a new address ──
router.post('/', verifyToken, async (req, res) => {
    try {
        const { name, phone, house, area, city, state, pincode, type } = req.body;
        if (!name || !phone || !house || !area || !city || !state || !pincode) {
            return res.status(400).json({ message: 'All address fields are required' });
        }
        const result = await db.query(
            `INSERT INTO user_addresses (user_id, name, phone, house, area, city, state, pincode, type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [req.user.id, name, phone, house, area, city, state, pincode, type || 'Home']
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Create address error:', err);
        res.status(500).json({ message: 'Failed to save address' });
    }
});

// ── PUT update an existing address (owner-only) ──
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, house, area, city, state, pincode, type } = req.body;

        // Ensure the address belongs to the requesting user
        const check = await db.query(
            'SELECT id FROM user_addresses WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (check.rows.length === 0) {
            return res.status(404).json({ message: 'Address not found' });
        }

        const result = await db.query(
            `UPDATE user_addresses
             SET name=$1, phone=$2, house=$3, area=$4, city=$5, state=$6, pincode=$7, type=$8
             WHERE id=$9 AND user_id=$10 RETURNING *`,
            [name, phone, house, area, city, state, pincode, type || 'Home', id, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Update address error:', err);
        res.status(500).json({ message: 'Failed to update address' });
    }
});

// ── DELETE an address (owner-only) ──
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            'DELETE FROM user_addresses WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Address not found' });
        }
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('Delete address error:', err);
        res.status(500).json({ message: 'Failed to delete address' });
    }
});

module.exports = router;
