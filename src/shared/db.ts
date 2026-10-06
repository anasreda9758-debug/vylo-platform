import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required. Copy .env.example to .env and start the dev db (npm run db:dev).",
  );
}

/**
 * Connection pooling configuration.
 *
 * In production (Vercel/serverless), each function invocation may create
 * a new connection. The `max` setting limits the pool size to prevent
 * exhausting PostgreSQL's max_connections.
 *
 * For PgBouncer or external poolers, set max lower (2-5).
 * For direct connections, max=10 is safe for small-medium workloads.
 *
 * Key settings:
 * - max: maximum connections in pool (10 for dev, 5 for production)
 * - idle_timeout: close idle connections after 30s to free resources
 * - connect_timeout: fail fast if DB is unreachable (10s)
 * - prepare: false required for PgBouncer compatibility
 */
const poolMax = Number(process.env.DB_POOL_MAX) || (process.env.NODE_ENV === "production" ? 5 : 10);

export const client = postgres(connectionString, {
  max: poolMax,
  prepare: false,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: process.env.NODE_ENV === "development" ? undefined : () => {},
});

export const db = drizzle(client, { schema });
export type PgClient = typeof client;
