export function isBmsitEmail(value: string): boolean {
  return /^[^@\s]+@bmsit\.in$/i.test(value.trim());
}
