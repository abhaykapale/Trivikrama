const REFRESH_WINDOW_BUFFER_MS = 4 * 60 * 1000 + 45 * 1000;

export function calculateRefreshDelay(
  expiresAt: string,
  nowMs: number = Date.now(),
): number | null {
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) return null;
  return Math.max(0, expiryMs - nowMs - REFRESH_WINDOW_BUFFER_MS);
}
