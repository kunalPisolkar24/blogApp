import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';
import { signToken, verifyToken } from '../utils/token.js';

const mocks = vi.hoisted(() => ({
  env: {
    JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
    JWT_ISSUER: 'user-service',
    JWT_AUDIENCE: 'topos',
    JWT_EXPIRES_IN: '7d',
  },
}));

vi.mock('../config/env.js', () => ({ env: mocks.env }));

const JWT_SECRET = mocks.env.JWT_SECRET;

describe('signToken', () => {
  it('round-trips through verifyToken', async () => {
    const token = await signToken('u1');
    await expect(verifyToken(token)).resolves.toEqual({ id: 'u1' });
  });
});

describe('verifyToken', () => {
  it('returns null for garbage input', async () => {
    await expect(verifyToken('not-a-jwt')).resolves.toBeNull();
  });

  it('returns null for a corrupted signature', async () => {
    const token = (await signToken('u1')).slice(0, -2) + 'xx';
    await expect(verifyToken(token)).resolves.toBeNull();
  });

  it('returns null when the payload has no id', async () => {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const token = await new SignJWT({ foo: 'bar' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('user-service')
      .setAudience('topos')
      .sign(secret);

    await expect(verifyToken(token)).resolves.toBeNull();
  });
});