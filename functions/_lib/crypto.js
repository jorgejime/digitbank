// =============================================================================
// Criptografía Web Crypto API: PBKDF2-SHA256, Tokens y TOTP RFC 6238 (2FA)
// =============================================================================

const enc = new TextEncoder();

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMat,
    256
  );
  return `pbkdf2$${toHex(salt)}$${toHex(bits)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (!stored.startsWith('pbkdf2$')) {
    return String(password) === String(stored);
  }
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const salt = fromHex(parts[1]);
  const expected = parts[2];
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMat,
    256
  );
  return toHex(bits) === expected;
}

export function generarTokenSesion() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return toHex(bytes);
}

// Base32 RFC 4648 para TOTP (Google Authenticator / Authy)
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generarSecretoTOTP() {
  const random = crypto.getRandomValues(new Uint8Array(20));
  let out = '';
  for (let i = 0; i < random.length; i++) {
    out += B32_ALPHABET[random[i] % 32];
  }
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (let i = 0; i < clean.length; i++) {
    value = (value << 5) | B32_ALPHABET.indexOf(clean[i]);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

export async function generarCodigoTOTP(secretBase32, counterOverride = null) {
  const keyBytes = base32Decode(secretBase32);
  const counter = counterOverride !== null ? counterOverride : Math.floor(Date.now() / 1000 / 30);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(4, counter, false);

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1000000;
  return String(code).padStart(6, '0');
}

export async function verificarCodigoTOTP(secretBase32, codigoInput) {
  if (!secretBase32 || !codigoInput) return false;
  const limpio = String(codigoInput).trim();
  const baseCounter = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    const esperado = await generarCodigoTOTP(secretBase32, baseCounter + delta);
    if (esperado === limpio) return true;
  }
  return false;
}
