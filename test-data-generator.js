#!/usr/bin/env node
/**Test data generator for notifications database*/

const sqlite3 = require('sqlite3');
const { ensureSchema } = require('./db-schema');
const path = require('path');

const dbPath = path.join(__dirname, 'notifications.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Failed to connect to database:', err.message);
    process.exit(1);
  }

  console.log('✅ Connected to notifications.db');
  // כל הטבלאות — כולל טבלאות הלמידה — נוצרות מראש, כך שהסוכן לא ייפול על טבלה חסרה
  ensureSchema(db).then(initializeTables).catch(e => {
    console.error('❌ Schema error:', e.message);
    process.exit(1);
  });
});

// המבנה מגיע מ-db-schema.js (מקור אחד לכל הרכיבים) — כאן רק ממשיכים להזנת הנתונים
function initializeTables() {
  insertTestData();
}

function insertTestData() {
  console.log('\n📝 Inserting test notifications...\n');

  const testNotifications = [
    {
      id: 'notif-001',
      entity_type: 'deal',
      entity_id: 'deal-123',
      severity: 'HIGH',
      title: 'עסקה חדשה בעלות גבוהה',
      message: 'עסקה חדשה בעלות 150,000 שח עם קליינט VIP אישור דרוש',
      firebase_id: 'fb-001',
      synced_at: new Date().toISOString()
    },
    {
      id: 'notif-002',
      entity_type: 'deal',
      entity_id: 'deal-124',
      severity: 'HIGH',
      title: 'עסקה דחוקה',
      message: 'עסקה בשווי 80,000 שח דרוג קרוב אל הקצה',
      firebase_id: 'fb-002',
      synced_at: new Date().toISOString()
    },
    {
      id: 'notif-003',
      entity_type: 'deal',
      entity_id: 'deal-125',
      severity: 'HIGH',
      title: 'חוזה דורש חתימה',
      message: 'חוזה ממתין לחתימת ראשי ממנהלה',
      firebase_id: 'fb-003',
      synced_at: new Date().toISOString()
    },
    {
      id: 'notif-004',
      entity_type: 'deal',
      entity_id: 'deal-126',
      severity: 'HIGH',
      title: 'טלפון דחוף מקליינט',
      message: 'קליינט מחכה לשיחה חזרה בנושא העסקה',
      firebase_id: 'fb-004',
      synced_at: new Date().toISOString()
    },
    {
      id: 'notif-005',
      entity_type: 'deal',
      entity_id: 'deal-127',
      severity: 'HIGH',
      title: 'בעיה בעסקה',
      message: 'קליינט דיווח על בעיה טכנית בביצוע העסקה',
      firebase_id: 'fb-005',
      synced_at: new Date().toISOString()
    },
    {
      id: 'notif-006',
      entity_type: 'client',
      entity_id: 'client-456',
      severity: 'MEDIUM',
      title: 'קליינט חדש רשום',
      message: 'קליינט חדש - דן כהן התחברות ראשונה',
      firebase_id: 'fb-006',
      synced_at: new Date().toISOString()
    },
    {
      id: 'notif-007',
      entity_type: 'task',
      entity_id: 'task-789',
      severity: 'MEDIUM',
      title: 'תזכורת - מפגש מתקרב',
      message: 'מפגש עם קליינט קרוב - יש להתכונן',
      firebase_id: 'fb-007',
      synced_at: new Date().toISOString()
    },
    {
      id: 'notif-008',
      entity_type: 'support',
      entity_id: 'support-001',
      severity: 'MEDIUM',
      title: 'שאלה מקליינט',
      message: 'קליינט שאל שאלה בנושא התמחור',
      firebase_id: 'fb-008',
      synced_at: new Date().toISOString()
    },
    {
      id: 'notif-009',
      entity_type: 'deal',
      entity_id: 'deal-128',
      severity: 'LOW',
      title: 'עדכון יומי',
      message: 'עדכון שגרתי על התקדמות העסקה',
      firebase_id: 'fb-009',
      synced_at: new Date().toISOString()
    },
    {
      id: 'notif-010',
      entity_type: 'client',
      entity_id: 'client-457',
      severity: 'LOW',
      title: 'תיעוד קליינט',
      message: 'רשומת קליינט חדשה הוספה למערכת',
      firebase_id: 'fb-010',
      synced_at: new Date().toISOString()
    }
  ];

  let inserted = 0;
  testNotifications.forEach(notif => {
    db.run(
      `INSERT OR REPLACE INTO notifications
       (id, entity_type, entity_id, severity, title, message, firebase_id, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        notif.id,
        notif.entity_type,
        notif.entity_id,
        notif.severity,
        notif.title,
        notif.message,
        notif.firebase_id,
        notif.synced_at
      ],
      function(err) {
        if (err) {
          console.error(`❌ Error inserting ${notif.id}:`, err.message);
        } else {
          console.log(`✅ ${notif.id}: ${notif.title}`);
        }
        inserted++;
        if (inserted === testNotifications.length) {
          verifyData();
        }
      }
    );
  });
}

function verifyData() {
  db.get('SELECT COUNT(*) as count FROM notifications', (err, row) => {
    if (err) {
      console.error('❌ Error counting:', err);
    } else {
      console.log(`\n📊 Total notifications in database: ${row.count}`);

      db.all(
        `SELECT severity, COUNT(*) as count FROM notifications GROUP BY severity`,
        (err, rows) => {
          if (err) {
            console.error('❌ Error grouping:', err);
          } else {
            console.log('\n📈 Breakdown by severity:');
            rows.forEach(row => {
              const emoji = row.severity === 'HIGH' ? '🔴' : row.severity === 'MEDIUM' ? '🟠' : '🟢';
              console.log(`   ${emoji} ${row.severity}: ${row.count}`);
            });
          }

          console.log('\n✨ Test data ready! Now run:\n');
          console.log('   Terminal 1: npm run dashboard');
          console.log('   Terminal 2: npm run ai-agent:proactive');
          console.log('   Terminal 3: npm run firebase:sync (or leave empty for demo)');
          console.log('\nThen open: http://localhost:3000/ai-dashboard.html\n');

          db.close();
          process.exit(0);
        }
      );
    }
  });
}
