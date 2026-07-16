import { isContextWindowError } from './error';

describe('isContextWindowError', () => {
  it.each([
    'Your input exceeds the context window of this model.',
    'maximum context length exceeded',
    'context_length_exceeded',
    'Too many tokens in the request',
  ])('recognizes context overflow errors: %s', (message) => {
    expect(isContextWindowError(new Error(message))).toBe(true);
  });

  it('supports error-shaped objects returned by upstream SDKs', () => {
    expect(isContextWindowError({ message: 'Your input exceeds the context window' })).toBe(true);
  });

  it('does not classify unrelated upstream failures as context errors', () => {
    expect(isContextWindowError(new Error('Request failed with status 502'))).toBe(false);
  });
});
