const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  port: 8000,
  sourcePassword: 'hackme',
  adminPassword: 'admin',
  icyMetaint: 16000,
  burstSize: 65536,
  bufferSize: 524288,
  connectionTimeout: 10000,
  serverName: 's-stream',
  maxListenersPerMount: 100,
  mounts: [
    {
      path: '/stream',
      type: 'playlist',
      musicDir: './music',
      name: 'ETS2 Radio',
      genre: 'Various',
      bitrate: 128,
      isPublic: true,
    },
  ],
};

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config.json');
  let userConfig = {};
  try {
    userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (_) {
    // config.json is optional
  }

  const config = { ...DEFAULTS, ...userConfig };

  // Environment variable overrides
  if (process.env.PORT) config.port = parseInt(process.env.PORT, 10);
  if (process.env.SOURCE_PASSWORD) config.sourcePassword = process.env.SOURCE_PASSWORD;
  if (process.env.ADMIN_PASSWORD) config.adminPassword = process.env.ADMIN_PASSWORD;

  // RELAY_URL: if set, switch default mount to relay mode
  if (process.env.RELAY_URL) {
    config.mounts[0].type = 'relay';
    config.mounts[0].relayUrl = process.env.RELAY_URL;
  }

  return config;
}

module.exports = loadConfig();
