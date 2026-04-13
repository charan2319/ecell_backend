const jwt = require('jsonwebtoken');

/**
 * Middleware to verify the JWT token from the Authorization header
 */
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Expected "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        req.user = decoded; // Attach user payload {id, is_admin} to request
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid or expired token.' });
    }
};

/**
 * Middleware to check if the verified user has administrative privileges
 */
const isAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Authentication required.' });
    }
    
    if (req.user.is_admin !== true) {
        return res.status(403).json({ message: 'Access denied. Administrator privileges required.' });
    }
    
    next();
};

module.exports = { verifyToken, isAdmin };
