#!/usr/bin/env node
/**Firebase Sync - Bridge between Firebase and AI Agent*/

const sqlite3 = require('sqlite3');
const { ensureSchema } = require('./db-schema');
const EventEmitter = require('events');

// Firebase SDK (client-side compatible in Node)
let firebase = null;
let db = null;

class FirebaseSync extends EventEmitter {
  constructor(firebaseConfig) {
    super();
    this.config = firebaseConfig;
    this.db = null;
    this.firebaseApp = null;
    this.isConnected = false;
    this.lastSync = null;
  }

  // Initialize SQLite
  initDatabase(dbPath = 'notifications.db') {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) { reject(err); return; }
        // המבנה המשותף נוצר תמיד, כדי שהמערכת תעבוד גם בלי צד הפייתון
        ensureSchema(this.db)
          .then(() => { this.createTablesIfNeeded(); resolve(); })
          .catch(reject);
      });
    });
  }

  // Create required tables
  createTablesIfNeeded() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        entity_type TEXT,
        entity_id TEXT,
        severity TEXT,
        title TEXT,
        message TEXT,
        is_read INTEGER DEFAULT 0,
        is_spam INTEGER DEFAULT 0,
        analysis_score REAL,
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        firebase_id TEXT UNIQUE,
        synced_at DATETIME
      )`,

      `CREATE TABLE IF NOT EXISTS firebase_sync (
        id INTEGER PRIMARY KEY,
        firebase_id TEXT UNIQUE,
        local_id TEXT,
        status TEXT,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE INDEX IF NOT EXISTS idx_firebase_id ON notifications(firebase_id)`,
      `CREATE INDEX IF NOT EXISTS idx_entity ON notifications(entity_type, entity_id)`,
      `CREATE INDEX IF NOT EXISTS idx_severity ON notifications(severity)`
    ];

    queries.forEach(query => {
      this.db.run(query, (err) => {
        if (err) console.error('Database error:', err);
      });
    });
  }

  // Initialize Firebase (Realtime Database)
  async initFirebase() {
    try {
      // For Node.js, we'll use REST API to Firebase
      // First, check if credentials are provided
      if (!this.config.databaseURL) {
        throw new Error('Firebase databaseURL is required');
      }

      this.isConnected = true;
      this.emit('firebase-connected', { url: this.config.databaseURL });
      console.log('✅ Firebase connection configured:', this.config.databaseURL);

      return true;
    } catch (error) {
      console.error('❌ Firebase initialization error:', error.message);
      this.emit('error', { phase: 'firebase-init', error: error.message });
      return false;
    }
  }

  // Fetch notifications from Firebase
  async fetchFromFirebase() {
    if (!this.config.databaseURL) {
      throw new Error('Firebase not configured');
    }

    try {
      // Firebase REST API endpoint
      const url = `${this.config.databaseURL}/notifications.json`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Firebase fetch failed: ${response.status}`);
      }

      const data = await response.json();

      if (!data) {
        return [];
      }

      // Convert Firebase object to array
      const notifications = Object.entries(data).map(([fbId, notif]) => ({
        firebase_id: fbId,
        ...notif
      }));

      return notifications;
    } catch (error) {
      console.error('Error fetching from Firebase:', error.message);
      this.emit('error', { phase: 'firebase-fetch', error: error.message });
      return [];
    }
  }

  // Sync new notifications from Firebase to SQLite
  async syncFromFirebase() {
    try {
      this.emit('sync-start', { direction: 'firebase-to-sqlite' });
      console.log('🔄 Syncing from Firebase...');

      const firebaseNotifs = await this.fetchFromFirebase();
      let synced = 0;
      let skipped = 0;

      for (const notif of firebaseNotifs) {
        const exists = await this.checkIfSynced(notif.firebase_id);

        if (!exists) {
          await this.insertNotificationToSQLite(notif);
          synced++;
        } else {
          skipped++;
        }
      }

      this.lastSync = new Date();
      this.emit('sync-complete', {
        direction: 'firebase-to-sqlite',
        synced,
        skipped,
        total: firebaseNotifs.length
      });

      console.log(`✅ Sync complete: ${synced} new, ${skipped} existing`);
      return { synced, skipped };
    } catch (error) {
      console.error('Sync error:', error);
      this.emit('error', { phase: 'sync-firebase-to-sqlite', error: error.message });
      throw error;
    }
  }

  // Check if notification already synced
  checkIfSynced(firebaseId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT id FROM firebase_sync WHERE firebase_id = ?',
        [firebaseId],
        (err, row) => {
          if (err) reject(err);
          else resolve(!!row);
        }
      );
    });
  }

  // Insert notification to SQLite
  insertNotificationToSQLite(notif) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO notifications
        (firebase_id, entity_type, entity_id, severity, title, message, created_at, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );

      stmt.run(
        [
          notif.firebase_id,
          notif.entity_type || 'unknown',
          notif.entity_id || notif.id,
          notif.severity || 'MEDIUM',
          notif.title || '',
          notif.message || '',
          notif.created_at || new Date().toISOString(),
          new Date().toISOString()
        ],
        function(err) {
          if (err) reject(err);
          else {
            // Record sync
            const syncStmt = this.db.prepare(
              `INSERT OR REPLACE INTO firebase_sync
              (firebase_id, local_id, status, last_updated)
              VALUES (?, ?, ?, ?)`
            );

            syncStmt.run(
              [notif.firebase_id, this.lastID, 'synced', new Date().toISOString()],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          }
        }.bind(this)
      );
    });
  }

  // Update Firebase with analysis results
  async updateFirebaseWithAnalysis(firebaseId, analysis) {
    try {
      const url = `${this.config.databaseURL}/notifications/${firebaseId}.json`;

      const updateData = {
        analysis_score: analysis.severity_score,
        category: analysis.category,
        is_spam: analysis.is_spam,
        analyzed_at: new Date().toISOString()
      };

      const response = await fetch(url, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`Firebase update failed: ${response.status}`);
      }

      console.log(`✅ Updated Firebase: ${firebaseId}`);
      return true;
    } catch (error) {
      console.error('Error updating Firebase:', error.message);
      return false;
    }
  }

  // Start continuous sync
  startSync(intervalMs = 30000) {
    console.log(`⏰ Starting Firebase sync (every ${intervalMs / 1000}s)...`);

    // Initial sync
    this.syncFromFirebase().catch(console.error);

    // Periodic sync
    this.syncInterval = setInterval(() => {
      this.syncFromFirebase().catch(console.error);
    }, intervalMs);

    this.emit('sync-started', { interval: intervalMs });
  }

  // Stop sync
  stopSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    console.log('🛑 Firebase sync stopped');
    this.emit('sync-stopped');
  }

  // Get status
  getStatus() {
    return {
      isConnected: this.isConnected,
      firebaseURL: this.config.databaseURL,
      lastSync: this.lastSync,
      syncingEnabled: !!this.syncInterval
    };
  }

  // Close database
  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// CLI Usage
if (require.main === module) {
  // כתובת מסד הנתונים מגיעה מהסביבה בלבד. קודם היה כאן ברירת-מחדל מדומה
  // (your-project-...), והסנכרון "הצליח" לכאורה ואז נכשל ב-403 כל 30 שניות.
  // עדיף להגיד את האמת פעם אחת ולצאת בשקט.
  const dbUrl = process.env.FIREBASE_DATABASE_URL || process.env.FIREBASE_DB_URL || '';
  if (!dbUrl || /your-project/i.test(dbUrl)) {
    console.log('ℹ️  סנכרון Firebase מדולג — לא הוגדרה כתובת מסד נתונים.');
    console.log('');
    console.log('   להפעלה, הרץ עם הכתובת שלך:');
    console.log('     FIREBASE_DATABASE_URL="https://<הפרויקט-שלך>-default-rtdb.firebaseio.com" npm run firebase:sync');
    console.log('');
    console.log('   את הכתובת מוצאים ב-Firebase Console → Realtime Database → כתובת המסד.');
    console.log('   כל שאר המערכת (דשבורד, סוכן, ייצוא) עובדת גם בלי זה, על הנתונים המקומיים.');
    process.exit(0);
  }

  const firebaseConfig = { databaseURL: dbUrl.replace(/\/+$/, '') };

  const sync = new FirebaseSync(firebaseConfig);

  (async () => {
    try {
      // Initialize
      await sync.initDatabase();
      await sync.initFirebase();

      // Event listeners
      sync.on('sync-complete', (data) => {
        console.log(`📊 Sync complete: ${data.synced} new notifications`);
      });

      sync.on('error', (err) => {
        console.error(`❌ Error: ${err.error}`);
      });

      // Start syncing
      sync.startSync(30000); // Every 30 seconds

      // Keep alive
      console.log('🟢 Firebase Sync running. Press Ctrl+C to stop.');

      process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...');
        sync.stopSync();
        await sync.close();
        process.exit(0);
      });
    } catch (error) {
      console.error('Fatal error:', error);
      process.exit(1);
    }
  })();
}

module.exports = FirebaseSync;
