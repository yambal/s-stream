const http = require('http');
const fs = require('fs');
const path = require('path');

const MP3_DIR = path.join(__dirname, 'music');
const PORT = process.env.PORT || 8000;

const BITRATE = 128;
const CHUNK_SIZE = 4096;
const INTERVAL = Math.floor((CHUNK_SIZE / (BITRATE * 1000 / 8)) * 1000);

const STREAM_HEADERS = {
  'Content-Type': 'audio/mpeg',
  'icy-name': 'ETS2 Radio',
  'icy-genre': 'Various',
  'icy-br': String(BITRATE),
  'icy-pub': '1',
  'Cache-Control': 'no-cache, no-store',
  'Pragma': 'no-cache',
  'Connection': 'keep-alive',
  'Accept-Ranges': 'none',
};

http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ETS2 Radio is running!');
  }

  if (req.url !== '/stream') {
    res.writeHead(404);
    return res.end('Not found');
  }

  // HEAD リクエストにはヘッダーだけ返す
  if (req.method === 'HEAD') {
    res.writeHead(200, STREAM_HEADERS);
    return res.end();
  }

  const files = fs.readdirSync(MP3_DIR).filter(f => f.endsWith('.mp3'));

  if (files.length === 0) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    return res.end('No MP3 files found');
  }

  console.log(`[${new Date().toISOString()}] Client connected: ${req.socket.remoteAddress}`);
  console.log(`Playlist: ${files.length} tracks`);

  res.writeHead(200, STREAM_HEADERS);

  let trackIndex = 0;
  let destroyed = false;
  let fileBuffer = null;
  let bufferOffset = 0;
  let timer = null;

  function loadTrack() {
    const file = path.join(MP3_DIR, files[trackIndex % files.length]);
    console.log(`Now playing: ${files[trackIndex % files.length]}`);
    fileBuffer = fs.readFileSync(file);
    bufferOffset = 0;
  }

  function sendChunk() {
    if (destroyed) return;

    if (!fileBuffer || bufferOffset >= fileBuffer.length) {
      trackIndex++;
      loadTrack();
    }

    const end = Math.min(bufferOffset + CHUNK_SIZE, fileBuffer.length);
    const chunk = fileBuffer.slice(bufferOffset, end);
    bufferOffset = end;

    const ok = res.write(chunk);
    if (!ok) {
      res.once('drain', () => {
        timer = setTimeout(sendChunk, INTERVAL);
      });
    } else {
      timer = setTimeout(sendChunk, INTERVAL);
    }
  }

  req.on('close', () => {
    destroyed = true;
    if (timer) clearTimeout(timer);
    console.log(`[${new Date().toISOString()}] Client disconnected`);
  });

  loadTrack();
  sendChunk();
}).listen(PORT, () => {
  const files = fs.readdirSync(MP3_DIR).filter(f => f.endsWith('.mp3'));
  console.log(`ETS2 Radio streaming on port ${PORT}`);
  console.log(`Found ${files.length} tracks in ${MP3_DIR}`);
  console.log(`Stream URL: http://localhost:${PORT}/stream`);
  console.log(`Throttle: ${BITRATE}kbps, ${CHUNK_SIZE}B every ${INTERVAL}ms`);
});