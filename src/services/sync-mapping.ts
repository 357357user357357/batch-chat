/**
 * Pure sync data mapping (server pull payloads -> local dialog/batch shapes
 * and back). No React Native / storage imports so it can be unit-tested with
 * plain node; `sync.ts` owns the actual I/O.
 */
import type { OpenRouterBatch, OpenRouterBatchResultItem } from "@/services/openrouter";

/** One message of a pulled conversation (subset of the server's SyncMessage). */
export type PulledMessage = {
  role: string;
  content: string;
  /** Exact model that served this reply (assistant messages), e.g.
   * "deepseek/deepseek-v4:flex" — also carried for user messages for symmetry. */
  model: string | null;
  /** Server-side message id — needed to delete a specific Q/A. */
  id?: number | null;
  created_at?: string | null;
  /** OpenRouter metadata (assistant replies): reasoning effort, provider,
   * generation id and exact usage/cost. */
  reasoning?: string | null;
  provider?: string | null;
  gen_id?: string | null;
  tokens_prompt?: number | null;
  tokens_completion?: number | null;
  total_tokens?: number | null;
  cost?: number | null;
};

export type PulledConversation = {
  external_id: string;
  kind: string;
  model: string | null;
  title: string;
  created_at: string | null;
  updated_at: string | null;
  deleted: boolean;
  messages: PulledMessage[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  latexContent?: string;
  error?: boolean;
  /** True while an assistant reply is still arriving via SSE streaming. */
  streaming?: boolean;
  /** Server-side message id (assigned by sync) — enables per-message delete. */
  serverId?: number | null;
  /** Creation instant (ms epoch) — shown as DD.MM.YY HH.MM under the bubble. */
  createdAt?: number;
  /** Exact model id that produced an assistant reply (may carry ":flex"). */
  model?: string | null;
  /** OpenRouter metadata for assistant replies (shown in a tap-to-open popup). */
  reasoning?: string | null;
  provider?: string | null;
  genId?: string | null;
  tokensPrompt?: number | null;
  tokensCompletion?: number | null;
  totalTokens?: number | null;
  cost?: number | null;
};

export type Dialog = {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

export type HistoryItem = {
  id: string;
  model: string;
  prompts: string[];
  createdAt: number;
  /** Bumped whenever the batch updates — used by the master-server merge. */
  updatedAt?: number;
  batch: OpenRouterBatch | null;
  error?: string;
  title?: string;
};

/** Converts a pulled server conversation into a local dialog. `makeId`
 * supplies fresh local ids for the messages (injected so this stays pure). */
export function conversationToDialog(
  conv: PulledConversation,
  makeId: () => string,
): Dialog {
  const updated = conv.updated_at ? Date.parse(conv.updated_at) : NaN;
  const created = conv.created_at ? Date.parse(conv.created_at) : NaN;
  const updatedAt = Number.isFinite(updated) ? updated : Date.now();
  return {
    id: conv.external_id,
    title: conv.title,
    model: conv.model || "",
    messages: conv.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const ts = m.created_at ? Date.parse(m.created_at) : NaN;
        return {
          id: makeId(),
          role: m.role as "user" | "assistant",
          content: m.content,
          // Server-side id — enables per-message deletion on the phone.
          serverId: m.id ?? undefined,
          // UTC instant (server stamps are +00:00 now) for per-message dates.
          createdAt: Number.isFinite(ts) ? ts : undefined,
          // Exact serving model per reply (assistant), e.g. with ":flex".
          model: m.model ?? undefined,
          // OpenRouter metadata (assistant replies only).
          reasoning: m.reasoning ?? undefined,
          provider: m.provider ?? undefined,
          genId: m.gen_id ?? undefined,
          tokensPrompt: m.tokens_prompt ?? undefined,
          tokensCompletion: m.tokens_completion ?? undefined,
          totalTokens: m.total_tokens ?? undefined,
          cost: m.cost ?? undefined,
        };
      }),
    createdAt: Number.isFinite(created) ? created : updatedAt,
    updatedAt,
  };
}

/** Rebuilds a synthetic (already-"completed") OpenRouterBatch from the
 * flattened prompt/answer message pairs a sync pull returns. */
export function conversationToHistoryItem(conv: PulledConversation): HistoryItem {
  const created = conv.created_at ? Date.parse(conv.created_at) : NaN;
  const createdAt = Number.isFinite(created) ? created : Date.now();
  const prompts: string[] = [];
  const results: OpenRouterBatchResultItem[] = [];
  let reqIndex = 0;

  for (let i = 0; i < conv.messages.length; i++) {
    const message = conv.messages[i];
    if (message.role !== "user") continue;
    reqIndex += 1;
    prompts.push(message.content);
    // Keep ALL assistant answers that directly follow this prompt — web ⚡
    // Batch chats store one per selected model. The first becomes `req-N`,
    // the parallels `req-Nb`, `req-Nc`, … (letter suffixes keep the batches
    // screen's `custom_id → prompt index` strip-non-digits mapping correct).
    let variant = 0;
    for (
      let j = i + 1;
      j < conv.messages.length && conv.messages[j].role === "assistant";
      j++, variant++
    ) {
      const answer = conv.messages[j];
      const suffix = variant === 0 ? "" : String.fromCharCode(97 + variant); // b, c, …
      const customId = `req-${reqIndex}${suffix}`;
      results.push({
        id: `res-${customId}`,
        custom_id: customId,
        response: {
          status_code: 200,
          body: {
            id: `res-${customId}`,
            model: answer.model || conv.model || "",
            raw: null,
            choices: [
              { index: 0, message: { role: "assistant", content: answer.content }, finish_reason: "stop" },
            ],
          },
        },
      });
    }
  }

  // Counts must stay consistent (completed + failed = total) even when a
  // prompt has several parallel answers: every answer is one synthetic
  // request, plus one virtual failure per prompt that got no answer at all.
  const answeredPrompts = new Set(
    results
      .map((r) => r.custom_id)
      .filter((id) => /^req-\d+$/.test(id)),
  ).size;
  const failed = prompts.length - answeredPrompts;

  const batch: OpenRouterBatch = {
    id: conv.external_id,
    object: "batch",
    endpoint: "/v1/chat/completions",
    model: conv.model || "",
    completion_window: "24h",
    status: "completed",
    created_at: Math.floor(createdAt / 1000),
    finalized_at: Math.floor(createdAt / 1000),
    request_counts: {
      total: results.length + failed,
      completed: results.length,
      failed,
    },
    usage: null,
    results,
    error: null,
  };

  return {
    id: conv.external_id,
    model: conv.model || "",
    prompts,
    createdAt,
    batch,
    title: conv.title,
  };
}