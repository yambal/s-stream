const http = require('http');
const fs = require('fs');
const path = require('path');

const MP3_DIR = path.join(__dirname, 'music');
const PORT = process.env.PORT || 8000;

http.createServer((req, res) => {
  // ヘルスチェック用
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
  console.log(`Playlist: ${files.length} tracks`);

  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'icy-name': 'ETS2 Radio',
    'icy-genre': 'Various',
    'icy-br': '128',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  let trackIndex = 0;
  let destroyed = false;

  function playNext() {
    if (destroyed) return;

    const file = path.join(MP3_DIR, files[trackIndex % files.length]);
    console.log(`Now playing: ${files[trackIndex % files.length]}`);

    const stream = fs.createReadStream(file);

    stream.on('data', (chunk) => {
      if (destroyed) {
        stream.destroy();
        return;
      }
      res.write(chunk);
    });

    stream.on('end', () => {
      trackIndex++;
      playNext();
    });

    stream.on('error', (err) => {
      console.error(`Error reading file: ${err.message}`);
      trackIndex++;
      if (!destroyed) playNext();
    });
  }

  req.on('close', () => {
    destroyed = true;
    console.log(`[${new Date().toISOString()}] Client disconnected`);
  });

  playNext();
}).listen(PORT, () => {
  const files = fs.readdirSync(MP3_DIR).filter(f => f.endsWith('.mp3'));
  console.log(`ETS2 Radio streaming on port ${PORT}`);
  console.log(`Found ${files.length} tracks in ${MP3_DIR}`);
  console.log(`Stream URL: http://localhost:${PORT}/stream`);
});