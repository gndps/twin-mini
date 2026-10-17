// Minimal EXIF reader: just the capture date of a JPEG (DateTimeOriginal, else DateTime).

/** @param {ArrayBuffer} buf the first ~128 KB of the file @returns {Date|null} */
export function readExifDate(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // start of scan: no more metadata
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966) { // "Exif"
      return readTiff(v, off + 10, Math.min(v.byteLength, off + 2 + len));
    }
    off += 2 + len;
  }
  return null;
}

function readTiff(v, base, end) {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o) => v.getUint16(o, le);
  const u32 = (o) => v.getUint32(o, le);
  if (u16(base + 2) !== 42) return null;
  const entries = (ifd) => {
    const at = base + ifd;
    if (at + 2 > end) return [];
    const n = u16(at);
    return Array.from({ length: n }, (_, k) => at + 2 + k * 12).filter((e) => e + 12 <= end)
      .map((e) => ({ tag: u16(e), count: u32(e + 4), valueOff: e + 8 }));
  };
  const ascii = (ent) => {
    const o = ent.count > 4 ? base + u32(ent.valueOff) : ent.valueOff;
    if (o + ent.count > end) return null;
    let s = '';
    for (let i = 0; i < ent.count; i++) { const c = v.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); }
    return s;
  };
  const ifd0 = entries(u32(base + 4));
  let found = null;
  const exifPtr = ifd0.find((e) => e.tag === 0x8769);
  if (exifPtr) {
    const sub = entries(u32(exifPtr.valueOff));
    const dto = sub.find((e) => e.tag === 0x9003) || sub.find((e) => e.tag === 0x9004);
    if (dto) found = ascii(dto);
  }
  if (!found) { const dt = ifd0.find((e) => e.tag === 0x0132); if (dt) found = ascii(dt); }
  return parseExifDate(found);
}

export function parseExifDate(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
  if (!m || m[1] === '0000') return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) ? null : d;
}
