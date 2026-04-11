const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const S3_BASE = 'https://ecell-store-images.s3.ap-south-1.amazonaws.com/s3';

const mapping = [
  { id: 1, s3: 'power%20bank.png' },
  { id: 2, s3: 'Drawing%20tablet%20(HUION%20HS64).jpg' },
  { id: 5, s3: 'llama%20print%20cup.png' },
  { id: 6, s3: 'deskpad%202.jpeg.webp' },
];

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of mapping) {
      const url = `${S3_BASE}/${item.s3}`;
      console.log(`Updating product ${item.id} to ${url}`);
      await client.query('UPDATE products SET image_url = $1 WHERE id = $2', [url, item.id]);
    }
    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
