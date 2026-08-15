/**
 * Encrypted-at-rest storage for user-supplied secrets (e.g. a personal
 * GitHub token), using native Web Crypto — no external dependency.
 *
 * AES-256-GCM, keyed by PBKDF2(masterKey, salt). Unlike a fixed/shared
 * salt (a common shortcut to avoid re-deriving the key on every access),
 * this derives a fresh key from a genuinely random salt on every single
 * encrypt call — correctness over the CPU savings, since this runs at
 * per-user secret-connect/read frequency, not the hot path of a
 * multi-tenant factory serving many secrets per request.
 *
 * Blob layout (base64): salt[16] || iv[12] || ciphertext
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_LEN = 16;
const IV_LEN = 12;

async function deriveKey(masterKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(masterKey), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptSecret(plaintext: string, masterKey: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(masterKey, salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));

  const combined = new Uint8Array(SALT_LEN + IV_LEN + ciphertext.length);
  combined.set(salt, 0);
  combined.set(iv, SALT_LEN);
  combined.set(ciphertext, SALT_LEN + IV_LEN);
  return toBase64(combined);
}

export async function decryptSecret(blob: string, masterKey: string): Promise<string> {
  const combined = fromBase64(blob);
  const salt = combined.slice(0, SALT_LEN);
  const iv = combined.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const ciphertext = combined.slice(SALT_LEN + IV_LEN);
  const key = await deriveKey(masterKey, salt);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuf);
}
