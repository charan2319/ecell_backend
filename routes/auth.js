const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../models/db');

const router = express.Router();

router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        if (!email.endsWith('@alliance.edu.in')) {
            return res.status(400).json({ message: 'Must use an @alliance.edu.in email' });
        }
        
        const existing = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const hashed = await bcrypt.hash(password, 10);
        const result = await db.query(
            'INSERT INTO users (name, email, password_hash, points) VALUES ($1, $2, $3, $4) RETURNING id, name, email, points, is_admin',
            [name, email, hashed, 0] // Vc's initially zero for all users
        );

        res.status(201).json({ user: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, is_admin: user.is_admin },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '1d' }
        );

        res.json({ token, user: { id: user.id, name: user.name, email: user.email, points: user.points, is_admin: user.is_admin } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/users', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, email, points, is_admin, created_at FROM users ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching users' });
    }
});

// Admin Point Adjustment
router.post('/adjust-points', async (req, res) => {
    const client = await db.pool.connect();
    try {
        const { user_id, amount, reason } = req.body; // amount can be positive or negative
        
        await client.query('BEGIN');
        
        // Update user balance
        const updateRes = await client.query(
            'UPDATE users SET points = points + $1 WHERE id = $2 RETURNING points',
            [amount, user_id]
        );
        
        if (updateRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'User not found' });
        }

        // Log history
        await client.query(
            'INSERT INTO points_history (user_id, amount, type, reason) VALUES ($1, $2, $3, $4)',
            [user_id, Math.abs(amount), amount >= 0 ? 'added' : 'deducted', reason || 'Admin Adjustment']
        );

        await client.query('COMMIT');
        res.json({ message: 'Points adjusted successfully', new_balance: updateRes.rows[0].points });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Adjustment Error:', err);
        res.status(500).json({ message: 'Failed to adjust points' });
    } finally {
        client.release();
    }
});

// Get User History
router.get('/points-history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            'SELECT * FROM points_history WHERE user_id = $1 ORDER BY created_at DESC',
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to fetch points history' });
    }
});

module.exports = router;
