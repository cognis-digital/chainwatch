/**
 * Minimal, dependency-free Keccak-256 (the EVM event-topic hash).
 *
 * This is an original implementation of the Keccak-f[1600] permutation with
 * the Ethereum-style padding (0x01 .. 0x80, NOT the FIPS-202 SHA3 0x06
 * padding). It is used to compute the topic0 of an event signature, e.g.
 *   topic0("Transfer(address,address,uint256)")
 *     = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 *
 * The implementation is self-contained and used only for the
 * `eventTopic` helper; field-based rule matching does not require it, keeping
 * the runtime dependency-free.
 */

const ROUNDS = 24;

// Round constants for the iota step (low/high 32-bit halves), precomputed.
const RC_LO = new Uint32Array([
  0x00000001, 0x00008082, 0x0000808a, 0x80008000, 0x0000808b, 0x80000001,
  0x80008081, 0x00008009, 0x0000008a, 0x00000088, 0x80008009, 0x8000000a,
  0x8000808b, 0x0000008b, 0x00008089, 0x00008003, 0x00008002, 0x00000080,
  0x0000800a, 0x8000000a, 0x80008081, 0x00008080, 0x80000001, 0x80008008,
]);
const RC_HI = new Uint32Array([
  0x00000000, 0x00000000, 0x80000000, 0x80000000, 0x00000000, 0x00000000,
  0x80000000, 0x80000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000,
  0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x00000000, 0x80000000,
]);

// Rho rotation offsets and Pi destination lanes, derived at load time from the
// canonical Keccak definitions to guarantee mutual consistency. Lanes are
// indexed as `x + 5*y`. Lane (0,0) is never rotated/moved.
const ROT = new Int32Array(25);
const PI = new Int32Array(25);
(function buildRhoPi() {
  PI[0] = 0; // (0,0) maps to itself
  ROT[0] = 0;
  let x = 1;
  let y = 0;
  for (let t = 0; t < 24; t++) {
    const src = x + 5 * y;
    // Rho offset for step t.
    ROT[src] = (((t + 1) * (t + 2)) / 2) % 64;
    // Pi mapping: (x, y) -> (y, (2x + 3y) mod 5).
    const nx = y;
    const ny = (2 * x + 3 * y) % 5;
    PI[src] = nx + 5 * ny;
    x = y;
    y = ny;
  }
})();

/** Rotate a 64-bit lane (split as hi/lo 32-bit) left by n bits. */
function rotl(lo: number, hi: number, n: number): [number, number] {
  if (n === 0) return [lo >>> 0, hi >>> 0];
  if (n === 32) return [hi >>> 0, lo >>> 0];
  if (n < 32) {
    const nlo = ((lo << n) | (hi >>> (32 - n))) >>> 0;
    const nhi = ((hi << n) | (lo >>> (32 - n))) >>> 0;
    return [nlo, nhi];
  }
  const m = n - 32;
  const nlo = ((hi << m) | (lo >>> (32 - m))) >>> 0;
  const nhi = ((lo << m) | (hi >>> (32 - m))) >>> 0;
  return [nlo, nhi];
}

/** Keccak-f[1600] permutation operating in place on a 25-lane state (lo/hi). */
function keccakF(sLo: Uint32Array, sHi: Uint32Array): void {
  const cLo = new Uint32Array(5);
  const cHi = new Uint32Array(5);
  const dLo = new Uint32Array(5);
  const dHi = new Uint32Array(5);
  const bLo = new Uint32Array(25);
  const bHi = new Uint32Array(25);

  for (let round = 0; round < ROUNDS; round++) {
    // Theta
    for (let x = 0; x < 5; x++) {
      cLo[x] = (sLo[x] ^ sLo[x + 5] ^ sLo[x + 10] ^ sLo[x + 15] ^ sLo[x + 20]) >>> 0;
      cHi[x] = (sHi[x] ^ sHi[x + 5] ^ sHi[x + 10] ^ sHi[x + 15] ^ sHi[x + 20]) >>> 0;
    }
    for (let x = 0; x < 5; x++) {
      const [rl, rh] = rotl(cLo[(x + 1) % 5], cHi[(x + 1) % 5], 1);
      dLo[x] = (cLo[(x + 4) % 5] ^ rl) >>> 0;
      dHi[x] = (cHi[(x + 4) % 5] ^ rh) >>> 0;
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const idx = x + 5 * y;
        sLo[idx] = (sLo[idx] ^ dLo[x]) >>> 0;
        sHi[idx] = (sHi[idx] ^ dHi[x]) >>> 0;
      }
    }

    // Rho + Pi
    for (let i = 0; i < 25; i++) {
      const [rl, rh] = rotl(sLo[i], sHi[i], ROT[i]);
      bLo[PI[i]] = rl;
      bHi[PI[i]] = rh;
    }

    // Chi
    for (let y = 0; y < 5; y++) {
      const base = 5 * y;
      for (let x = 0; x < 5; x++) {
        const a = base + x;
        const n1 = base + ((x + 1) % 5);
        const n2 = base + ((x + 2) % 5);
        sLo[a] = (bLo[a] ^ (~bLo[n1] & bLo[n2])) >>> 0;
        sHi[a] = (bHi[a] ^ (~bHi[n1] & bHi[n2])) >>> 0;
      }
    }

    // Iota
    sLo[0] = (sLo[0] ^ RC_LO[round]) >>> 0;
    sHi[0] = (sHi[0] ^ RC_HI[round]) >>> 0;
  }
}

/** Compute Keccak-256 of the given bytes, returning 32 bytes. */
export function keccak256(input: Uint8Array): Uint8Array {
  const rate = 136; // 1088 bits for Keccak-256
  const sLo = new Uint32Array(25);
  const sHi = new Uint32Array(25);

  // Pad: Keccak (Ethereum) uses 0x01 ... 0x80 padding.
  const padLen = rate - (input.length % rate);
  const padded = new Uint8Array(input.length + padLen);
  padded.set(input);
  padded[input.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  // Absorb
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      const b = off + i * 8;
      const lo =
        (padded[b] |
          (padded[b + 1] << 8) |
          (padded[b + 2] << 16) |
          (padded[b + 3] << 24)) >>>
        0;
      const hi =
        (padded[b + 4] |
          (padded[b + 5] << 8) |
          (padded[b + 6] << 16) |
          (padded[b + 7] << 24)) >>>
        0;
      sLo[i] = (sLo[i] ^ lo) >>> 0;
      sHi[i] = (sHi[i] ^ hi) >>> 0;
    }
    keccakF(sLo, sHi);
  }

  // Squeeze 256 bits (4 lanes)
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    const lo = sLo[i];
    const hi = sHi[i];
    out[i * 8 + 0] = lo & 0xff;
    out[i * 8 + 1] = (lo >>> 8) & 0xff;
    out[i * 8 + 2] = (lo >>> 16) & 0xff;
    out[i * 8 + 3] = (lo >>> 24) & 0xff;
    out[i * 8 + 4] = hi & 0xff;
    out[i * 8 + 5] = (hi >>> 8) & 0xff;
    out[i * 8 + 6] = (hi >>> 16) & 0xff;
    out[i * 8 + 7] = (hi >>> 24) & 0xff;
  }
  return out;
}

/** Hex-encode bytes with a 0x prefix. */
export function toHex(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * Compute the topic0 (event signature hash) for a canonical event signature
 * string such as "Transfer(address,address,uint256)".
 *
 * The signature is hashed as raw ASCII bytes; whitespace is stripped first.
 */
export function eventTopic(signature: string): string {
  const canonical = signature.replace(/\s+/g, "");
  const bytes = new TextEncoder().encode(canonical);
  return toHex(keccak256(bytes));
}

/** Extract the bare event name from a signature, e.g. "Transfer(...)" -> "Transfer". */
export function eventName(signature: string): string {
  const i = signature.indexOf("(");
  return (i === -1 ? signature : signature.slice(0, i)).trim();
}
