import { describe, it, expect } from 'vitest';
import { signinSchema, signupSchema, updateProfileSchema, validate } from '../schemas.js';
import { ValidationError } from '../errors.js';

describe('validate', () => {
  it('returns normalized data for valid input', () => {
    const input = {
      email: ' Alice@Example.com ',
      username: ' Alice ',
      password: 'password-1234',
    };

    expect(validate(signupSchema, input)).toEqual({
      email: 'alice@example.com',
      username: 'alice',
      password: 'password-1234',
    });
  });

  it('throws ValidationError for invalid input', () => {
    expect(() => validate(signupSchema, { email: 'nope' })).toThrow(ValidationError);
  });
});

describe('signupSchema', () => {
  it('accepts a valid signup', () => {
    const input = { email: 'alice@example.com', username: 'alice_1', password: 'password-1234' };
    expect(signupSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    { email: 'not-an-email', username: 'alice', password: 'password-1234' },
    { email: 'alice@example.com', username: 'ab', password: 'password-1234' },
    { email: 'alice@example.com', username: 'has spaces', password: 'password-1234' },
    { email: 'alice@example.com', username: 'alice', password: 'no-digits' },
    { email: 'alice@example.com', username: 'alice', password: '1234567890' },
  ])('rejects %j', (input) => {
    expect(signupSchema.safeParse(input).success).toBe(false);
  });
});

describe('signinSchema', () => {
  it('accepts valid credentials', () => {
    expect(signinSchema.safeParse({ email: 'alice@example.com', password: 'x' }).success).toBe(
      true,
    );
  });

  it('rejects a malformed email', () => {
    expect(signinSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });

  it('rejects an empty password', () => {
    expect(signinSchema.safeParse({ email: 'alice@example.com', password: '' }).success).toBe(
      false,
    );
  });
});

describe('updateProfileSchema', () => {
  it('accepts a full valid profile', () => {
    const input = {
      name: 'Alice',
      bio: 'Hello world',
      avatarUrl: 'https://cdn.example.com/avatar.png',
      bannerUrl: null,
    };
    expect(updateProfileSchema.safeParse(input).success).toBe(true);
  });

  it('accepts an empty object', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a null name to clear it', () => {
    expect(updateProfileSchema.safeParse({ name: null }).success).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(updateProfileSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects an over-long bio', () => {
    expect(updateProfileSchema.safeParse({ bio: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rejects a non-URL avatar', () => {
    expect(updateProfileSchema.safeParse({ avatarUrl: 'not a url' }).success).toBe(false);
  });

  it('rejects a non-http URL', () => {
    expect(updateProfileSchema.safeParse({ avatarUrl: 'ftp://example.com/x' }).success).toBe(
      false,
    );
  });
});
