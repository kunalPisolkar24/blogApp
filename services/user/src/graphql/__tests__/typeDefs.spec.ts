import { describe, it, expect } from 'vitest';
import { typeDefs } from '../typeDefs.js';

describe('typeDefs', () => {
  it('parses to a valid GraphQL document', () => {
    expect(typeDefs.kind).toBe('Document');
    expect(typeDefs.definitions.length).toBeGreaterThan(0);
  });
});