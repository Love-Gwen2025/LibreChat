export const DISABLED_USER_MESSAGE = 'Account is disabled.';

export function isUserDisabled(user: { isDisabled?: boolean } | null | undefined): boolean {
  return user?.isDisabled === true;
}
