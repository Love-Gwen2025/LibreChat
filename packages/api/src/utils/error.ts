const contextWindowPatterns = [
  /context window/i,
  /context_length_exceeded/i,
  /maximum context length/i,
  /too many tokens/i,
];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (
    error != null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return '';
}

export function isContextWindowError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return contextWindowPatterns.some((pattern) => pattern.test(message));
}
