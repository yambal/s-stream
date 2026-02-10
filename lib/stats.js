class Stats {
  constructor(mountManager, config) {
    this.mountManager = mountManager;
    this.config = config;
    this.serverStart = new Date();
  }

  getJSON() {
    const mounts = this.mountManager.getMounts();
    const sources = mounts.map(mount => {
      const stats = mount.getStats();
      return {
        listenurl: `http://localhost:${this.config.port}${mount.path}`,
        server_name: mount.name || '',
        server_description: mount.description || '',
        server_type: mount.contentType || 'audio/mpeg',
        server_url: mount.url || '',
        genre: mount.genre || '',
        title: mount.metadata.StreamTitle || '',
        ice_bitrate: mount.bitrate || 128,
        audio_bitrate: (mount.bitrate || 128) * 1000,
        listeners: stats.listeners,
        listener_peak: stats.listenerPeak,
        total_bytes_read: stats.totalBytesReceived,
        total_bytes_sent: stats.totalBytesSent,
        stream_start_iso8601: stats.streamStartedAt
          ? stats.streamStartedAt.toISOString()
          : '',
        public: mount.isPublic ? 1 : 0,
      };
    });

    return {
      icestats: {
        admin: '',
        host: 'localhost',
        location: '',
        server_id: `s-stream/1.0.0`,
        server_start_iso8601: this.serverStart.toISOString(),
        source: sources.length === 1 ? sources[0] : sources,
      },
    };
  }

  handleRequest(req, res) {
    const json = JSON.stringify(this.getJSON(), null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(json);
  }
}

module.exports = Stats;
