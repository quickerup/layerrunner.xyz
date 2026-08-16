/**
 * TonConnect "ton_proof" verification -- lets a wallet prove ownership of
 * its address without any password/account, by signing a server-issued
 * payload. Implements the protocol's documented message format exactly
 * (see TonConnect's ton_proof spec / demo-dapp-with-backend reference):
 *
 *   message = "ton-proof-item-v2/" + workchain(4B BE) + addressHash(32B)
 *           + domainLen(4B LE) + domain + timestamp(8B LE) + payload
 *   fullMessage = 0xffff + "ton-connect" + sha256(message)
 *   signed hash = sha256(fullMessage)
 *
 * verified via ed25519 (tweetnacl) against the wallet's own public key.
 * Deliberately pure Web-Crypto + tweetnacl -- no Node built-ins, no
 * @ton/core -- so this runs unmodified in the Cloudflare Worker bundle
 * (no nodejs_compat flag configured in wrangler.toml).
 */

import nacl from 'tweetnacl';

const PROOF_PREFIX = 'ton-proof-item-v2/';
const TON_CONNECT_PREFIX = 'ton-connect';

// Must stay <= the payload cookie's Max-Age in auth/routes.ts -- a proof
// that's still "fresh" by this check but whose cookie already expired will
// simply fail the payload-match check instead, so the two just need to
// agree on the same order of magnitude.
const MAX_PROOF_AGE_SECONDS = 600;

export interface TonProofDomain {
  lengthBytes: number;
  value: string;
}

export interface TonProofReply {
  timestamp: number;
  domain: TonProofDomain;
  signature: string; // base64
  payload: string;
}

export interface TonAccountInfo {
  /** Raw "<workchain>:<64-hex-char hash>" form, as TonConnect reports it. */
  address: string;
  /** Hex-encoded ed25519 public key, as supplied by the connected wallet. */
  publicKey?: string;
}

export interface TonProofVerification {
  ok: boolean;
  /** Present only when ok -- the raw address to key the user's identity on. */
  rawAddress?: string;
  reason?: string;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function fromHex(hex: string): Uint8Array | undefined {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return new Uint8Array(digest);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** One-time random payload the wallet is asked to sign. Its authenticity
 * and freshness are pinned via a short-lived cookie (see auth/routes.ts),
 * not server-side storage -- keeps this stateless like the OAuth state
 * cookies already used for GitHub/Google login. */
export function buildProofPayload(): string {
  return toBase64Url(randomBytes(16));
}

/**
 * Parses TonConnect's raw "<workchain>:<hex hash>" address form. Not using
 * @ton/core's Address.parse here on purpose -- keeps this module free of
 * that dependency so it never risks the Worker bundle needing Node
 * built-ins just to verify a signature.
 */
function parseRawAddress(raw: string): { workchain: number; hash: Uint8Array } | undefined {
  const [wcPart, hashPart] = raw.split(':');
  if (wcPart === undefined || hashPart === undefined || hashPart.length !== 64) return undefined;
  const workchain = Number(wcPart);
  if (!Number.isInteger(workchain)) return undefined;
  const hash = fromHex(hashPart);
  if (!hash) return undefined;
  return { workchain, hash };
}

export async function verifyTonProof(
  proof: TonProofReply,
  account: TonAccountInfo,
  expectedDomain: string,
  expectedPayload: string
): Promise<TonProofVerification> {
  if (proof.payload !== expectedPayload) {
    return { ok: false, reason: 'Proof payload does not match the one issued.' };
  }

  const domain = proof.domain?.value;
  if (domain !== expectedDomain && domain !== `www.${expectedDomain}`) {
    return { ok: false, reason: 'Proof domain does not match.' };
  }

  const ageSeconds = Date.now() / 1000 - proof.timestamp;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > MAX_PROOF_AGE_SECONDS) {
    return { ok: false, reason: 'Proof has expired.' };
  }

  if (!account.publicKey) {
    return { ok: false, reason: 'Wallet did not provide a public key.' };
  }
  const publicKey = fromHex(account.publicKey);
  if (!publicKey || publicKey.length !== 32) {
    return { ok: false, reason: 'Wallet public key is malformed.' };
  }

  const signature = fromBase64(proof.signature);
  if (signature.length !== 64) {
    return { ok: false, reason: 'Proof signature is malformed.' };
  }

  const parsedAddress = parseRawAddress(account.address);
  if (!parsedAddress) {
    return { ok: false, reason: 'Could not parse wallet address.' };
  }

  const workchainBytes = new Uint8Array(4);
  new DataView(workchainBytes.buffer).setInt32(0, parsedAddress.workchain, false); // big-endian

  const domainBytes = new TextEncoder().encode(domain);
  const domainLenBytes = new Uint8Array(4);
  new DataView(domainLenBytes.buffer).setUint32(0, domainBytes.length, true); // little-endian

  const timestampBytes = new Uint8Array(8);
  new DataView(timestampBytes.buffer).setBigUint64(0, BigInt(Math.floor(proof.timestamp)), true); // little-endian

  const message = concatBytes(
    new TextEncoder().encode(PROOF_PREFIX),
    workchainBytes,
    parsedAddress.hash,
    domainLenBytes,
    domainBytes,
    timestampBytes,
    new TextEncoder().encode(proof.payload)
  );

  const messageHash = await sha256(message);

  const fullMessage = concatBytes(
    new Uint8Array([0xff, 0xff]),
    new TextEncoder().encode(TON_CONNECT_PREFIX),
    messageHash
  );

  const signedHash = await sha256(fullMessage);

  let valid: boolean;
  try {
    valid = nacl.sign.detached.verify(signedHash, signature, publicKey);
  } catch (error) {
    return { ok: false, reason: 'Signature verification error.' };
  }

  if (!valid) {
    return { ok: false, reason: 'Signature verification failed.' };
  }

  return { ok: true, rawAddress: `${parsedAddress.workchain}:${toHex(parsedAddress.hash)}` };
}
