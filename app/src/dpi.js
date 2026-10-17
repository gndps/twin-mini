// Stamp the physical resolution into the exported JPEG so it opens at its true print size.

/** Patch the JFIF APP0 density fields (canvas JPEGs always start with one). */
export function setJpegDpi(bytes, dpi) {
  const out = new Uint8Array(bytes);
  const isJfif = out[2] === 0xff && out[3] === 0xe0 &&
    String.fromCharCode(...out.subarray(6, 11)) === 'JFIF\0';
  if (!isJfif) return out;
  const d = Math.min(65535, Math.round(dpi));
  out[13] = 1; // dots per inch
  out[14] = d >> 8; out[15] = d & 0xff;
  out[16] = d >> 8; out[17] = d & 0xff;
  return out;
}
