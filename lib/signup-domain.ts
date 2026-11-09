/** Basic email shape check. College membership comes from an admin invite + profile, not the domain. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value.trim());
}

/** @deprecated Use isValidEmail. Kept for older imports. */
export function isBmsitEmail(value: string): boolean {
  return isValidEmail(value);
}
