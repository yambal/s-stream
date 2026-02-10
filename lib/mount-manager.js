const Mount = require('./mount');
const PlaylistSource = require('./playlist');

class MountManager {
  constructor(config) {
    this.mounts = new Map();
    this.config = config;
  }

  createMount(mountPath, options) {
    if (this.mounts.has(mountPath)) {
      return this.mounts.get(mountPath);
    }

    const mount = new Mount(mountPath, { ...this.config, ...options });
    this.mounts.set(mountPath, mount);

    if (options.type === 'playlist') {
      const playlist = new PlaylistSource(mount, options);
      mount.setSource(playlist);
      playlist.start();
    }

    console.log(`Mount created: ${mountPath}`);
    return mount;
  }

  getMount(mountPath) {
    return this.mounts.get(mountPath);
  }

  getOrCreateMount(mountPath, options) {
    return this.mounts.get(mountPath) || this.createMount(mountPath, options || {});
  }

  removeMount(mountPath) {
    const mount = this.mounts.get(mountPath);
    if (mount) {
      if (mount.source && typeof mount.source.stop === 'function') {
        mount.source.stop();
      }
      mount.listeners.forEach(listener => listener.stop());
      this.mounts.delete(mountPath);
    }
  }

  getMounts() {
    return Array.from(this.mounts.values());
  }

  getStats() {
    const result = {};
    for (const [path, mount] of this.mounts) {
      result[path] = mount.getStats();
    }
    return result;
  }
}

module.exports = MountManager;
