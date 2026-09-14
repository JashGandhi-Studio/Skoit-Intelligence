/**
 * Digest helpers. SHA-1/256/512 come from WebCrypto (identical in Node 20+
 * and every modern browser); MD5 is a compact RFC 1321 implementation because
 * WebCrypto deliberately does not expose it and public services (Gravatar,
 * legacy file intel) still key on it.
 */

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

async function subtleDigest(algorithm: string, data: Uint8Array): Promise<string> {
  const view = new Uint8Array(data.length);
  view.set(data);
  const digest = await crypto.subtle.digest(algorithm, view);
  return toHex(new Uint8Array(digest));
}

export function sha1(data: Uint8Array | string): Promise<string> {
  return subtleDigest("SHA-1", encode(data));
}

export function sha256(data: Uint8Array | string): Promise<string> {
  return subtleDigest("SHA-256", encode(data));
}

export function sha512(data: Uint8Array | string): Promise<string> {
  return subtleDigest("SHA-512", encode(data));
}

function encode(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

/* ------------------------------- MD5 ---------------------------------- */

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20,
  5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}

export function md5(data: Uint8Array | string): string {
  const input = encode(data);
  const bitLength = input.length * 8;
  const paddedLength = (((input.length + 8) >> 6) + 1) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(input);
  buffer[input.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    const words = new Uint32Array(16);
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(chunk + i * 4, true);
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + MD5_K[i] + words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << MD5_SHIFTS[i]) | (f >>> (32 - MD5_SHIFTS[i])))) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((word, index) => {
    outView.setUint32(index * 4, word, true);
  });
  return toHex(out);
}

/* ---------------------------- entropy ---------------------------------- */

export function shannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) {
    return 0;
  }
  const counts = new Uint32Array(256);
  for (const byte of bytes) {
    counts[byte] += 1;
  }
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) {
      continue;
    }
    const p = count / bytes.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function bufferToHex(buffer: Uint8Array): string {
  return toHex(buffer);
}
