const { Pool } = require('pg');
require('dotenv').config();

// Constants
const MAX_POOL_SIZE = process.env.MAX_POOL_SIZE || 20;
const IDLE_TIMEOUT_MS = process.env.IDLE_TIMEOUT_MS || 30000;
const CONNECTION_TIMEOUT_MS = process.env.CONNECTION_TIMEOUT_MS || 5000;

// Database Configuration
const dbConfig = {
  // Support both individual vars and connection string
  connectionString: process.env.DATABASE_URL || `postgres://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: MAX_POOL_SIZE,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  application_name: 'sharebuddy_backend'
};

// Initialize PostgreSQL pool with advanced configuration
const pool = new Pool(dbConfig);

// Global error handler for unexpected pool errors
pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  // Don't exit process - instead notify monitoring and handle gracefully
  if (process.env.NODE_ENV === 'production') {
    console.error('Critical database error - notifying monitoring service');
  }
});

// Health check function for database
async function checkDatabaseHealth() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    return result.rows[0] ? true : false;
  } catch (err) {
    console.error('Database health check failed:', err);
    return false;
  }
}

module.exports = {
  pool,
  checkDatabaseHealth
}; 