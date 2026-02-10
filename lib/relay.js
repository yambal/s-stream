const http = require('http');
const https = require('https');

class RelaySource {
  constructor(mount, options = {}) {
    this.mount = mount;
    this.url = options.url;
    this.type = 'relay';
    this.running = false;
    this.req = null;
    this.retryTimer = null;
    this.retryCount = 0;
    this.maxRetries = 5;
  }

  start() {
    this.running = true;
    this.retryCount = 0;
    this._connect();
  }

  stop() {
    this.running = false;
    if (this.req) {
      this.req.destroy();
      this.req = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  pause() {
    this.stop();
  }

  resume() {
    if (!this.running) {
      this.start();
    }
  }

  _connect() {
    if (!this.running) return;

    const client = this.url.startsWith('https') ? https : http;

    console.log(`[Relay] Connecting to ${this.url}`);

    this.req = client.get(this.url, { headers: { 'Icy-MetaData': '1' } }, (res) => {
      if (res.statusCode !== 200) {
        console.error(`[Relay] HTTP ${res.statusCode} from ${this.url}`);
        res.resume();
        this._retry();
        return;
      }

      this.retryCount = 0;
      const metaint = parseInt(res.headers['icy-metaint'], 10) || 0;

      // Update mount info from relay headers
      if (res.headers['icy-name']) this.mount.name = res.headers['icy-name'];
      if (res.headers['icy-genre']) this.mount.genre = res.headers['icy-genre'];

      console.log(`[Relay] Connected to ${this.url} (metaint: ${metaint})`);

      if (metaint > 0) {
        this._readWithMetadata(res, metaint);
      } else {
        res.on('data', (chunk) => {
          if (this.running) this.mount.pushAudio(chunk);
        });
      }

      res.on('end', () => {
        console.log('[Relay] Stream ended');
        this._retry();
      });

      res.on('error', (err) => {
        console.error(`[Relay] Stream error: ${err.message}`);
        this._retry();
      });
    });

    this.req.on('error', (err) => {
      console.error(`[Relay] Connection error: ${err.message}`);
      this._retry();
    });

    this.req.setTimeout(10000, () => {
      console.error('[Relay] Connection timeout');
      this.req.destroy();
      this._retry();
    });
  }

  _readWithMetadata(res, metaint) {
    let audioBytes = 0;
    let metaRemaining = 0;
    let metaSize = 0;
    let metaBuf = null;
    let metaOffset = 0;
    let inMeta = false;

    res.on('data', (data) => {
      if (!this.running) return;

      let offset = 0;
      while (offset < data.length) {
        if (inMeta) {
          if (metaSize === 0) {
            // Read length byte
            metaSize = data[offset] * 16;
            offset++;
            if (metaSize === 0) {
              inMeta = false;
              audioBytes = 0;
              continue;
            }
            metaBuf = Buffer.alloc(metaSize);
            metaOffset = 0;
            metaRemaining = metaSize;
          } else {
            const toCopy = Math.min(metaRemaining, data.length - offset);
            data.copy(metaBuf, metaOffset, offset, offset + toCopy);
            metaOffset += toCopy;
            metaRemaining -= toCopy;
            offset += toCopy;

            if (metaRemaining === 0) {
              // Parse metadata
              const text = metaBuf.toString('utf-8').replace(/\0+$/, '');
              const match = text.match(/StreamTitle='((?:[^'\\]|\\.)*)'/);
              if (match) {
                this.mount.updateMetadata(match[1], '');
              }
              inMeta = false;
              metaSize = 0;
              audioBytes = 0;
            }
          }
        } else {
          const untilMeta = metaint - audioBytes;
          const audioLen = Math.min(untilMeta, data.length - offset);
          const chunk = data.slice(offset, offset + audioLen);
          this.mount.pushAudio(chunk);
          audioBytes += audioLen;
          offset += audioLen;

          if (audioBytes >= metaint) {
            inMeta = true;
            metaSize = 0;
          }
        }
      }
    });
  }

  _retry() {
    if (!this.running) return;
    this.retryCount++;
    if (this.retryCount > this.maxRetries) {
      console.error(`[Relay] Max retries reached, giving up`);
      this.running = false;
      this.mount.emit('relay-failed');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
    console.log(`[Relay] Retrying in ${delay}ms (${this.retryCount}/${this.maxRetries})`);
    this.retryTimer = setTimeout(() => this._connect(), delay);
  }
}

module.exports = RelaySource;
