module.exports = {
  apps: [{
    name: 'ai-horde-discord-cyra',
    script: './dist/index.js',
    cwd: '/home/angel/projects/AI_Horde_Discord-Cyra-docker/AI_Horde_Discord-Cyra',
    instances: 1,
    autorestart: true,
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
