let config = {}
try {
  config = require('./config.json')
} catch {
  // config.json is created from template.config.json during setup.
}

const restartBackoff = Number(config.connection_health?.restart_backoff_milliseconds)

module.exports = {
  apps: [{
    name: 'ai-horde-discord-cyra',
    script: './dist/index.js',
    cwd: '/home/angel/projects/AI_Horde_Discord-Cyra-docker/AI_Horde_Discord-Cyra',
    instances: 1,
    autorestart: true,
    exp_backoff_restart_delay: Number.isFinite(restartBackoff) && restartBackoff > 0 ? restartBackoff : 1000,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true
  }]
};
