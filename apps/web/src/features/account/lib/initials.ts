/**
 * Initials for an avatar fallback — derived from the name when present,
 * otherwise the first letter of the email. Returns at most two letters.
 */
export function initialsFrom(name: string, email: string): string {
  const trimmed = name.trim();
  if (trimmed.length > 0) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
    const initials = (first + last).toUpperCase();
    if (initials.length > 0) return initials;
  }
  return email.charAt(0).toUpperCase() || '?';
}
