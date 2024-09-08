import { global_pool } from '../pool.js';

const DROP_TABLES = `
  DROP TABLE IF EXISTS prompt_requests;
  DROP TABLE IF EXISTS prompt_answers;
  DROP TABLE IF EXISTS processed_transactions;
`;

const CREATE_TABLES = `
  CREATE TABLE prompt_requests (
    tx_id TEXT PRIMARY KEY UNIQUE not null,
    req_id INTEGER,
    chain_id INTEGER,
    user_address TEXT,
    text TEXT,
    block_number INTEGER,
    timestamp INTEGER
  );

  CREATE TABLE prompt_answers (
    tx_id TEXT PRIMARY KEY UNIQUE not null,
    req_id INTEGER,
    chain_id INTEGER,
    user_address TEXT,
    text TEXT,
    block_number INTEGER,
    timestamp INTEGER
  );

  CREATE TABLE processed_transactions (
    chain_id INTEGER PRIMARY KEY,
    last_processed_txn_number BIGINT
  );
`;

const run = async () => {
  const client = await global_pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(DROP_TABLES);
    await client.query(CREATE_TABLES);
    await client.query('COMMIT');
    console.log('Database reset successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error resetting database:', err);
  } finally {
    client.release();
  }
};

run().catch(err => console.error('Error running script:', err));
