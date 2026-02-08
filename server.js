const http = require('http');
const fs = require('fs');
const path = require('path');

const MP3_DIR = path.join(__dirname, 'music');
const PORT = process.env.PORT || 8000;

// ビットレート (kbps) — MP3ファイルに合わせて調整
const BITRATE = 128;
// 1回に送るチャンクサイズ (bytes)
const CHUNK_SIZE = 4096;
// チャンク送出間隔 (ms) = チャンクサイズ / (ビットレート / 8) * 1000
const INTERVAL = Math.floor((CHUNK_SIZE / (BITRATE * 1000 / 8)) * 1000);

http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ETS2 Radio is running!');
  }

  if (req.url !== '/stream') {
    res.writeHead(404);
    return res.end('Not found');
  }

  const files = fs.readdirSync(MP3_DIR).filter(f => f.endsWith('.mp3'));

  if (files.length === 0) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    return res.end('No MP3 files found in music directory');
  }

  console.log(`[${new Date().toISOString()}] Client connected: ${req.socket.remoteAddress}`);
  console.log(`Playlist: ${files.length} tracks, ${BITRATE}kbps, chunk ${CHUNK_SIZE}B every ${INTERVAL}ms`);

  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'icy-name': 'ETS2 Radio',
    'icy-genre': 'Various',
    'icy-br': String(BITRATE),
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked',
  });

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

    // 現在のトラックが終わったら次へ
    if (!fileBuffer || bufferOffset >= fileBuffer.length) {
      trackIndex++;
      loadTrack();
    }

    const end = Math.min(bufferOffset + CHUNK_SIZE, fileBuffer.length);
    const chunk = fileBuffer.slice(bufferOffset, end);
    bufferOffset = end;

    const ok = res.write(chunk);
    if (!ok) {
      // backpressure: drain待ち
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
  console.log(`Throttle: ${BITRATE}kbps, ${CHUNK_SIZE}B chunks every ${INTERVAL}ms`);
});