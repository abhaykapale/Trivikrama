export function getCookieValue(cookieHeader: string, name: string): string | null {
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;

    const candidateName = entry.slice(0, separator).trim();
    if (candidateName !== name) continue;

    const value = entry.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export function getBrowserCookie(name: string): string | null {
  return typeof document === "undefined" ? null : getCookieValue(document.cookie, name);
}
