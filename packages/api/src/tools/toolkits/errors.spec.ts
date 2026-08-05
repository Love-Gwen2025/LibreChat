import { formatImageToolError } from './errors';

describe('formatImageToolError', () => {
  it('preserves the upstream policy code and user-safe message', () => {
    const result = formatImageToolError({
      action: 'edit',
      error: {
        message: 'Request failed with status code 400',
        response: {
          status: 400,
          data: {
            error: {
              code: 'content_policy_violation',
              type: 'image_generation_user_error',
              message: 'This image request cannot be processed.',
            },
          },
        },
      },
    });

    expect(result).toBe(
      'Image edit failed (content_policy_violation): This image request cannot be processed.',
    );
  });

  it('falls back to the transport status and message', () => {
    expect(
      formatImageToolError({
        action: 'generate',
        error: { message: 'Gateway timeout', response: { status: 504 } },
      }),
    ).toBe('Image generation failed (HTTP 504): Gateway timeout');
  });
});
