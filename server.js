const net = require('net');
const fs = require('fs');
const path = require('path');

const MP3_DIR = path.join(__dirname, 'music');
const PORT = process.env.PORT || 8000;

const BITRATE = 128;
const CHUNK_SIZE = 4096;
const INTERVAL = Math.floor((CHUNK_SIZE / (BITRATE * 1000 / 8)) * 1000);

// ICYメタデータ間隔 (バイト数)
const ICY_METAINT = 16000;

function buildIcyMetadata(title) {
  const text = `StreamTitle='${title}';`;
  const len = Math.ceil(text.length / 16);
  const buf = Buffer.alloc(1 + len * 16, 0);
  buf[0] = len;
  buf.write(text, 1);
  return buf;
}

const server = net.createServer((socket) => {
  let requestData = '';

  socket.once('readable', () => {
    // HTTPリクエストを読み取る
    const chunk = socket.read();
    if (!chunk) return socket.destroy();
    requestData = chunk.toString();

    const lines = requestData.split('\r\n');
    const requestLine = lines[0] || '';
    const urlMatch = requestLine.match(/^GET\s+(\S+)/);
    const url = urlMatch ? urlMatch[1] : '/';

    // ヘッダーからIcy-MetaData確認
    const wantsMetadata = /icy-metadata:\s*1/i.test(requestData);

    if (url === '/') {
      socket.write('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nETS2 Radio is running!\r\n');
      socket.end();
      return;
    }

    if (url !== '/stream') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\nNot found\r\n');
      socket.end();
      return;
    }

    const files = fs.readdirSync(MP3_DIR).filter(f => f.endsWith('.mp3'));
    if (files.length === 0) {
      socket.write('HTTP/1.1 500 Error\r\n\r\nNo MP3 files\r\n');
      socket.end();
      return;
    }

    console.log(`[${new Date().toISOString()}] Client connected (metadata: ${wantsMetadata})`);

    // ICY互換レスポンスヘッダー
    let headers = 'ICY 200 OK\r\n';
    headers += 'Content-Type: audio/mpeg\r\n';
    headers += 'icy-name: ETS2 Radio\r\n';
    headers += 'icy-genre: Various\r\n';
    headers += `icy-br: ${BITRATE}\r\n`;
    headers += 'icy-pub: 1\r\n';
    headers += 'icy-url: https://s-stream.onrender.com\r\n';
    if (wantsMetadata) {
      headers += `icy-metaint: ${ICY_METAINT}\r\n`;
    }
    headers += 'Cache-Control: no-cache\r\n';
    headers += 'Connection: close\r\n';
    headers += '\r\n';

    socket.write(headers);

    let trackIndex = 0;
    let destroyed = false;
    let fileBuffer = null;
    let bufferOffset = 0;
    let timer = null;
    let bytesSinceMetadata = 0;

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

      if (wantsMetadata) {
        // メタデータ挿入を考慮してチャンク送出
        const remaining = ICY_METAINT - bytesSinceMetadata;
        const sendSize = Math.min(remaining, CHUNK_SIZE, fileBuffer.length - bufferOffset);
        const chunk = fileBuffer.slice(bufferOffset, bufferOffset + sendSize);
        bufferOffset += sendSize;
        bytesSinceMetadata += sendSize;

        socket.write(chunk);

        if (bytesSinceMetadata >= ICY_METAINT) {
          const trackName = files[(trackIndex) % files.length].replace('.mp3', '');
          socket.write(buildIcyMetadata(trackName));
          bytesSinceMetadata = 0;
        }
      } else {
        const end = Math.min(bufferOffset + CHUNK_SIZE, fileBuffer.length);
        const chunk = fileBuffer.slice(bufferOffset, end);
        bufferOffset = end;
        socket.write(chunk);
      }

      timer = setTimeout(sendChunk, INTERVAL);
    }

    socket.on('close', () => {
      destroyed = true;
      if (timer) clearTimeout(timer);
      console.log(`[${new Date().toISOString()}] Client disconnected`);
    });

    socket.on('error', () => {
      destroyed = true;
      if (timer) clearTimeout(timer);
    });

    loadTrack();
    sendChunk();
  });
});

server.listen(PORT, () => {
  const files = fs.readdirSync(MP3_DIR).filter(f => f.endsWith('.mp3'));
  console.log(`ETS2 Radio (ICY) streaming on port ${PORT}`);
  console.log(`Found ${files.length} tracks in ${MP3_DIR}`);
  console.log(`Stream URL: http://localhost:${PORT}/stream`);
});