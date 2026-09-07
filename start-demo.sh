#!/bin/bash
# Demo startup - launches the complete AI notification system

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          🤖 סוכן AI - הדגמה עם נתוני בדיקה                  ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if test data exists
echo "📋 בדיקת נתונים..."
COUNT=$(node -e "const sqlite3 = require('sqlite3'); const db = new sqlite3.Database('notifications.db'); db.get('SELECT COUNT(*) as count FROM notifications', (e,r) => console.log(r?.count || 0)); setTimeout(() => process.exit(), 500);")

if [ -z "$COUNT" ] || [ "$COUNT" -eq 0 ]; then
  echo "⚠️  אין נתוני בדיקה. הרץ קודם:"
  echo "    node test-data-generator.js"
  exit 1
fi

echo "✅ נמצאו $COUNT הודעות בדיקה"
echo ""

# Create tmux session
SESSION_NAME="ai-demo-$$"

# Kill existing session
tmux kill-session -t $SESSION_NAME 2>/dev/null || true

echo "🚀 הפעלת המערכת..."
echo ""

# Create session with 3 windows
tmux new-session -d -s $SESSION_NAME -x 200 -y 50

# Window 0: Dashboard
echo "📊 חלון 1: Dashboard (http://localhost:3000/ai-dashboard.html)"
tmux send-keys -t $SESSION_NAME:0 "clear && echo '🚀 Dashboard Starting...' && npm run dashboard" C-m

sleep 3

# Window 1: Proactive Agent
echo "🧠 חלון 2: Proactive Agent (Decision Making)"
tmux new-window -t $SESSION_NAME -n agent
tmux send-keys -t $SESSION_NAME:agent "clear && echo '🤖 Proactive Agent Starting...' && npm run ai-agent:proactive" C-m

sleep 2

# Window 2: Info
echo "📚 חלון 3: Navigation & Info"
tmux new-window -t $SESSION_NAME -n info
tmux send-keys -t $SESSION_NAME:info "clear && cat << 'EOF'

╔════════════════════════════════════════════════════════════════════╗
║                  🎉 המערכת פועלת!                                 ║
╚════════════════════════════════════════════════════════════════════╝

📊 Dashboard (Real-time Monitoring):
   http://localhost:3000/ai-dashboard.html

📋 What you'll see:
   ✓ 10 test notifications loaded ($COUNT total)
   ✓ Severity breakdown: 5 HIGH, 3 MEDIUM, 2 LOW
   ✓ Agent analyzing automatically
   ✓ Decisions being made (escalations, investigations)
   ✓ Real-time metrics updating

🔴 Critical items that trigger escalation:
   • 5 HIGH severity notifications → escalate to management

🧠 Agent will:
   1. Analyze all notifications
   2. Detect anomalies (5 critical = escalation trigger)
   3. Make autonomous decision (escalate to management)
   4. Log decisions and actions in dashboard

📱 Dashboard Controls:
   • Start/Stop buttons to control agent
   • Refresh button for manual update
   • Live logs at bottom
   • Color-coded severity indicators

🛑 Stop Everything:
   tmux kill-session -t $SESSION_NAME

💡 Next Steps:
   1. Open http://localhost:3000/ai-dashboard.html in browser
   2. Watch the metrics update every 5 seconds
   3. See decisions appear in the list
   4. Watch logs for agent activity

🔥 To add more test data:
   node test-data-generator.js

📚 Full Integration:
   export FIREBASE_DATABASE_URL=\"https://your-project-rtdb.firebaseio.com\"
   npm run firebase:sync

EOF
" C-m

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🌐 Open in Browser: http://localhost:3000/ai-dashboard.html   ║"
echo "║                                                                ║"
echo "║  Tmux Navigation:                                              ║"
echo "║    Ctrl+B → 0 = Dashboard                                      ║"
echo "║    Ctrl+B → 1 = Agent                                          ║"
echo "║    Ctrl+B → 2 = Info                                           ║"
echo "║                                                                ║"
echo "║  Stop all:                                                     ║"
echo "║    tmux kill-session -t $SESSION_NAME                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Attach
tmux attach -t $SESSION_NAME
