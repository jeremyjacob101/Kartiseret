export const PASSWORD_RESET_PATH = "/reset-password";

export function getPasswordResetRedirectUrl(
  origin: string = window.location.origin,
): string {
  return new URL(PASSWORD_RESET_PATH, origin).toString();
}
