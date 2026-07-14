const path = require('path');

const repositoryRoot = __dirname;

module.exports = {
    apps: [
        {
            name: 'dungeon-blitz-multiplayer',
            cwd: repositoryRoot,
            script: path.join(repositoryRoot, 'scripts', 'start-multiplayer-pm2.sh'),
            interpreter: '/bin/bash',
            exec_mode: 'fork',
            instances: 1,
            autorestart: true,
            restart_delay: 5000,
            min_uptime: '15s',
            max_restarts: 5,
            kill_timeout: 30000,
            time: true,
            env: {
                NODE_ENV: 'production',
                DUNGEON_BLITZ_BRANCH: 'main'
            },
            env_production: {
                NODE_ENV: 'production',
                DUNGEON_BLITZ_BRANCH: 'main'
            }
        }
    ]
};
