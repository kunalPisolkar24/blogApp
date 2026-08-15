import { z } from 'zod';
import { ValidationError } from './errors.js';

export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid input');
  }
  return result.data;
}

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.string().email()),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().min(3).max(30).regex(/^[a-z0-9_]+$/, 'username may only contain lowercase letters, digits, and underscores')),
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'password must include both letters and digits'),
});

export const signinSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.string().email()),
  password: z.string().min(1).max(128),
});

const httpUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine(
    (value) => value.startsWith('http://') || value.startsWith('https://'),
    'URL must use http or https',
  );

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(80).nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  avatarUrl: httpUrlSchema.nullable().optional(),
  bannerUrl: httpUrlSchema.nullable().optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type SigninInput = z.infer<typeof signinSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
