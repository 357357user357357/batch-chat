/**
 * Pure helpers around provider token limits — no React Native imports so the
 * node unit tests can run them directly.
 */

/**
 * Extracts the provider's max output tokens cap from a 400 error body.
 *
 * When a request omits `max_tokens`, OpenRouter substitutes the model's
 * catalog maximum, which some providers reject outright, e.g.:
 *   "Requested maximum tokens of 131072 exceeds the maximum output tokens
 *    limit: 102400."
 * (Seen wrapped in OpenRouter's `metadata.raw` as an escaped JSON string.)
 * Returns the provider-stated limit, or null when the body is some other
 * rejection — callers retry only on a real token-limit failure.
 */
export function maxTokenLimitFromError(body: unknown): number | null {
  const raw =
    typeof body === "string" ? body : JSON.stringify(body ?? "");
  const match = raw.match(/max(?:imum)? output tokens limit:\s*(\d+)/);
  if (!match) return null;
  const limit = Number(match[1]);
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}