/**
 * Single definition of the SQLite schema the AI system runs on.
 *
 * The learning tables used to be created only by the Python analyzer, so a
 * JavaScript-only run (generate data → dashboard → proactive agent) hit
 * "no such table: analyzer_feedback" the first time the agent decided to
 * retrain. Every entry point now calls ensureSchema() before it touches the
 * database, so the system works whether or not the Python side is ever run.
 *
 * The definitions below match ai_advanced_analyzer.py exactly — the two sides
 * read and write the same rows.
 */

const STATEMENTS = [
  // Superset of the columns the three writers used to declare separately: the
  // analyzer (category/severity_score/status), the Firebase sync
  // (firebase_id/synced_at) and the data generator (is_read/is_spam/
  // analysis_score). One definition means an insert from any of them fits.
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    entity_type TEXT,
    entity_id TEXT,
    category TEXT,
    title TEXT,
    message TEXT,
    severity TEXT,
    severity_score REAL,
    analysis_score REAL,
    status TEXT DEFAULT 'new',
    is_read INTEGER DEFAULT 0,
    is_spam INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    analyzed_at TEXT,
    metadata TEXT,
    firebase_id TEXT UNIQUE,
    synced_at DATETIME
  )`,
  `CREATE TABLE IF NOT EXISTS analyzer_feedback (
    id TEXT PRIMARY KEY,
    notification_id TEXT NOT NULL,
    actual_severity REAL NOT NULL,
    predicted_severity REAL NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    category TEXT NOT NULL,
    was_important INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS entity_trends (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    avg_severity REAL,
    notification_count INTEGER,
    last_updated TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
  )`,
  `CREATE TABLE IF NOT EXISTS category_patterns (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    category TEXT NOT NULL,
    frequency INTEGER NOT NULL,
    avg_severity REAL,
    last_updated TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id, category)
  )`,
  `CREATE TABLE IF NOT EXISTS firebase_sync (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firebase_id TEXT UNIQUE,
    local_id TEXT,
    last_sync TEXT,
    records_synced INTEGER,
    status TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_created
     ON notifications(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_severity
     ON notifications(severity, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_notification
     ON analyzer_feedback(notification_id)`,
];

/** Creates every table and index if missing. Safe to call on every open. */
function ensureSchema(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      let pending = STATEMENTS.length;
      let failed = false;
      STATEMENTS.forEach((sql) => {
        db.run(sql, (err) => {
          if (failed) return;
          if (err) {
            failed = true;
            reject(err);
            return;
          }
          if (--pending === 0) resolve(db);
        });
      });
    });
  });
}

module.exports = { ensureSchema, STATEMENTS };
