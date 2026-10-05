/**
 * Per-message metadata formatting (model, tokens, price, date) for chat
 * bubbles and the message-details popup. Pure functions only — no React
 * Native imports — so the unit tests run with plain node.
 */

/** Structural subset both ChatMessage (chat.tsx) and SyncMessage (sync.ts) satisfy. */
export type MessageMetaSource = {
  model?: string | null;
  tokens_prompt?: number | null;
  tokens_completion?: number | null;
  total_tokens?: number | null;
  cost?: number | null;
  provider?: string | null;
};

/** Server-side gateway prefixes that ride inside the stored model id. */
const GATEWAY_PREFIXES = ["custom:", "vertex:", "bedrock:"];

/** Optional hook: resolves a raw model id to its catalog display name
 * ("z-ai/glm-5.3-flash" → "GLM-5.3 Flash"). Set by services/model-names
 * once the provider catalog is fetched; pure callers (metadataLabel etc.)
 * then render friendly names without importing RN-dependent code. */
type ModelDisplayNameResolver = (id: string) => string | null;
let displayNameResolver: ModelDisplayNameResolver | null = null;

export function setModelDisplayNameResolver(
  resolver: ModelDisplayNameResolver | null,
): void {
  displayNameResolver = resolver;
}

const FLEX_MARK = "🧊";
const BATCH_MARK = "⚡";

/** True when the reply carries any usage/cost info worth showing. */
export function hasReplyMetadata(message: MessageMetaSource): boolean {
  return (
    !!message.model ||
    (message.total_tokens ?? 0) > 0 ||
    (message.tokens_prompt ?? 0) > 0 ||
    (message.tokens_completion ?? 0) > 0 ||
    typeof message.cost === "number"
  );
}

/**
 * Compact token count: 850 → "850", 1234 → "1.2k", 12_400 → "12.4k".
 */
export function formatTokens(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

/** Compact price: $1.2345 / $0.0123 / <$0.0001 for dust. Null when unknown. */
export function formatCost(cost: number | null | undefined): string | null {
  if (typeof cost !== "number" || !Number.isFinite(cost)) return null;
  if (cost <= 0) return cost === 0 ? "$0" : null;
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 1) return `$${cost.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Short model label for a bubble line: drops the gateway prefix
 * ("custom:z-ai/glm-5.3-flash" → "glm-5.3-flash"), the vendor prefix
 * ("anthropic/claude-x" → "claude-x"), and marks the serving tier
 * ("deepseek/deepseek-v4:flex" → "deepseek-v4 🧊",
 *  "z-ai/glm-5.3:batch" → "glm-5.3 ⚡").
 */
export function shortModelName(model: string | null | undefined): string | null {
  if (!model) return null;
  let trimmed = model.trim();
  if (!trimmed) return null;
  for (const prefix of GATEWAY_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      trimmed = trimmed.slice(prefix.length);
      break;
    }
  }
  const withoutFlex = trimmed.endsWith(":flex")
    ? trimmed.slice(0, -":flex".length)
    : trimmed;
  const withoutBatch = withoutFlex.endsWith(":batch")
    ? withoutFlex.slice(0, -":batch".length)
    : withoutFlex;
  const base = withoutBatch.split("/").pop() ?? withoutBatch;
  const resolved = displayNameResolver?.(trimmed) ?? null;
  const shown = resolved ?? base;
  const flex = withoutFlex.length !== trimmed.length;
  const batch = withoutBatch.length !== withoutFlex.length;
  const marks = `${flex ? ` ${FLEX_MARK}` : ""}${batch ? ` ${BATCH_MARK}` : ""}`;
  return marks ? `${shown}${marks}` : shown;
}

/** Canonical cache key for a model id: strips gateway prefixes, serving-tier
 * suffixes (:flex/:batch) and case, so "custom:Z-AI/GLM-5.3-Flash:batch"
 * and "z-ai/glm-5.3-flash" share one catalog entry. */
export function normalizeModelKey(model: string | null | undefined): string {
  if (!model) return "";
  let trimmed = model.trim().toLowerCase();
  for (const prefix of GATEWAY_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      trimmed = trimmed.slice(prefix.length);
      break;
    }
  }
  for (const suffix of [":flex", ":batch"]) {
    if (trimmed.endsWith(suffix)) {
      trimmed = trimmed.slice(0, -suffix.length);
    }
  }
  return trimmed;
}

/** "12.09.26 14:03" — same format the server web UI shows. */
export function formatMessageDate(createdAt: number | string | null | undefined): string | null {
  if (!createdAt) return null;
  const d = typeof createdAt === "number" ? new Date(createdAt) : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

/**
 * One-line bubble caption, e.g. "12.09.26 14:03 · deepseek-v4 🧊 · 1.2k tok · $0.0123".
 * Omits missing pieces; returns null when there is nothing to show.
 */
export function metadataLabel(
  message: MessageMetaSource & { createdAt?: number | string | null },
): string | null {
  const parts: string[] = [];
  const date = formatMessageDate(message.createdAt);
  if (date) parts.push(date);
  const model = shortModelName(message.model);
  if (model) parts.push(model);
  const tokens = formatTokens(message.total_tokens);
  if (tokens) parts.push(`${tokens} tok`);
  const cost = formatCost(message.cost);
  if (cost) parts.push(cost);
  return parts.length ? parts.join(" · ") : null;
}