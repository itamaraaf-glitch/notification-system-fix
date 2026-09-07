#!/usr/bin/env node
/**AI Agent daemon - continuous monitoring and improvement service*/

const NotificationAIAgent = require('./ai-agent');
const fs = require('fs');
const path = require('path');

class AgentDaemon {
  constructor(config = {}) {
    this.config = {
      autoAnalyzeInterval: config.autoAnalyzeInterval || 300000, // 5 minutes
      logFile: config.logFile || 'ai-agent.log',
      pidFile: config.pidFile || 'ai-agent.pid',
      healthCheckInterval: config.healthCheckInterval || 600000, // 10 minutes
      ...config
    };

    this.agent = new NotificationAIAgent({
      autoAnalyzeInterval: this.config.autoAnalyzeInterval
    });

    this.setupLogging();
    this.setupEventHandlers();
  }

  setupLogging() {
    const logStream = fs.createWriteStream(this.config.logFile, { flags: 'a' });

    const log = (level, message, data = {}) => {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level,
        message,
        ...data
      };

      logStream.write(JSON.stringify(logEntry) + '\n');

      if (level === 'ERROR') {
        console.error(`[${timestamp}] ${message}`, data);
      }
    };

    this.log = log;
  }

  setupEventHandlers() {
    this.agent.on('start', (data) => {
      this.log('INFO', 'AI Agent started', data);
    });

    this.agent.on('batch-analyzed', (data) => {
      this.log('INFO', `Analyzed ${data.count} notifications`, data);
    });

    this.agent.on('anomalies-detected', (data) => {
      this.log('WARNING', `Detected ${data.length} anomalies`, { anomalies: data });
    });

    this.agent.on('critical-alerts', (data) => {
      this.log('ALERT', `${data.count} critical alerts found`, data);
    });

    this.agent.on('improvement-detected', (data) => {
      this.log('INFO', data.message, data);
    });

    this.agent.on('cycle-complete', (data) => {
      this.log('DEBUG', 'Cycle complete', data);
    });

    this.agent.on('error', (error) => {
      this.log('ERROR', `Error in ${error.phase}`, error);
    });

    this.agent.on('stop', (data) => {
      this.log('INFO', 'AI Agent stopped', data);
    });
  }

  writePid() {
    fs.writeFileSync(this.config.pidFile, process.pid.toString());
  }

  readPid() {
    try {
      return parseInt(fs.readFileSync(this.config.pidFile, 'utf8'));
    } catch {
      return null;
    }
  }

  async start() {
    this.writePid();
    this.log('INFO', 'AI Agent Daemon started', {
      pid: process.pid,
      config: this.config
    });

    this.agent.start();

    // Health check
    this.healthCheck = setInterval(() => {
      const status = this.agent.getStatus();
      if (!status.isRunning) {
        this.log('ERROR', 'Agent is not running, attempting restart');
        this.agent.start();
      }
    }, this.config.healthCheckInterval);

    // Graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  shutdown() {
    this.log('INFO', 'Shutting down daemon');

    if (this.healthCheck) {
      clearInterval(this.healthCheck);
    }

    this.agent.stop();

    try {
      fs.unlinkSync(this.config.pidFile);
    } catch {
      // PID file already removed
    }

    process.exit(0);
  }

  status() {
    const pid = this.readPid();
    if (!pid) {
      console.log('❌ AI Agent daemon is not running');
      return;
    }

    try {
      // Check if process exists
      process.kill(pid, 0);
      console.log(`✅ AI Agent daemon is running (PID: ${pid})`);
      console.log(`📊 Log file: ${this.config.logFile}`);

      // Show recent logs
      try {
        const logs = fs.readFileSync(this.config.logFile, 'utf8').split('\n').slice(-5).filter(Boolean);
        if (logs.length > 0) {
          console.log('\n📋 Recent activity:');
          logs.forEach(log => {
            try {
              const entry = JSON.parse(log);
              console.log(`   [${entry.level}] ${entry.message}`);
            } catch {
              console.log(`   ${log}`);
            }
          });
        }
      } catch {
        // Log file not available
      }
    } catch {
      console.log(`❌ AI Agent daemon is not running (stale PID: ${pid})`);
    }
  }
}

// CLI Interface
const args = process.argv.slice(2);
const daemon = new AgentDaemon();

if (args[0] === 'start') {
  daemon.start();
} else if (args[0] === 'status') {
  daemon.status();
} else if (args[0] === 'stop') {
  const pid = daemon.readPid();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`🛑 Sent shutdown signal to daemon (PID: ${pid})`);
    } catch {
      console.log('❌ Failed to stop daemon');
    }
  }
} else {
  console.log(`
AI Agent Daemon - Autonomous notification analysis and learning

Usage:
  node ai-agent-daemon.js <command>

Commands:
  start     Start the daemon
  status    Show daemon status and recent logs
  stop      Stop the daemon

Examples:
  node ai-agent-daemon.js start
  node ai-agent-daemon.js status
  node ai-agent-daemon.js stop

The daemon will:
  ✓ Continuously analyze notifications
  ✓ Learn from patterns and feedback
  ✓ Detect anomalies
  ✓ Track learning metrics
  ✓ Report on critical alerts
  ✓ Log all activities to ai-agent.log
  `);
}
