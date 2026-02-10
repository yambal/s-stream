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
  return { ...DEFAULTS, ...userConfig };
}

module.exports = loadConfig();
