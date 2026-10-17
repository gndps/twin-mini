import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setJpegDpi } from '../app/src/dpi.js';

test('setJpegDpi patches the JFIF density', () => {
  const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const out = setJpegDpi(jfif, 1408);
  assert.equal(out[13], 1);
  assert.equal((out[14] << 8) | out[15], 1408);
  assert.equal((out[16] << 8) | out[17], 1408);
});

test('setJpegDpi leaves non-JFIF data untouched', () => {
  const raw = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(setJpegDpi(raw, 600), raw);
});
