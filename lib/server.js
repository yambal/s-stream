const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const Listener = require('./listener');
const { handleSource, parseBasicAuth } = require('./source');
const RelaySource = require('./relay');
const Stats = require('./stats');

const STATIC_DIR = path.join(__dirname, '..', 'client', 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(res, filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
    return true;
  } catch (_) {
    return false;
  }
}

function serveIndex(res) {
  const indexPath = path.join(STATIC_DIR, 'index.html');
  if (!serveStatic(res, indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('s-stream is running');
  }
}

function addCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Icy-MetaData, Range, Accept, Authorization, Content-Type');
  res.setHeader('Access-Control-Expose-Headers',
    'icy-br, icy-genre, icy-name, icy-url, icy-pub, icy-metaint, Content-Type');
}

function createServer(mountManager, config) {
  const stats = new Stats(mountManager, config);

  const server = http.createServer((req, res) => {
    addCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // Stats endpoint (Icecast compatible)
    if (pathname === '/status-json.xsl' || pathname === '/status.json') {
      return stats.handleRequest(req, res);
    }

    // Admin API
    if (pathname.startsWith('/admin/')) {
      return handleAdmin(req, res, parsedUrl, mountManager, config);
    }

    // Source client (PUT or SOURCE method)
    if (req.method === 'PUT' || req.method === 'SOURCE') {
      const mount = mountManager.getOrCreateMount(pathname, {
        name: req.headers['ice-name'] || pathname.slice(1),
        genre: req.headers['ice-genre'] || '',
        bitrate: parseInt(req.headers['ice-bitrate'], 10) || 128,
      });
      return handleSource(req, res, mount, config);
    }

    // HEAD request - return stream headers
    if (req.method === 'HEAD') {
      const mount = mountManager.getMount(pathname);
      if (!mount) {
        res.writeHead(404);
        return res.end();
      }
      const headers = {
        'Content-Type': mount.contentType || 'audio/mpeg',
        'icy-name': mount.name || '',
        'icy-genre': mount.genre || '',
        'icy-br': String(mount.bitrate || 128),
        'icy-pub': mount.isPublic ? '1' : '0',
        'Cache-Control': 'no-cache, no-store',
      };
      if (req.headers['icy-metadata'] === '1') {
        headers['icy-metaint'] = String(config.icyMetaint || 16000);
      }
      res.writeHead(200, headers);
      return res.end();
    }

    // GET requests
    if (req.method === 'GET') {
      // Stream mount
      const mount = mountManager.getMount(pathname);
      if (mount) {
        if (!mount.source) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('No source on mount');
        }
        if (mount.listeners.size >= mount.maxListeners) {
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          return res.end('Too many listeners');
        }
        console.log(`[${new Date().toISOString()}] Listener connected to ${pathname} from ${req.socket.remoteAddress}`);
        const listener = new Listener(req, res, mount, config);
        listener.start();
        return;
      }

      // Static files from client/dist
      if (pathname === '/') {
        return serveIndex(res);
      }

      const staticPath = path.join(STATIC_DIR, pathname);
      // Prevent directory traversal
      if (staticPath.startsWith(STATIC_DIR) && serveStatic(res, staticPath)) {
        return;
      }

      // SPA fallback - serve index.html for unknown routes
      return serveIndex(res);
    }

    res.writeHead(405);
    res.end('Method not allowed');
  });

  return server;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function handleAdmin(req, res, parsedUrl, mountManager, config) {
  const pathname = parsedUrl.pathname;
  const params = parsedUrl.searchParams;

  // /admin/status is public (no auth for the management UI to poll)
  if (pathname === '/admin/status' && req.method === 'GET') {
    const mounts = mountManager.getMounts().map(m => ({
      path: m.path,
      listeners: m.listeners.size,
      listenerPeak: m.listenerPeak,
      sourceType: m.source ? (m.source.type || 'playlist') : 'none',
      sourceUrl: m.source && m.source.url ? m.source.url : null,
      title: m.metadata.StreamTitle,
      name: m.name,
      genre: m.genre,
      bitrate: m.bitrate,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ mounts }));
  }

  // All other admin endpoints require auth
  const creds = parseBasicAuth(req);
  if (!creds || creds.pass !== config.adminPassword) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Icecast Admin"',
      'Content-Type': 'text/plain',
    });
    return res.end('Authentication Required');
  }

  // POST /admin/source - switch source
  if (pathname === '/admin/source' && req.method === 'POST') {
    readBody(req).then((body) => {
      const mountPath = body.mount || '/stream';
      const mount = mountManager.getMount(mountPath);
      if (!mount) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Mount not found' }));
      }

      // Stop current source
      if (mount.source && typeof mount.source.stop === 'function') {
        mount.source.stop();
      }

      if (body.type === 'relay' && body.url) {
        const relay = new RelaySource(mount, { url: body.url });
        mount.setSource(relay);
        relay.start();

        // If relay fails, fall back to playlist
        mount.once('relay-failed', () => {
          const PlaylistSource = require('./playlist');
          const mountConfig = config.mounts.find(m => m.path === mountPath) || {};
          const playlist = new PlaylistSource(mount, mountConfig);
          mount.setSource(playlist);
          playlist.start();
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, source: 'relay', url: body.url }));
      } else {
        // Switch back to playlist
        const PlaylistSource = require('./playlist');
        const mountConfig = config.mounts.find(m => m.path === mountPath) || {};
        const playlist = new PlaylistSource(mount, mountConfig);
        mount.setSource(playlist);
        playlist.start();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, source: 'playlist' }));
      }
    }).catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    });
    return;
  }

  if (pathname === '/admin/metadata') {
    const mountPath = params.get('mount');
    const song = params.get('song') || '';
    const mount = mountManager.getMount(mountPath);
    if (!mount) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Mount not found');
    }
    mount.updateMetadata(song, '');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('Metadata updated');
  }

  if (pathname === '/admin/listmounts') {
    const mounts = mountManager.getMounts().map(m => ({
      path: m.path,
      listeners: m.listeners.size,
      source: m.source ? (m.source.type || 'playlist') : 'none',
      title: m.metadata.StreamTitle,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(mounts, null, 2));
  }

  if (pathname === '/admin/killsource') {
    const mountPath = params.get('mount');
    const mount = mountManager.getMount(mountPath);
    if (!mount) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Mount not found');
    }
    if (mount.source && mount.source.req) {
      mount.source.req.destroy();
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('Source killed');
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Unknown admin command');
}

module.exports = { createServer };
