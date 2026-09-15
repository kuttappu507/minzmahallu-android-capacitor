/*
 * node:crypto shim for the MMS Android web bridge (Capacitor WebView).
 *
 * The Electron service modules (auth, audit chain, QR signing, verification
 * codes, tokens) import node:crypto. This shim provides the exact subset
 * they use, synchronously, in the browser:
 *
 *   - pbkdf2Sync      — PBKDF2-HMAC-SHA256 (hash-wasm WASM core → fast
 *                       enough for the 200,000-iteration password hashes)
 *   - createHash      — sha256 streaming hash
 *   - createHmac      — hmac-sha256 streaming HMAC
 *   - randomBytes     — crypto.getRandomValues, returned as Buffer
 *   - randomInt       — rejection-sampled uniform integer
 *   - timingSafeEqual — constant-time comparison
 *
 * initialised once at boot via initCrypto() BEFORE window.mms is installed.
 */
import { createSHA256, type IHasher } from "hash-wasm";
import { Buffer } from "buffer";

/*
 * hash-wasm's IHasher is STATEFUL: after digest() it must be init()'ed again
 * before the next update(). A single shared instance therefore breaks the
 * second createHash() call ("update() called before init()" — seen as
 * "[audit] Failed to log" on the audit chain). A small pool gives every
 * createHash()/sha256Raw() its own hasher: acquire → init → use → release.
 * All real call sites are one-shot (update…digest immediately), so 8 slots
 * are far more than the possible concurrency.
 */
const POOL_SIZE = 8;
const pool: IHasher[] = [];

/** Must run before any service module performs a crypto operation. */
export async function initCrypto(): Promise<void> {
  while (pool.length < POOL_SIZE) {
    const h = await createSHA256();
    h.init();
    pool.push(h);
  }
}

function acquire(): IHasher {
  const h = pool.pop();
  if (!h) throw new Error("crypto shim: hasher pool exhausted — concurrent hash streams exceed 8");
  h.init(); // fresh state for every stream, mirroring node's createHash()
  return h;
}

function release(h: IHasher): void {
  pool.push(h);
}

type AnyBytes = string | Uint8Array | ArrayBuffer | ArrayLike<number>;

function toU8(data: AnyBytes): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(Array.from(data as ArrayLike<number>));
}

function sha256Raw(data: Uint8Array): Uint8Array {
  const h = acquire();
  h.update(data);
  const out = h.digest("binary") as Uint8Array;
  release(h);
  return out;
}

function u8ToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function u8ToB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(bin);
}

export interface HashLike {
  update(data: AnyBytes): HashLike;
  digest(outputType?: "hex" | "binary" | "base64"): string | Uint8Array;
}

function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const k = key.length > 64 ? sha256Raw(key) : key;
  const kp = new Uint8Array(64);
  kp.set(k);
  const inner = new Uint8Array(64 + msg.length);
  const outer = new Uint8Array(96);
  for (let i = 0; i < 64; i++) {
    inner[i] = kp[i] ^ 0x36;
    outer[i] = kp[i] ^ 0x5c;
  }
  inner.set(msg, 64);
  const ih = sha256Raw(inner);
  outer.set(ih, 64);
  return sha256Raw(outer);
}

/** Streaming sha256 — mirrors crypto.createHash("sha256"). */
export function createHash(algorithm: string): HashLike {
  const alg = String(algorithm || "").replace(/-/g, "").toLowerCase();
  if (alg !== "sha256") throw new Error(`crypto shim: unsupported hash algorithm "${algorithm}"`);
  const h = acquire();
  let digested = false;
  return {
    update(data: AnyBytes) {
      h.update(toU8(data));
      return this;
    },
    digest(outputType?: "hex" | "binary" | "base64") {
      if (digested) throw new Error("crypto shim: digest() called twice on one hash stream");
      digested = true;
      const out =
        outputType === "binary"
          ? h.digest("binary")
          : outputType === "base64"
            ? u8ToB64(h.digest("binary") as Uint8Array)
            : h.digest();
      release(h); // stream finished — hasher back to the pool
      return out;
    },
  };
}

/** Streaming HMAC-SHA256 — mirrors crypto.createHmac("sha256", key). */
export function createHmac(algorithm: string, key: AnyBytes): HashLike {
  const alg = String(algorithm || "").replace(/-/g, "").toLowerCase();
  if (alg !== "sha256") throw new Error(`crypto shim: unsupported hmac algorithm "${algorithm}"`);
  const k = toU8(key);
  let msg: Uint8Array | null = null;
  return {
    update(data: AnyBytes) {
      msg = msg ? concat(msg, toU8(data)) : toU8(data);
      return this;
    },
    digest(outputType?: "hex" | "binary" | "base64") {
      if (!msg) msg = new Uint8Array(0);
      const mac = hmacSha256(k, msg);
      if (outputType === "binary") return mac;
      if (outputType === "base64") return u8ToB64(mac);
      return u8ToHex(mac);
    },
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** PBKDF2-HMAC-SHA256, synchronous — mirrors crypto.pbkdf2Sync. */
export function pbkdf2Sync(
  password: AnyBytes,
  salt: AnyBytes,
  iterations: number,
  keylen: number,
  _digest?: string
): Buffer {
  const P = toU8(password);
  const S = toU8(salt);
  const iters = Math.max(1, Math.floor(Number(iterations) || 1));
  const len = Math.max(1, Math.floor(Number(keylen) || 32));
  const blocks = Math.ceil(len / 32);
  const out = new Uint8Array(blocks * 32);
  const saltBlock = new Uint8Array(S.length + 4);
  saltBlock.set(S, 0);
  for (let b = 1; b <= blocks; b++) {
    saltBlock[S.length] = (b >>> 24) & 255;
    saltBlock[S.length + 1] = (b >>> 16) & 255;
    saltBlock[S.length + 2] = (b >>> 8) & 255;
    saltBlock[S.length + 3] = b & 255;
    let u = hmacSha256(P, saltBlock);
    const t = Uint8Array.from(u);
    for (let i = 1; i < iters; i++) {
      u = hmacSha256(P, u);
      for (let j = 0; j < 32; j++) t[j] ^= u[j];
    }
    out.set(t, (b - 1) * 32);
  }
  return Buffer.from(out.buffer, out.byteOffset, len);
}

/** crypto.randomBytes — crypto.getRandomValues under the hood, Buffer result. */
export function randomBytes(size: number): Buffer {
  const bytes = new Uint8Array(Math.max(0, Math.floor(size)));
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** crypto.randomInt(max) — uniform via rejection sampling. */
export function randomInt(max: number): number {
  const exclusiveMax = Math.floor(max);
  if (!Number.isFinite(exclusiveMax) || exclusiveMax <= 0) throw new RangeError("randomInt max must be a positive safe integer");
  const limit = Math.floor(0x100000000 / exclusiveMax) * exclusiveMax;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % exclusiveMax;
  }
}

/** crypto.timingSafeEqual — constant-time compare. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const cryptoShim = {
  randomBytes,
  randomInt,
  timingSafeEqual,
  createHash,
  createHmac,
  pbkdf2Sync,
  initCrypto,
};

export default cryptoShim;
