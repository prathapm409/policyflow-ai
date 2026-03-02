require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("./db");

(async () => {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  await pool.query(sql);
  console.log("? Database initialized.");
  process.exit(0);
})();
