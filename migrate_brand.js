const db = require('./models/db');

async function migrate() {
    try {
        console.log('Starting migration...');
        await db.query(`
            ALTER TABLE products 
            ADD COLUMN IF NOT EXISTS brand TEXT
        `);
        console.log('Migration successful: brand column added.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
