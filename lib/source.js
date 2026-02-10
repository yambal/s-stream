function parseBasicAuth(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) return null;
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const colon = decoded.indexOf(':');
  if (colon === -1) return null;
  return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
}

function handleSource(req, res, mount, config) {
  const contentType = req.headers['content-type'];
  if (!contentType) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('No Content-Type given');
  }

  const creds = parseBasicAuth(req);
  if (!creds || creds.pass !== config.sourcePassword) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Icecast"',
      'Content-Type': 'text/plain',
    });
    return res.end('Authentication Required');
  }

  // Check if mount already has a live source
  if (mount.source && mount.source.type === 'live') {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Mountpoint in use');
  }

  // Pause playlist source if present
  const previousSource = mount.source;
  if (previousSource && typeof previousSource.pause === 'function') {
    previousSource.pause();
  }

  // Extract stream metadata from headers
  if (req.headers['ice-name']) mount.name = req.headers['ice-name'];
  if (req.headers['ice-genre']) mount.genre = req.headers['ice-genre'];
  if (req.headers['ice-bitrate']) mount.bitrate = parseInt(req.headers['ice-bitrate'], 10);
  if (req.headers['ice-url']) mount.url = req.headers['ice-url'];
  if (req.headers['ice-public']) mount.isPublic = req.headers['ice-public'] === '1';

  mount.contentType = contentType;
  mount.setSource({ type: 'live', req });

  console.log(`[${new Date().toISOString()}] Source connected to ${mount.path} (${contentType})`);

  // Send 200 OK (Icecast sends 200, not 100-continue for SOURCE)
  res.writeHead(200, { 'Content-Type': 'text/plain' });

  let lastDataTime = Date.now();

  req.on('data', (chunk) => {
    lastDataTime = Date.now();
    mount.pushAudio(chunk);
  });

  const cleanup = () => {
    mount.removeSource();
    console.log(`[${new Date().toISOString()}] Source disconnected from ${mount.path}`);
    // Resume playlist if available
    if (previousSource && typeof previousSource.resume === 'function') {
      previousSource.resume();
      mount.setSource(previousSource);
    }
    if (!res.writableEnded) res.end();
  };

  req.on('end', cleanup);
  req.on('close', cleanup);
  req.on('error', cleanup);

  // Timeout for silent sources
  const timeoutCheck = setInterval(() => {
    if (Date.now() - lastDataTime > (config.connectionTimeout || 10000)) {
      console.log(`Source timeout on ${mount.path}`);
      clearInterval(timeoutCheck);
      req.destroy();
    }
  }, 5000);

  req.on('close', () => clearInterval(timeoutCheck));
}

module.exports = { handleSource, parseBasicAuth };
