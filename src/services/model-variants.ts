/**
 * OpenRouter model-id variants: `:flex` (cheaper processing tier, appended
 * per-request — the catalog itself never lists `:flex` ids) and `:batch`
 * (async 50%-off tier, which DOES exist as a separate catalog id).
 *
 * Pure string helpers — no React Native / storage imports so they can be
 * unit-tested with plain node. `openrouter.ts` re-exports these.
 */

const FLEX_SUFFIX = ':flex';
const BATCH_SUFFIX = ':batch';

/** Split a model id into its base id and whether it targets the flex tier. */
export function splitModelVariant(model: string): { base: string; flex: boolean } {
  const trimmed = model.trim();
  if (trimmed.endsWith(FLEX_SUFFIX)) {
    return { base: trimmed.slice(0, -FLEX_SUFFIX.length), flex: true };
  }
  return { base: trimmed, flex: false };
}

/** Appends the Flex suffix unless the model already carries it — the suffix
 * self-actualizes through splitModelVariant, so appending it twice would
 * leave a literal ":flex:flex" id that no provider can route. */
export function withFlexSuffix(model: string): string {
  const trimmed = model.trim();
  return trimmed.endsWith(FLEX_SUFFIX) ? trimmed : `${trimmed}${FLEX_SUFFIX}`;
}

/** Appends the Batch suffix unless the id already carries it. */
export function withBatchSuffix(model: string): string {
  const trimmed = model.trim();
  return trimmed.endsWith(BATCH_SUFFIX) ? trimmed : `${trimmed}${BATCH_SUFFIX}`;
}

/** True when the id targets the flex tier (`…:flex`). */
export function isFlexId(id: string | null | undefined): boolean {
  return !!id && id.trim().toLowerCase().endsWith(FLEX_SUFFIX);
}

/** True when a model id targets the (cheaper) Batch API (`:batch` suffix). */
export function isBatchModelId(id: string): boolean {
  return id.trim().toLowerCase().endsWith(BATCH_SUFFIX);
}

/**
 * Every non-batch model supports the flex tier: OpenRouter answers 400 with
 * "service_tier"/"flex" in the message when it doesn't, and both the app and
 * the server automatically retry on the standard tier then — so advertising
 * flex for all non-batch ids is always safe.
 */
export function supportsFlex(id: string): boolean {
  return !isBatchModelId(id);
}