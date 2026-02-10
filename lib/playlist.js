const fs = require('fs');
const path = require('path');

class PlaylistSource {
  constructor(mount, options = {}) {
    this.mount = mount;
    this.musicDir = path.resolve(options.musicDir || './music');
    this.bitrate = options.bitrate || 128;
    this.chunkSize = 4096;
    this.interval = Math.floor((this.chunkSize / (this.bitrate * 1000 / 8)) * 1000);
    this.files = [];
    this.trackIndex = 0;
    this.fileBuffer = null;
    this.bufferOffset = 0;
    this.timer = null;
    this.running = false;
    this.startTime = 0;
    this.bytesSent = 0;
  }

  start() {
    this.files = fs.readdirSync(this.musicDir)
      .filter(f => f.toLowerCase().endsWith('.mp3'))
      .sort();

    if (this.files.length === 0) {
      console.error(`No MP3 files in ${this.musicDir}`);
      return;
    }

    console.log(`Playlist: ${this.files.length} tracks in ${this.musicDir}`);
    this.running = true;
    this.startTime = Date.now();
    this.bytesSent = 0;
    this._loadTrack();
    this._tick();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  pause() {
    this.stop();
  }

  resume() {
    if (!this.running) {
      this.running = true;
      this._tick();
    }
  }

  _loadTrack() {
    const filename = this.files[this.trackIndex % this.files.length];
    const filePath = path.join(this.musicDir, filename);
    this.fileBuffer = fs.readFileSync(filePath);
    this.bufferOffset = 0;

    const title = filename.replace(/\.mp3$/i, '');
    this.mount.updateMetadata(title, '');
    console.log(`Now playing: ${filename}`);
  }

  _tick() {
    if (!this.running) return;

    if (!this.fileBuffer || this.bufferOffset >= this.fileBuffer.length) {
      this.trackIndex++;
      this._loadTrack();
    }

    const end = Math.min(this.bufferOffset + this.chunkSize, this.fileBuffer.length);
    const chunk = this.fileBuffer.slice(this.bufferOffset, end);
    this.bufferOffset = end;
    this.bytesSent += chunk.length;

    this.mount.pushAudio(chunk);

    // Drift-corrected timing: calculate next tick based on total bytes sent
    const expectedTime = this.startTime + (this.bytesSent / (this.bitrate * 1000 / 8)) * 1000;
    const delay = Math.max(0, expectedTime - Date.now());
    this.timer = setTimeout(() => this._tick(), delay);
  }
}

module.exports = PlaylistSource;
