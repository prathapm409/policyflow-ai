// server/db.js
// Simple PG Pool wrapper. Uses DATABASE_URL or individual PG_* env vars.
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || null;
const pool = connectionString
  ? new Pool({ connectionString, ssl: { rejectUnauthorized: false } })
  : new Pool({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: { rejectUnauthorized: false },
    });

module.exports = pool;
