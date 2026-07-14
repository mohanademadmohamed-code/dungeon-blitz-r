const assert = require('node:assert/strict');
const {
    GOOGLE_CLOUD_HOST,
    applyMultiplayerServerEnv
} = require('../tools/startMultiplayerServer');

const defaults = {};
applyMultiplayerServerEnv(defaults);
assert.deepEqual(defaults, {
    MULTIPLAYER_MODE: 'true',
    MULTIPLAYER_BASE_IP: GOOGLE_CLOUD_HOST,
    PUBLIC_BASE_URL: `http://${GOOGLE_CLOUD_HOST}`,
    STATIC_PORT: '80',
    GAME_PORT: '8080',
    POLICY_PORT: '843',
    ENABLE_POLICY_SERVER: 'true'
});

const overrides = {
    MULTIPLAYER_BASE_IP: '203.0.113.10',
    PUBLIC_BASE_URL: 'https://game.example.com',
    STATIC_PORT: '8088',
    GAME_PORT: '9090',
    POLICY_PORT: '8843',
    ENABLE_POLICY_SERVER: 'false'
};
applyMultiplayerServerEnv(overrides);
assert.equal(overrides.MULTIPLAYER_MODE, 'true');
assert.equal(overrides.MULTIPLAYER_BASE_IP, '203.0.113.10');
assert.equal(overrides.PUBLIC_BASE_URL, 'https://game.example.com');
assert.equal(overrides.STATIC_PORT, '8088');
assert.equal(overrides.GAME_PORT, '9090');
assert.equal(overrides.POLICY_PORT, '8843');
assert.equal(overrides.ENABLE_POLICY_SERVER, 'false');

console.log('multiplayer_google_cloud_config_regression: ok');
