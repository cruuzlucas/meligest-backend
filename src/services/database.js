const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Inicializa as tabelas
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        ml_user_id VARCHAR(50) UNIQUE NOT NULL,
        nickname VARCHAR(100),
        email VARCHAR(200),
        ml_access_token TEXT,
        ml_refresh_token TEXT,
        ml_token_expires_at TIMESTAMP,
        app_jwt_secret VARCHAR(200),
        plan VARCHAR(20) DEFAULT 'free',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cached_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        order_id VARCHAR(50) NOT NULL,
        data JSONB NOT NULL,
        synced_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, order_id)
      );

      CREATE TABLE IF NOT EXISTS cached_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        item_id VARCHAR(50) NOT NULL,
        data JSONB NOT NULL,
        synced_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS product_costs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        item_id VARCHAR(50) NOT NULL,
        sku VARCHAR(100),
        cost_price DECIMAL(10,2) DEFAULT 0,
        notes TEXT,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, item_id)
      );

      CREATE INDEX IF NOT EXISTS idx_cached_orders_user ON cached_orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_cached_items_user ON cached_items(user_id);
      CREATE INDEX IF NOT EXISTS idx_product_costs_user ON product_costs(user_id);
    `);
    console.log('✅ Banco de dados inicializado');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
