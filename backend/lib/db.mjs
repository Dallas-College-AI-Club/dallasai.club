import pg from 'pg';
import { RequestError } from './errors.mjs';
let pool;
export function database() {
  if (!process.env.FORMS_DATABASE_URL)
    throw new RequestError(
      503,
      'Forms are not configured yet. Please try again later.',
    );
  pool ||= new pg.Pool({
    connectionString: process.env.FORMS_DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    query_timeout: 10000,
    statement_timeout: 10000,
  });
  return {
    query: (sql, values) => pool.query(sql, values),
    transaction: (fn) => transaction(pool, fn),
  };
}
// A failed ROLLBACK must not hide the original error, and its connection is
// destroyed instead of returning to the pool in an unknown state.
export async function transaction(pool, fn) {
  const client = await pool.connect();
  let broken;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => {
      broken = rollbackError;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}
