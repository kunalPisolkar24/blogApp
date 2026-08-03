import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { env } from '../config/env.js';

const payloadSchema = z.object({
  id: z.string(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

const secret = new TextEncoder().encode(env.JWT_SECRET);

export async function signToken(id: string): Promise<string> {
  return new SignJWT({ id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRES_IN)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<{ id: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
    const parsed = payloadSchema.safeParse(payload);
    return parsed.success ? { id: parsed.data.id } : null;
  } catch {
    return null;
  }
}
