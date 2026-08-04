import { describe, it, expect } from 'vitest';
import { getDummyHash, hashPassword, verifyPassword } from '../utils/password.js';

const PASSWORD = 'correct horse battery staple 1';
const WRONG_PASSWORD = 'wrong password';

describe('hashPassword', () => {
  it('produces a portable scrypt hash', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('scrypt:')).toBe(true);
  });

  it('produces a unique salt per call', async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);
    expect(first).not.toBe(second);
  });
});

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword(PASSWORD);
    await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword(PASSWORD);
    await expect(verifyPassword(WRONG_PASSWORD, hash)).resolves.toBe(false);
  });

  it('rejects a malformed stored hash', async () => {
    await expect(verifyPassword(PASSWORD, 'not-a-valid-hash')).resolves.toBe(false);
  });
});

describe('getDummyHash', () => {
  it('returns a valid scrypt hash', async () => {
    await expect(getDummyHash()).resolves.toMatch(/^scrypt:/);
  });

  it('memoizes the hash across calls', async () => {
    await expect(getDummyHash()).resolves.toBe(await getDummyHash());
  });
});