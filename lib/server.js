const http = require('http');
const { URL } = require('url');
const Listener = require('./listener');
const { handleSource, parseBasicAuth } = require('./source');
const Stats = require('./stats');

function addCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Icy-MetaData, Range, Accept, Authorization, Content-Type');
  res.setHeader('Access-Control-Expose-Headers',
    'icy-br, icy-genre, icy-name, icy-url, icy-pub, icy-metaint, Content-Type');
}

function createServer(mountManager, config) {
  const stats = new Stats(mountManager, config);

  const server = http.createServer((req, res) => {
    addCorsHeaders(res);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // Root - server info
    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(`s-stream is running\nMounts: ${mountManager.getMounts().map(m => m.path).join(', ')}`);
    }

    // Stats endpoint (Icecast compatible)
    if (pathname === '/status-json.xsl' || pathname === '/status.json') {
      return stats.handleRequest(req, res);
    }

    // Admin endpoints
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

    // GET - listener connection
    if (req.method === 'GET') {
      const mount = mountManager.getMount(pathname);
      if (!mount) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Mount not found');
      }

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

    res.writeHead(405);
    res.end('Method not allowed');
  });

  return server;
}

function handleAdmin(req, res, parsedUrl, mountManager, config) {
  // Admin auth required
  const creds = parseBasicAuth(req);
  if (!creds || creds.pass !== config.adminPassword) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Icecast Admin"',
      'Content-Type': 'text/plain',
    });
    return res.end('Authentication Required');
  }

  const pathname = parsedUrl.pathname;
  const params = parsedUrl.searchParams;

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
