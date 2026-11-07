// Decompresses legacy Workshop items off the main thread.
import { lzmaDecompress } from './lzma.js';

self.onmessage = (e) => {
  try {
    const out = lzmaDecompress(new Uint8Array(e.data.bytes));
    self.postMessage({ bytes: out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
};
