/**
 * Format validators that actually verify checksums instead of guessing from
 * shapes: Base58Check/Bech32 for crypto addresses, mod-97 for IBAN,
 * Verhoeff for Indian Aadhaar, Luhn for card-like numbers (masked only).
 */

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(value: string): Uint8Array | null {
  if (!value) {
    return null;
  }
  const bytes: number[] = [0];
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) {
      return null;
    }
    let carry = index;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== "1") {
      break;
    }
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/** Bitcoin/legacy-format address check with a real SHA-256/Base58Check verify. */
export async function verifyBase58Check(
  value: string,
): Promise<{ valid: boolean; version: number | null; payloadHex?: string }> {
  const decoded = base58Decode(value);
  if (!decoded || decoded.length < 5) {
    return { valid: false, version: null };
  }
  const payload = decoded.slice(0, -4);
  const checksum = decoded.slice(-4);
  const digest = await crypto.subtle.digest("SHA-256", payload.slice());
  const first = new Uint8Array(digest);
  const second = new Uint8Array(await crypto.subtle.digest("SHA-256", first));
  const expected = second.slice(0, 4);
  const valid = expected.every((byte, index) => byte === checksum[index]);
  return {
    valid,
    version: payload[0] ?? null,
    payloadHex: valid ? bytesToHex(payload) : undefined,
  };
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export function verifyBech32(value: string): { valid: boolean; prefix?: string } {
  const lower = value.toLowerCase();
  if (lower !== value && value.toUpperCase() !== value) {
    return { valid: false };
  }
  const separator = lower.lastIndexOf("1");
  if (separator < 1 || separator + 7 > lower.length) {
    return { valid: false };
  }
  const prefix = lower.slice(0, separator);
  const dataPart = lower.slice(separator + 1);
  const data: number[] = [];
  for (const char of dataPart) {
    const index = BECH32_CHARSET.indexOf(char);
    if (index === -1) {
      return { valid: false };
    }
    data.push(index);
  }
  const expanded = [prefix.charCodeAt(0) & 0x1f];
  for (let i = 1; i < prefix.length; i += 1) {
    expanded.push(prefix.charCodeAt(i) >> 5, prefix.charCodeAt(i) & 0x1f);
  }
  expanded.push(0, ...data);
  let checksum = 1;
  for (const byte of expanded) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ byte;
    for (let i = 0; i < 5; i += 1) {
      checksum ^=
        (top >> (4 - i)) & 1
          ? [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][i]
          : 0;
    }
  }
  return { valid: checksum === 1, prefix };
}

export function verifyIban(value: string): { valid: boolean; country?: string } {
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) {
    return { valid: false };
  }
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    const chunk = code >= 65 && code <= 90 ? String(code - 55) : char;
    for (const digit of chunk) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return { valid: remainder === 1, country: iban.slice(0, 2) };
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Verhoeff checksum — the algorithm UIDAI uses for Aadhaar numbers. */
export function verifyVerhoeff(digits: string): boolean {
  if (!/^\d+$/.test(digits)) {
    return false;
  }
  let checksum = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    checksum = VERHOEFF_D[checksum][VERHOEFF_P[i % 8][Number(reversed[i])]];
  }
  return checksum === 0;
}

export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** v3 onion services use a base32 payload with a SHA3-derived checksum; shape check only. */
export function looksLikeOnionV3(value: string): boolean {
  return /^[a-z2-7]{56}\.onion$/.test(value.toLowerCase());
}

export function ifscLooksValid(value: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value.toUpperCase());
}

export function upiLooksValid(value: string): boolean {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(value);
}

export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return `${value.slice(0, 2)}${"•".repeat(Math.max(value.length - 2, 3))}`;
  }
  return `${value.slice(0, 6)}${"•".repeat(8)}${value.slice(-2)} (len ${value.length})`;
}

export function maskDigits(value: string, keepLast = 4): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= keepLast) {
    return "•".repeat(digits.length);
  }
  return `${"•".repeat(digits.length - keepLast)}${digits.slice(-keepLast)}`;
}
