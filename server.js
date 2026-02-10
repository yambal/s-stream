const config = require('./lib/config');
const { createServer } = require('./lib/server');
const MountManager = require('./lib/mount-manager');

const mountManager = new MountManager(config);

// Create mounts from config
for (const mountConfig of config.mounts) {
  mountManager.createMount(mountConfig.path, mountConfig);
}

const server = createServer(mountManager, config);

server.listen(config.port, () => {
  console.log(`s-stream Icecast-compatible server on port ${config.port}`);
  console.log(`Mounts: ${mountManager.getMounts().map(m => m.path).join(', ')}`);
  console.log(`Stream: http://localhost:${config.port}/stream`);
  console.log(`Stats:  http://localhost:${config.port}/status-json.xsl`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  mountManager.getMounts().forEach(mount => {
    mount.listeners.forEach(listener => listener.stop());
    if (mount.source && typeof mount.source.stop === 'function') {
      mount.source.stop();
    }
  });
  server.close(() => process.exit(0));
});
