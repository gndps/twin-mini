import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setPngDpi, setJpegDpi, crc32 } from '../app/src/dpi.js';

// Minimal 1×1 PNG.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

test('crc32 of "IEND" matches the PNG spec constant', () => {
  assert.equal(crc32(new TextEncoder().encode('IEND')), 0xae426082);
});

test('setPngDpi inserts one valid pHYs chunk after IHDR', () => {
  const out = setPngDpi(PNG, 600);
  const twice = setPngDpi(out, 300);
  for (const [buf, dpi] of [[out, 600], [twice, 300]]) {
    const dv = new DataView(buf.buffer);
    const at = 8 + 12 + 13; // after signature + IHDR
    assert.equal(String.fromCharCode(...buf.subarray(at + 4, at + 8)), 'pHYs');
    assert.equal(dv.getUint32(at + 8), Math.round(dpi / 0.0254));
    assert.equal(dv.getUint32(at + 17), crc32(buf.subarray(at + 4, at + 17)));
    assert.equal(buf.length, PNG.length + 21);
  }
});

test('setJpegDpi patches the JFIF density', () => {
  const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const out = setJpegDpi(jfif, 813);
  assert.equal(out[13], 1);
  assert.equal((out[14] << 8) | out[15], 813);
  assert.equal((out[16] << 8) | out[17], 813);
});
