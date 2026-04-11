const db = require('better-sqlite3')('virtulinked.db');
const res = db.prepare('UPDATE job_queue SET status = ?, attempts = 0 WHERE status = ?').run('pending', 'failed');
console.log('Reset ' + res.changes + ' jobs');
