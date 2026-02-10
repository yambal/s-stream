const { buildIcyMetadata } = require('./metadata');

class Listener {
  constructor(req, res, mount, config) {
    this.req = req;
    this.res = res;
    this.socket = req.socket;
    this.mount = mount;
    this.config = config;
    this.wantsMetadata = req.headers['icy-metadata'] === '1';
    this.metaint = config.icyMetaint || 16000;
    this.bytesSinceMetadata = 0;
    this.queue = [];
    this.draining = false;
    this.stopped = false;

    this._onAudio = this._onAudio.bind(this);
  }

  start() {
    const socket = this.socket;

    // Disable socket timeout for long-lived stream
    socket.setTimeout(0);

    // Write HTTP/1.0 response directly to socket (Icecast-compatible)
    // This bypasses Node's HTTP/1.1 response which adds chunked encoding
    const headers = this._buildHeaders();
    let headerBlock = 'HTTP/1.0 200 OK\r\n';
    for (const [key, value] of Object.entries(headers)) {
      headerBlock += `${key}: ${value}\r\n`;
    }
    headerBlock += '\r\n';
    socket.write(headerBlock);

    // Detach socket from Node HTTP response to prevent interference
    if (typeof this.res.detachSocket === 'function') {
      this.res.detachSocket(socket);
    }

    // Send burst data for immediate playback
    const burstSize = this.config.burstSize || 262144;
    const burst = this.mount.getBurstData(burstSize);
    if (burst.length > 0) {
      this._writeAudioWithMetadata(burst);
    }

    this.mount.on('audio', this._onAudio);
    this.mount.addListener(this);

    socket.on('close', () => this.stop());
    socket.on('error', () => this.stop());
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.mount.removeListener('audio', this._onAudio);
    this.mount.listeners.delete(this);
    if (!this.socket.destroyed) {
      this.socket.end();
    }
    console.log(`[${new Date().toISOString()}] Listener disconnected from ${this.mount.path}`);
  }

  _onAudio(chunk) {
    if (this.stopped) return;
    // Buffer up to 512KB to absorb backpressure, drop oldest if exceeded
    this.queue.push(chunk);
    const maxQueueBytes = 524288;
    let queueSize = 0;
    for (const c of this.queue) queueSize += c.length;
    while (queueSize > maxQueueBytes && this.queue.length > 1) {
      queueSize -= this.queue.shift().length;
    }
    this._flush();
  }

  _flush() {
    if (this.draining || this.stopped) return;
    while (this.queue.length > 0) {
      const chunk = this.queue.shift();
      const ok = this._writeAudioWithMetadata(chunk);
      if (!ok) {
        this.draining = true;
        this.socket.once('drain', () => {
          this.draining = false;
          this._flush();
        });
        return;
      }
    }
  }

  _writeAudioWithMetadata(chunk) {
    if (!this.wantsMetadata) {
      const ok = this.socket.write(chunk);
      this.mount.totalBytesSent += chunk.length;
      return ok;
    }

    let ok = true;
    let offset = 0;
    while (offset < chunk.length) {
      const untilMeta = this.metaint - this.bytesSinceMetadata;
      const audioBytes = Math.min(untilMeta, chunk.length - offset);

      const slice = chunk.slice(offset, offset + audioBytes);
      ok = this.socket.write(slice);
      this.bytesSinceMetadata += audioBytes;
      this.mount.totalBytesSent += audioBytes;
      offset += audioBytes;

      if (this.bytesSinceMetadata >= this.metaint) {
        const metaBlock = buildIcyMetadata(this.mount.metadata);
        this.socket.write(metaBlock);
        this.bytesSinceMetadata = 0;
      }
    }
    return ok;
  }

  _buildHeaders() {
    const h = {
      'Server': 'Icecast 2.4.4',
      'Connection': 'Close',
      'Date': new Date().toUTCString(),
      'Content-Type': this.mount.contentType || 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store',
      'Expires': 'Mon, 26 Jul 1997 05:00:00 GMT',
      'Pragma': 'no-cache',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
      'icy-br': String(this.mount.bitrate || 128),
      'ice-audio-info': `bitrate=${this.mount.bitrate || 128}`,
      'icy-description': this.mount.description || this.mount.name || '',
      'icy-genre': this.mount.genre || '',
      'icy-name': this.mount.name || '',
      'icy-pub': this.mount.isPublic ? '1' : '0',
      'icy-url': this.mount.url || '',
    };
    if (this.wantsMetadata) {
      h['icy-metaint'] = String(this.metaint);
    }
    return h;
  }
}

module.exports = Listener;
