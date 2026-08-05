type ImageErrorPayload = {
  code?: string;
  message?: string;
  type?: string;
};

type ImageToolRequestError = {
  message?: string;
  response?: {
    status?: number;
    data?: {
      error?: ImageErrorPayload;
    };
  };
};

type ImageToolAction = 'generate' | 'edit';

/** Formats an upstream image error for the model without exposing headers or credentials. */
export function formatImageToolError({
  error,
  action,
}: {
  error: ImageToolRequestError | null | undefined;
  action: ImageToolAction;
}): string {
  const label = action === 'edit' ? 'Image edit' : 'Image generation';
  const upstream = error?.response?.data?.error;
  const upstreamMessage = upstream?.message?.trim();
  const detail = upstream?.code?.trim() || upstream?.type?.trim();

  if (upstreamMessage) {
    return `${label} failed${detail ? ` (${detail})` : ''}: ${upstreamMessage}`;
  }

  const status = error?.response?.status;
  const fallbackMessage = error?.message?.trim() || 'Unknown error';
  return `${label} failed${status ? ` (HTTP ${status})` : ''}: ${fallbackMessage}`;
}
