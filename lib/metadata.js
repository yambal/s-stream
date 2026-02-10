function buildIcyMetadata(metadata) {
  let text = '';
  if (metadata.StreamTitle) {
    text += `StreamTitle='${metadata.StreamTitle.replace(/'/g, "\\'")}';`;
  }
  if (metadata.StreamUrl) {
    text += `StreamUrl='${metadata.StreamUrl}';`;
  }

  if (text.length === 0) {
    return Buffer.alloc(1, 0);
  }

  const len = Math.ceil(text.length / 16);
  const buf = Buffer.alloc(1 + len * 16, 0);
  buf[0] = len;
  buf.write(text, 1, 'utf-8');
  return buf;
}

function parseIcyMetadata(buf) {
  const len = buf[0] * 16;
  if (len === 0) return {};
  const text = buf.slice(1, 1 + len).toString('utf-8').replace(/\0+$/, '');
  const result = {};
  const regex = /(\w+)='((?:[^'\\]|\\.)*)';/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

module.exports = { buildIcyMetadata, parseIcyMetadata };
