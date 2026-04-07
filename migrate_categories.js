const db = require('./models/db');

async function migrate() {
    try {
        console.log('Starting migration...');
        // Create table
        await db.query(`
            CREATE TABLE IF NOT EXISTS categories (
                name TEXT PRIMARY KEY
            )
        `);
        // Populate from products
        await db.query(`
            INSERT INTO categories (name)
            SELECT DISTINCT category FROM products
            ON CONFLICT (name) DO NOTHING
        `);
        console.log('Migration successful: categories table created and populated.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
