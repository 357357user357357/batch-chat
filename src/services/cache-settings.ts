/**
 * Prompt-cache duration for outgoing OpenRouter requests.
 *
 * OpenRouter/Anthropic prompt caching defaults to a 5‑minute TTL. We store the
 * user's preferred TTL here so they can keep the conservative 5 minutes or
 * extend it to 1 hour (Anthropic's maximum). Applied to both live chat and
 * async batch requests.
 */
import { loadJSON, saveJSON } from "@/services/storage";

const CACHE_SETTINGS_KEY = "cache.duration.v1";

export const CACHE_TTL_5_MINUTES = 300;
export const CACHE_TTL_1_HOUR = 3600;

export type CacheDurationSeconds =
  | typeof CACHE_TTL_5_MINUTES
  | typeof CACHE_TTL_1_HOUR;

export const DEFAULT_CACHE_DURATION_SECONDS: CacheDurationSeconds =
  CACHE_TTL_1_HOUR;

export async function getCacheDurationSeconds(): Promise<CacheDurationSeconds> {
  const value = await loadJSON<CacheDurationSeconds | null>(
    CACHE_SETTINGS_KEY,
    null
  );
  return value === CACHE_TTL_5_MINUTES || value === CACHE_TTL_1_HOUR
    ? value
    : DEFAULT_CACHE_DURATION_SECONDS;
}

export async function setCacheDurationSeconds(
  value: CacheDurationSeconds
): Promise<void> {
  await saveJSON(CACHE_SETTINGS_KEY, value);
}

// ---------------------------------------------------------------------------
// Cache keep-alive
//
// Anthropic/OpenRouter caches have a 1-hour max TTL, but every cache READ
// refreshes it. After the last real chat request the app can keep sending
// near-empty pings (history + "." user turn, max_tokens=8) every 45 minutes
// that hit the cached prefix at ~10% of input cost, keeping replies cheap for
// `keepAliveHours` after the last real request instead of just one hour.
// Only meaningful while the app is in the foreground (iOS/Android suspend
// background timers); on this server the same feature runs 24/7.
// ---------------------------------------------------------------------------

const KEEP_ALIVE_KEY = "cache.keepalive.v1";

export const KEEP_ALIVE_OFF = 0;
export const DEFAULT_KEEP_ALIVE_HOURS = 3;
export const KEEP_ALIVE_CHOICES = [0, 2, 3, 6, 12, 24];

export async function getKeepAliveHours(): Promise<number> {
  const value = await loadJSON<number | null>(KEEP_ALIVE_KEY, null);
  return typeof value === "number" && value >= 0 ? value : DEFAULT_KEEP_ALIVE_HOURS;
}

export async function setKeepAliveHours(hours: number): Promise<void> {
  await saveJSON(KEEP_ALIVE_KEY, hours);
}