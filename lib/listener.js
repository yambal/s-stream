const { buildIcyMetadata } = require('./metadata');

class Listener {
  constructor(req, res, mount, config) {
    this.req = req;
    this.res = res;
    this.mount = mount;
    this.config = config;
    this.wantsMetadata = req.headers['icy-metadata'] === '1';
    this.metaint = config.icyMetaint || 16000;
    this.bytesSinceMetadata = 0;
    this.writable = true;

    this._onAudio = this._onAudio.bind(this);
  }

  start() {
    const headers = this._buildHeaders();
    this.res.writeHead(200, headers);

    // Send burst data for immediate playback
    const burstSize = this.config.burstSize || 65536;
    const burst = this.mount.getBurstData(burstSize);
    if (burst.length > 0) {
      this._writeAudioWithMetadata(burst);
    }

    this.mount.on('audio', this._onAudio);
    this.mount.addListener(this);

    this.req.on('close', () => this.stop());
    this.res.on('error', () => this.stop());
    this.res.on('drain', () => { this.writable = true; });
  }

  stop() {
    this.mount.removeListener('audio', this._onAudio);
    this.mount.listeners.delete(this);
    if (!this.res.writableEnded) {
      this.res.end();
    }
    console.log(`[${new Date().toISOString()}] Listener disconnected from ${this.mount.path}`);
  }

  _onAudio(chunk) {
    if (!this.writable) return;
    this._writeAudioWithMetadata(chunk);
  }

  _writeAudioWithMetadata(chunk) {
    if (!this.wantsMetadata) {
      this.writable = this.res.write(chunk);
      this.mount.totalBytesSent += chunk.length;
      return;
    }

    let offset = 0;
    while (offset < chunk.length) {
      const untilMeta = this.metaint - this.bytesSinceMetadata;
      const audioBytes = Math.min(untilMeta, chunk.length - offset);

      const slice = chunk.slice(offset, offset + audioBytes);
      this.writable = this.res.write(slice);
      this.bytesSinceMetadata += audioBytes;
      this.mount.totalBytesSent += audioBytes;
      offset += audioBytes;

      if (this.bytesSinceMetadata >= this.metaint) {
        const metaBlock = buildIcyMetadata(this.mount.metadata);
        this.res.write(metaBlock);
        this.bytesSinceMetadata = 0;
      }

      if (!this.writable) break;
    }
  }

  _buildHeaders() {
    const h = {
      'Content-Type': this.mount.contentType || 'audio/mpeg',
      'icy-name': this.mount.name || '',
      'icy-genre': this.mount.genre || '',
      'icy-br': String(this.mount.bitrate || 128),
      'icy-pub': this.mount.isPublic ? '1' : '0',
      'icy-url': this.mount.url || '',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'close',
      'Access-Control-Allow-Origin': '*',
    };
    if (this.wantsMetadata) {
      h['icy-metaint'] = String(this.metaint);
    }
    return h;
  }
}

module.exports = Listener;
