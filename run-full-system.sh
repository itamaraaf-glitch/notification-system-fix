#!/bin/bash
# Full System Startup Script

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          🤖 סוכן AI - הפעלת המערכת המלאה                      ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check Firebase URL
if [ -z "$FIREBASE_DATABASE_URL" ]; then
  echo "⚠️  FIREBASE_DATABASE_URL לא הוגדר"
  echo "   (אם רוצה Firebase, הגדר: export FIREBASE_DATABASE_URL='...')"
  echo ""
  echo "🟢 הפעלה ב-demo mode (ללא Firebase)"
  echo ""
fi

# Create tmux session
SESSION_NAME="ai-system-$$"

# Kill existing session if it exists
tmux kill-session -t $SESSION_NAME 2>/dev/null || true

# Create new session with 3 windows
tmux new-session -d -s $SESSION_NAME -x 200 -y 50

# Window 1: Dashboard
echo "📊 חלון 1: Dashboard"
tmux send-keys -t $SESSION_NAME:0 "echo '🚀 Dashboard Server Starting...' && npm run dashboard" C-m

sleep 2

# Window 2: Proactive Agent
echo "🧠 חלון 2: Proactive Agent"
tmux new-window -t $SESSION_NAME -n agent
tmux send-keys -t $SESSION_NAME:agent "echo '🤖 Proactive Agent Starting...' && npm run ai-agent:proactive" C-m

sleep 2

# Window 3: Firebase Sync (if URL is set)
if [ -n "$FIREBASE_DATABASE_URL" ]; then
  echo "🔥 חלון 3: Firebase Sync"
  tmux new-window -t $SESSION_NAME -n firebase
  tmux send-keys -t $SESSION_NAME:firebase "echo '🔥 Firebase Sync Starting...' && npm run firebase:sync" C-m
else
  echo "🔥 חלון 3: Monitor (monitoring logs)"
  tmux new-window -t $SESSION_NAME -n monitor
  tmux send-keys -t $SESSION_NAME:monitor "echo '📋 Monitoring System Logs...' && echo '' && echo 'Dashboard Logs:' && tail -f /tmp/dashboard.log 2>/dev/null || echo 'Waiting for logs...'" C-m
fi

# Window 4: Info
echo "📚 חלון 4: Info & Links"
tmux new-window -t $SESSION_NAME -n info
tmux send-keys -t $SESSION_NAME:info "clear && cat << 'EOF'

╔════════════════════════════════════════════════════════════════════╗
║                  🎉 המערכת פועלת!                                 ║
╚════════════════════════════════════════════════════════════════════╝

📊 דשבורד בזמן אמת:
   http://localhost:3000/ai-dashboard.html
   http://localhost:3000

📁 יצוא דוחות:
   http://localhost:3000/export.html

🔧 API Endpoints:
   curl http://localhost:3000/api/agent/status | jq
   curl http://localhost:3000/api/agent/metrics | jq
   curl http://localhost:3000/api/agent/decisions | jq
   curl http://localhost:3000/api/agent/logs | jq

🧠 התחל סוכן בדשבורד:
   לחץ 🟢 'הפעל' בדשבורד

🔥 Firebase (אם רוצה להוסיף):
   export FIREBASE_DATABASE_URL=\"https://your-project-rtdb.firebaseio.com\"
   npm run firebase:sync

📚 תיעוד:
   cat QUICKSTART.md
   cat INTEGRATION_GUIDE.md
   cat FIREBASE_SETUP.md

🛑 עצור הכל:
   pkill -f 'npm run'
   tmux kill-session -t $SESSION_NAME

EOF
" C-m

# Attach to session
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  Session: tmux attach -t $SESSION_NAME"
echo "║  או בחלון חדש הפעל:"
echo "║  tmux attach -t $SESSION_NAME"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Show which windows are available
echo "💻 חלונות זמינים:"
echo "   Ctrl+B ו אז 0 = Dashboard"
echo "   Ctrl+B ו אז 1 = Agent"
if [ -n "$FIREBASE_DATABASE_URL" ]; then
  echo "   Ctrl+B ו אז 2 = Firebase Sync"
  echo "   Ctrl+B ו אז 3 = Info"
else
  echo "   Ctrl+B ו אז 2 = Monitor"
  echo "   Ctrl+B ו אז 3 = Info"
fi
echo ""

# Auto-attach
tmux attach -t $SESSION_NAME
