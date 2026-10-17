// Stamp the physical resolution into exported files so they open at the right print size.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Insert (or replace) a pHYs chunk right after IHDR. */
export function setPngDpi(bytes, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));

  // Walk chunks; drop any existing pHYs.
  const parts = [bytes.subarray(0, 8)];
  let off = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off < bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    const end = off + 12 + len;
    if (type !== 'pHYs') parts.push(bytes.subarray(off, end));
    if (type === 'IHDR') parts.push(chunk);
    off = end;
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Patch the JFIF APP0 density fields (canvas JPEGs always start with one). */
export function setJpegDpi(bytes, dpi) {
  const out = new Uint8Array(bytes);
  const isJfif = out[2] === 0xff && out[3] === 0xe0 &&
    String.fromCharCode(...out.subarray(6, 11)) === 'JFIF\0';
  if (!isJfif) return out;
  out[13] = 1; // dots per inch
  out[14] = dpi >> 8; out[15] = dpi & 0xff;
  out[16] = dpi >> 8; out[17] = dpi & 0xff;
  return out;
}
