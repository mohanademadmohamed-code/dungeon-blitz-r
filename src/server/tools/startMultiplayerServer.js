const GOOGLE_CLOUD_HOST = '34.135.182.35';

function applyMultiplayerServerEnv(env = process.env) {
    env.MULTIPLAYER_MODE = 'true';
    env.MULTIPLAYER_BASE_IP = env.MULTIPLAYER_BASE_IP || GOOGLE_CLOUD_HOST;
    env.PUBLIC_BASE_URL = env.PUBLIC_BASE_URL || `http://${env.MULTIPLAYER_BASE_IP}`;
    env.STATIC_PORT = env.STATIC_PORT || '80';
    env.GAME_PORT = env.GAME_PORT || '8080';
    env.POLICY_PORT = env.POLICY_PORT || '843';
    env.ENABLE_POLICY_SERVER = env.ENABLE_POLICY_SERVER || 'true';
}

function startMultiplayerServer() {
    require('../scripts/cleanup-dev-instance');
    require('ts-node/register');
    require('../core/loadEnv');
    applyMultiplayerServerEnv();

    require('../main.ts');
}

if (require.main === module) {
    startMultiplayerServer();
}

module.exports = {
    GOOGLE_CLOUD_HOST,
    applyMultiplayerServerEnv,
    startMultiplayerServer
};
