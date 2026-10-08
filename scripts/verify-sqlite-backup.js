/* Run only inside an isolated restore drill, never the production data volumes. */
const fs = require('node:fs');
const Database = require('better-sqlite3');
const databases = [
  '/restore/db/baby-tracker.db',
  '/restore/db/baby-tracker-logs.db',
];
for (const path of databases) {
  if (!fs.existsSync(path)) throw new Error('Missing database: ' + path);
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const result = db.pragma('integrity_check', { simple: true });
  db.close();
  if (result !== 'ok') throw new Error('SQLite integrity failure: ' + path);
  console.log('SQLITE_INTEGRITY_OK=' + path);
}
const envFile = '/restore/env/.env';
if (!fs.existsSync(envFile)) throw new Error('Missing encryption configuration');
const env = fs.readFileSync(envFile, 'utf8');
for (const key of ['ENC_HASH=', 'JWT_SECRET=']) {
  if (!env.includes(key)) throw new Error('Missing persistent secret key');
}
console.log('CONFIG_KEYS_PRESENT=true');
