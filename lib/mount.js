const { EventEmitter } = require('events');

class Mount extends EventEmitter {
  constructor(mountPath, options = {}) {
    super();
    this.path = mountPath;
    this.name = options.name || '';
    this.genre = options.genre || '';
    this.bitrate = options.bitrate || 128;
    this.contentType = options.contentType || 'audio/mpeg';
    this.isPublic = options.isPublic !== false;
    this.url = options.url || '';
    this.description = options.description || '';
    this.maxListeners = options.maxListenersPerMount || 100;

    this.source = null;
    this.listeners = new Set();
    this.metadata = { StreamTitle: '', StreamUrl: '' };

    // Ring buffer
    const bufSize = options.bufferSize || 524288;
    this.buffer = Buffer.alloc(bufSize);
    this.bufferWritePos = 0;
    this.bufferLength = 0;

    // Stats
    this.listenerPeak = 0;
    this.totalBytesSent = 0;
    this.totalBytesReceived = 0;
    this.streamStartedAt = null;
  }

  pushAudio(chunk) {
    const buf = this.buffer;
    const size = buf.length;
    let offset = 0;

    while (offset < chunk.length) {
      const writeIdx = this.bufferWritePos % size;
      const space = size - writeIdx;
      const toWrite = Math.min(space, chunk.length - offset);
      chunk.copy(buf, writeIdx, offset, offset + toWrite);
      offset += toWrite;
      this.bufferWritePos += toWrite;
    }

    this.bufferLength = Math.min(this.bufferLength + chunk.length, size);
    this.totalBytesReceived += chunk.length;
    this.emit('audio', chunk);
  }

  getBurstData(burstSize) {
    const available = Math.min(burstSize, this.bufferLength);
    if (available === 0) return Buffer.alloc(0);

    const result = Buffer.alloc(available);
    const bufSize = this.buffer.length;
    const startPos = this.bufferWritePos - available;

    let readIdx = ((startPos % bufSize) + bufSize) % bufSize;
    let written = 0;

    while (written < available) {
      const toRead = Math.min(bufSize - readIdx, available - written);
      this.buffer.copy(result, written, readIdx, readIdx + toRead);
      written += toRead;
      readIdx = 0;
    }

    return result;
  }

  setSource(source) {
    this.source = source;
    this.streamStartedAt = new Date();
  }

  removeSource() {
    this.source = null;
    this.emit('source-disconnect');
  }

  addListener(listener) {
    this.listeners.add(listener);
    if (this.listeners.size > this.listenerPeak) {
      this.listenerPeak = this.listeners.size;
    }
  }

  removeListener(listener) {
    // EventEmitter also has removeListener, only remove from Set if it's our Listener object
    if (typeof listener === 'object' && this.listeners.has(listener)) {
      this.listeners.delete(listener);
    } else {
      super.removeListener(...arguments);
    }
  }

  updateMetadata(title, url) {
    this.metadata = {
      StreamTitle: title || '',
      StreamUrl: url || '',
    };
    this.emit('metadata', this.metadata);
  }

  getStats() {
    return {
      listeners: this.listeners.size,
      listenerPeak: this.listenerPeak,
      totalBytesReceived: this.totalBytesReceived,
      totalBytesSent: this.totalBytesSent,
      streamStartedAt: this.streamStartedAt,
    };
  }
}

module.exports = Mount;
