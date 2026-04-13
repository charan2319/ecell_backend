const db = require('./models/db');
async function check() {
  try {
    const result = await db.query('SELECT * FROM admin_config');
    console.log('Admin Config:', result.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
check();
