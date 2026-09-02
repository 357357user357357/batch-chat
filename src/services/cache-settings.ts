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