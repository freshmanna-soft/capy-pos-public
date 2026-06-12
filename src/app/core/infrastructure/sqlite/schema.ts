/**
 * Database Schema
 *
 * Defines the SQLite database schema for the Capy-POS system.
 * Includes tables for products, customers, transactions, payments, and more.
 */

/**
 * SQL statements to create all database tables
 */
export const CREATE_TABLES = `
-- Products table
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  cost REAL,
  sku TEXT UNIQUE,
  barcode TEXT,
  category TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  reserved_stock INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 10,
  unit TEXT DEFAULT 'unit',
  tax_rate REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  image_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  address_street TEXT,
  address_city TEXT,
  address_state TEXT,
  address_postal_code TEXT,
  address_country TEXT,
  loyalty_points INTEGER DEFAULT 0,
  loyalty_tier TEXT DEFAULT 'BRONZE',
  total_spent REAL DEFAULT 0,
  visit_count INTEGER DEFAULT 0,
  last_visit_date TEXT,
  notes TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  subtotal REAL NOT NULL,
  tax REAL NOT NULL,
  discount REAL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT NOT NULL,
  payment_method TEXT,
  payment_status TEXT,
  notes TEXT,
  cashier_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- Transaction items table
CREATE TABLE IF NOT EXISTS transaction_items (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  subtotal REAL NOT NULL,
  tax REAL NOT NULL,
  discount REAL DEFAULT 0,
  total REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  reference_number TEXT,
  card_last_four TEXT,
  card_brand TEXT,
  authorization_code TEXT,
  processor_response TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
);

-- Stock reservations table
CREATE TABLE IF NOT EXISTS stock_reservations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reserved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  customer_id TEXT,
  transaction_id TEXT,
  status TEXT DEFAULT 'ACTIVE',
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

-- Stock adjustments table
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  previous_quantity INTEGER NOT NULL,
  new_quantity INTEGER NOT NULL,
  adjustment_amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  adjusted_by TEXT,
  adjusted_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Loyalty transactions table
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  transaction_id TEXT,
  balance_after INTEGER NOT NULL,
  transaction_date TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

-- Rewards table
CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  points_cost INTEGER NOT NULL,
  reward_type TEXT NOT NULL,
  reward_value REAL,
  is_active INTEGER DEFAULT 1,
  expiration_days INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Reward redemptions table
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  points_cost INTEGER NOT NULL,
  redeemed_at TEXT NOT NULL,
  expires_at TEXT,
  used_at TEXT,
  status TEXT DEFAULT 'ACTIVE',
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (reward_id) REFERENCES rewards(id)
);

-- Sync queue table (for offline-first sync)
CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  synced_at TEXT,
  status TEXT DEFAULT 'PENDING',
  retry_count INTEGER DEFAULT 0,
  error_message TEXT
);
`;

/**
 * SQL statements to create indexes for performance
 */
export const CREATE_INDEXES = `
-- Products indexes
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

-- Customers indexes
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_loyalty_tier ON customers(loyalty_tier);

-- Transactions indexes
CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);

-- Transaction items indexes
CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction ON transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_product ON transaction_items(product_id);

-- Payments indexes
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- Stock reservations indexes
CREATE INDEX IF NOT EXISTS idx_reservations_product ON stock_reservations(product_id);
CREATE INDEX IF NOT EXISTS idx_reservations_expires ON stock_reservations(expires_at);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON stock_reservations(status);

-- Loyalty transactions indexes
CREATE INDEX IF NOT EXISTS idx_loyalty_customer ON loyalty_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_date ON loyalty_transactions(transaction_date);

-- Sync queue indexes
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_entity ON sync_queue(entity_type, entity_id);
`;

/**
 * SQL statements to insert seed data
 */
export const SEED_DATA = `
-- Sample products
INSERT OR IGNORE INTO products (id, name, description, price, cost, sku, category, stock, low_stock_threshold, created_at, updated_at)
VALUES 
  ('prod-1', 'Espresso', 'Rich and bold espresso shot', 3.50, 0.80, 'ESP-001', 'Beverages', 100, 20, datetime('now'), datetime('now')),
  ('prod-2', 'Cappuccino', 'Espresso with steamed milk and foam', 4.50, 1.20, 'CAP-001', 'Beverages', 100, 20, datetime('now'), datetime('now')),
  ('prod-3', 'Latte', 'Espresso with steamed milk', 4.75, 1.30, 'LAT-001', 'Beverages', 100, 20, datetime('now'), datetime('now')),
  ('prod-4', 'Croissant', 'Buttery French pastry', 3.25, 1.00, 'CRO-001', 'Pastries', 50, 10, datetime('now'), datetime('now')),
  ('prod-5', 'Blueberry Muffin', 'Fresh baked muffin with blueberries', 3.75, 1.20, 'MUF-001', 'Pastries', 40, 10, datetime('now'), datetime('now'));

-- Sample rewards
INSERT OR IGNORE INTO rewards (id, name, description, points_cost, reward_type, reward_value, expiration_days, created_at, updated_at)
VALUES
  ('rew-1', 'Free Coffee', 'Redeem for any regular coffee', 500, 'FREE_ITEM', 0, 30, datetime('now'), datetime('now')),
  ('rew-2', '$5 Discount', 'Get $5 off your purchase', 1000, 'DISCOUNT', 5.00, 60, datetime('now'), datetime('now')),
  ('rew-3', 'Free Pastry', 'Redeem for any pastry', 750, 'FREE_ITEM', 0, 30, datetime('now'), datetime('now'));
`;

/**
 * Complete schema initialization
 */
export const INITIALIZE_SCHEMA = CREATE_TABLES + CREATE_INDEXES + SEED_DATA;

// Made with Bob
