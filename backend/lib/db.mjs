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
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
