import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

let dummyHash: string | null = null;

export async function getDummyHash(): Promise<string> {
  return (dummyHash ??= await hashPassword(randomBytes(32).toString('hex')));
}

const N = 131072; // 2^17, OWASP recommended
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAXMEM = 128 * N * R * 2; // scrypt needs more than Node's 32MB default

function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt:${N}:${R}:${P}:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [, n, r, p, saltHex, keyHex] = stored.split(':');
    const key = await derive(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });
    return timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
  } catch {
    return false;
  }
}
