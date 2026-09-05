/**
 * Thin TypeScript client for the OpenRouter API.
 *
 * Two ways to provide the API key:
 *  1. Runtime, saved by the user in the app (preferred): stored via
 *     `expo-secure-store` (Android Keystore / iOS Keychain), never shipped
 *     in the bundle. See `src/services/key-store.ts` and the UI in
 *     `src/components/batch-test-card.tsx`.
 *  2. Build time env var `EXPO_PUBLIC_OPENROUTER_API_KEY` (`.env.local`,
 *     gitignored). NOTE: `EXPO_PUBLIC_*` values end up *inside the shipped
 *     JS bundle* and are visible to anyone who downloads the app, so for a
 *     production app the key should live on your own backend / EAS Function.
 *
 * Besides the synchronous chat + concurrency-limited batch helpers, this
 * module implements the OpenRouter asynchronous Batch API
 * (`POST/GET https://openrouter.ai/api/beta/batches`), which costs ~50% of
 * the standard per-token model price.
 */

import { getCacheDurationSeconds } from "@/services/cache-settings";

export type OpenRouterRole = 'system' | 'user' | 'assistant';

export type OpenRouterMessage = {
  role: OpenRouterRole;
  content: string;
};

/** Explicit Anthropic-style prompt caching with the TTL the user chose in the
 * app (300s = 5 minutes, or 3600s = 1 hour). */
type PromptCacheControl = { type: "ephemeral"; ttl?: "1h" };
type CachedTextBlock = {
  type: "text";
  text: string;
  cache_control: PromptCacheControl;
};
type CacheableMessage =
  | OpenRouterMessage
  | { role: OpenRouterRole; content: CachedTextBlock[] };

/** Marks a request's message array as a prompt-cache prefix. The final message
 * is left dynamic (it is the new question/turn); the breakpoint is the message
 * right before it, so the stable prefix (system + history) is cached. */
function withPromptCache(
  messages: OpenRouterMessage[],
  ttlSeconds: number
): CacheableMessage[] {
  if (ttlSeconds <= 0) return messages;
  // OpenRouter expects an Anthropic cache_control where the 5-minute cache is
  // just "ephemeral" (no ttl) and the extended cache is the string "1h". A
  // numeric ttl-in-seconds is silently dropped, which disables caching entirely.
  const cacheControl: PromptCacheControl =
    ttlSeconds >= 3600 ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
  const breakpoint = messages.length >= 2 ? messages.length - 2 : 0;
  return messages.map((message, index) => {
    if (index !== breakpoint || typeof message.content !== "string") {
      return message;
    }
    return {
      role: message.role,
      content: [
        {
          type: "text",
          text: message.content,
          cache_control: cacheControl,
        },
      ],
    };
  });
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ChatRequestOptions = {
  /** OpenRouter model id, e.g. "openai/gpt-4o-mini" or your custom model alias. */
  model: string;
  temperature?: number;
  max_tokens?: number;
  /** Thinking budget via OpenRouter's unified reasoning parameter.
   *  'none' disables reasoning; the others set the effort level. */
  reasoning?: ReasoningEffort;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type OpenRouterUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ChatCompletion = {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: OpenRouterMessage;
    finish_reason: string;
  }>;
  usage?: OpenRouterUsage;
  raw: unknown;
};

export type BatchJob = {
  messages: OpenRouterMessage[];
  options?: Pick<ChatRequestOptions, 'temperature' | 'max_tokens' | 'timeoutMs'>;
};

export type BatchConfig = {
  model: string;
  concurrency?: number;
  retries?: number;
  timeoutMs?: number;
};

export type BatchResult = {
  ok: boolean;
  value?: ChatCompletion;
  error?: string;
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Asynchronous Batch API: 50% of the model's per-token price, 24h window.
 * https://openrouter.ai/docs/batch-quickstart
 */
const OPENROUTER_BATCH_URL = 'https://openrouter.ai/api/beta/batches';

/** Full catalog of models available on OpenRouter (used for pickers). */
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** Cheaper batch model: 50% off the standard price. */
export const OPENROUTER_BATCH_MODEL =
  process.env.EXPO_PUBLIC_OPENROUTER_BATCH_MODEL ?? 'anthropic/claude-fable-5.1:batch';

export const OPENROUTER_MODEL =
  process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? '~deepseek/deepseek-v4-flash-latest';

/**
 * Processing-tier suffix support (same grammar as the server):
 *   "vendor/model:flex" → Flex processing tier (service_tier="flex", cheaper /
 *     slower). If the provider doesn't offer flex for the model (e.g. some
 *     Astra releases), the request is automatically retried on the standard
 *     tier — so ":flex" is always safe to append for any future model.
 */
const FLEX_SUFFIX = ':flex';

export function splitModelVariant(model: string): { base: string; flex: boolean } {
  const trimmed = model.trim();
  if (trimmed.endsWith(FLEX_SUFFIX)) {
    return { base: trimmed.slice(0, -FLEX_SUFFIX.length), flex: true };
  }
  return { base: trimmed, flex: false };
}

function isFlexUnsupportedError(status: number | undefined, body: unknown): boolean {
  if (status !== 400) return false;
  const text =
    typeof body === 'string'
      ? body
      : JSON.stringify(body ?? '').toLowerCase();
  return text.toLowerCase().includes('service_tier') || text.toLowerCase().includes('flex');
}

export class OpenRouterError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
    this.body = body;
  }
}

/** True when the API key is configured in the environment. */
export function isConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_OPENROUTER_API_KEY);
}

/** Returns the build-time env key, if any (visible to anyone with the bundle). */
export function getEnvApiKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
  return key || undefined;
}

/**
 * Resolves the API key at call time: env key first (dev convenience), then the
 * key the user saved in the app's secure storage (see `key-store.ts`).
 * Returns `undefined` when no key is available anywhere.
 */
export async function resolveApiKey(): Promise<string | undefined> {
  const envKey = getEnvApiKey();
  if (envKey) return envKey;

  try {
    const { getStoredApiKey } = await import('./key-store');
    const stored = await getStoredApiKey();
    return stored ?? undefined;
  } catch {
    return undefined;
  }
}

/** Throws a descriptive error when the API key is missing (env or stored). */
export function getApiKey(): string {
  const key = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
  if (!key) {
    throw new OpenRouterError(
      'No OpenRouter API key configured. Add one in the app settings or set EXPO_PUBLIC_OPENROUTER_API_KEY in .env.local.'
    );
  }
  return key;
}

async function requestWithTimeout(
  options: ChatRequestOptions,
  messages: OpenRouterMessage[]
): Promise<ChatCompletion> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const localSignal = controller.signal;
  const externalSignal = options.signal;
  const abortListener = () => controller.abort();
  externalSignal?.addEventListener('abort', abortListener, { once: true });

  try {
    const key = await resolveApiKey();
    if (!key) {
      throw new OpenRouterError(
        'No OpenRouter API key configured. Add one in the app settings or set EXPO_PUBLIC_OPENROUTER_API_KEY in .env.local.'
      );
    }
    const { base, flex } = splitModelVariant(options.model);
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: base,
        messages: withPromptCache(messages, await getCacheDurationSeconds()),
        temperature: options.temperature,
        max_tokens: options.max_tokens,
        ...(options.reasoning
          ? {
              reasoning:
                options.reasoning === 'none'
                  ? { enabled: false }
                  : { effort: options.reasoning },
            }
          : {}),
        ...(flex ? { service_tier: 'flex' as const } : {}),
      }),
      signal: localSignal,
    });

    if (!response.ok) {
      let detail: unknown;
      try {
        detail = await response.json();
      } catch {
        detail = await response.text();
      }
      // Flex tier not available for this model → retry on the standard tier
      if (flex && isFlexUnsupportedError(response.status, detail)) {
        const retry = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: base,
            messages: withPromptCache(messages, await getCacheDurationSeconds()),
            temperature: options.temperature,
            max_tokens: options.max_tokens,
          }),
          signal: localSignal,
        });
        if (!retry.ok) {
          let retryDetail: unknown;
          try {
            retryDetail = await retry.json();
          } catch {
            retryDetail = await retry.text();
          }
          throw new OpenRouterError(
            `OpenRouter request failed with HTTP ${retry.status}`,
            retry.status,
            retryDetail
          );
        }
        const retryRaw = await retry.json();
        return { ...(retryRaw as ChatCompletion), raw: retryRaw };
      }
      throw new OpenRouterError(
        `OpenRouter request failed with HTTP ${response.status}`,
        response.status,
        detail
      );
    }

    const raw = await response.json();
    return { ...(raw as ChatCompletion), raw };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortListener);
  }
}

/** Single chat completion against OpenRouter. */
export async function chat(
  messages: OpenRouterMessage[],
  options: ChatRequestOptions
): Promise<ChatCompletion> {
  return requestWithTimeout(options, messages);
}

/**
 * Rewrites a raw user question so every mathematical expression is wrapped in
 * LaTeX delimiters (`$…$` inline / `$$…$$` display). The chat screen runs this
 * in parallel with the real answer so the asking bubble gets "corrected" while
 * the model is still thinking, matching the rikkihub behavior.
 *
 * Wording, tone, punctuation, casing and meaning are preserved — the model is
 * only allowed to add math delimiters/notation. Returns the corrected text
 * ('' when the model returned nothing usable).
 */
export async function formatQuestionLatex(
  question: string,
  model: string
): Promise<string> {
  const completion = await chat(
    [
      {
        role: "system",
        content:
          "You are a LaTeX formatting assistant. Rewrite the user's message so that every mathematical expression, formula, equation, fraction, variable, exponent, subscript, Greek letter, operator, and symbol is wrapped in LaTeX math delimiters. Use $...$ for inline math and $$...$$ for display math. Keep all words, tone, punctuation, casing, and meaning exactly unchanged. Do not answer the question and do not add any explanation. Return only the rewritten message.",
      },
      { role: "user", content: question },
    ],
    { model, temperature: 0, max_tokens: 2000, timeoutMs: 30_000 },
  );

  const corrected = completion.choices?.[0]?.message?.content ?? "";
  return corrected.trim();
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs several dialogs through the model with a bounded concurrency and
 * optional per-request retries. Never rejects: every job resolves to a
 * `BatchResult` (ok/error), so callers can inspect failures per job.
 */
export async function batchChat(
  jobs: BatchJob[],
  config: BatchConfig
): Promise<BatchResult[]> {
  const concurrency = Math.max(1, Math.min(config.concurrency ?? 3, jobs.length || 1));
  const retries = Math.max(0, config.retries ?? 1);
  const results: BatchResult[] = new Array(jobs.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= jobs.length) return;

      const job = jobs[index];
      const options: ChatRequestOptions = {
        model: config.model,
        timeoutMs: config.timeoutMs,
        ...job.options,
      };

      let lastError: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          results[index] = { ok: true, value: await requestWithTimeout(options, job.messages) };
          break;
        } catch (error) {
          lastError = error;
          if (error instanceof OpenRouterError && (error.status === 429 || (error.status ?? 0) >= 500)) {
            await delay(400 * 2 ** attempt); // backoff on rate-limit / server errors
          }
        }
      }
      if (!results[index]) {
        results[index] = {
          ok: false,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        };
      }
    }
  };

  const pool: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    pool.push(worker());
  }
  await Promise.all(pool);

  return results;
}
// ---------------------------------------------------------------------------
// OpenRouter asynchronous Batch API (≈50% of model price, 24h window).
// Docs: https://openrouter.ai/docs/batch-quickstart
// ---------------------------------------------------------------------------

export type OpenRouterBatchStatus =
  | 'validating'
  | 'in_progress'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelling'
  | 'cancelled';

const BATCH_TERMINAL_STATUSES: ReadonlySet<OpenRouterBatchStatus> = new Set([
  'completed',
  'failed',
  'expired',
  'cancelled',
]);

export type OpenRouterBatchRequest = {
  custom_id: string;
  body: {
    messages: CacheableMessage[];
    temperature?: number;
    max_tokens?: number;
  };
};

export type OpenRouterBatchResultItem = {
  id: string;
  custom_id: string;
  response?: {
    status_code: number;
    request_id?: string;
    body?: ChatCompletion & { choices?: Array<{ message?: OpenRouterMessage; finish_reason?: string }> };
  };
  error?: unknown;
};

export type OpenRouterBatch = {
  id: string;
  object: string;
  endpoint: string;
  model: string;
  completion_window: string;
  status: OpenRouterBatchStatus;
  created_at: number;
  finalized_at: number | null;
  request_counts: {
    total: number;
    completed: number;
    failed: number;
  };
  usage: unknown;
  results: OpenRouterBatchResultItem[] | null;
  error: unknown;
};

export type BatchOutcome = {
  custom_id: string;
  ok: boolean;
  answer?: string;
  status?: number;
  error?: string;
};

async function parseError(response: Response): Promise<never> {
  let detail: unknown;
  try {
    detail = await response.json();
  } catch {
    detail = await response.text();
  }
  throw new OpenRouterError(
    `OpenRouter request failed with HTTP ${response.status}`,
    response.status,
    detail
  );
}

/**
 * Submits an asynchronous batch of chat completions. Returns the batch object
 * (status is normally `validating` right after creation). The batch-level
 * `model` is applied to every request.
 */
export async function createBatch(
  jobs: BatchJob[],
  model: string = OPENROUTER_BATCH_MODEL
): Promise<OpenRouterBatch> {
  const key = await resolveApiKey();
  if (!key) {
    throw new OpenRouterError(
      'No OpenRouter API key configured. Add one in the app settings or set EXPO_PUBLIC_OPENROUTER_API_KEY in .env.local.'
    );
  }

  const ttlSeconds = await getCacheDurationSeconds();
  const requests: OpenRouterBatchRequest[] = jobs.map((job, index) => ({
    custom_id: `req-${index + 1}`,
    body: {
      messages: withPromptCache(job.messages, ttlSeconds),
      ...(job.options?.temperature !== undefined
        ? { temperature: job.options.temperature }
        : {}),
      ...(job.options?.max_tokens !== undefined ? { max_tokens: job.options.max_tokens } : {}),
    },
  }));

  // The docs require `endpoint` and `model` to be serialized BEFORE
  // `requests` (the API stream-parses the body). JSON.stringify preserves
  // the insertion order of plain object keys, so build the payload accordingly.
  const response = await fetch(OPENROUTER_BATCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ endpoint: '/v1/chat/completions', model, requests }),
  });
  if (!response.ok) await parseError(response);
  return (await response.json()) as OpenRouterBatch;
}

/**
 * Returns the current state of a batch (results are inline once completed).
 * Retries transient 404/5xx responses (the beta API can occasionally 404 a
 * batch right after it was created).
 */
export async function getBatch(batchId: string): Promise<OpenRouterBatch> {
  const key = await resolveApiKey();
  if (!key) {
    throw new OpenRouterError(
      'No OpenRouter API key configured. Add one in the app settings or set EXPO_PUBLIC_OPENROUTER_API_KEY in .env.local.'
    );
  }
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(`${OPENROUTER_BATCH_URL}/${batchId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (response.ok) return (await response.json()) as OpenRouterBatch;

    const retriable = response.status === 404 || response.status >= 500;
    if (retriable && attempt < maxAttempts) {
      await delay(1500 * attempt);
      continue;
    }
    await parseError(response);
  }
  throw new OpenRouterError(`Unable to fetch batch ${batchId}.`);
}

/** True when the batch reached a terminal state. */
export function isBatchTerminal(batch: OpenRouterBatch): boolean {
  return BATCH_TERMINAL_STATUSES.has(batch.status);
}
export type WaitForBatchOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onPoll?: (batch: OpenRouterBatch) => void;
};

/**
 * Polls the batch until it reaches a terminal status or the timeout expires.
 * Throws `OpenRouterError` on timeout/abort; a `failed` batch also throws
 * (details in `.body.error`).
 */
export async function waitForBatch(
  batchId: string,
  options: WaitForBatchOptions = {}
): Promise<OpenRouterBatch> {
  const pollIntervalMs = options.pollIntervalMs ?? 10_000;
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const startedAt = Date.now();

  let batch = await getBatch(batchId);
  while (!isBatchTerminal(batch)) {
    options.onPoll?.(batch);
    if (options.signal?.aborted) {
      throw new OpenRouterError('Wait for batch aborted by the caller.');
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new OpenRouterError(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for batch ${batchId}.`
      );
    }
    await delay(pollIntervalMs);
    batch = await getBatch(batchId);
  }
  if (batch.status === 'failed') {
    throw new OpenRouterError(`Batch ${batchId} failed.`, undefined, batch.error);
  }
  return batch;
}

/** Maps batch results to a per-job outcome, extracting the assistant answer. */
export function extractBatchAnswers(batch: OpenRouterBatch): BatchOutcome[] {
  const results = batch.results ?? [];
  return results.map((result) => {
    const customId = result.custom_id;
    if (result.error) {
      return {
        custom_id: customId,
        ok: false,
        error: typeof result.error === 'string' ? result.error : JSON.stringify(result.error),
      };
    }
    const response = result.response;
    if (!response || response.status_code !== 200) {
      return {
        custom_id: customId,
        ok: false,
        status: response?.status_code,
        error: response ? `HTTP ${response.status_code}` : 'No response',
      };
    }
    const content = response.body?.choices?.[0]?.message?.content ?? '';
    return { custom_id: customId, ok: true, answer: content, status: 200 };
  });
}

/** A model entry as returned by `GET /api/v1/models` (subset of fields). */
export type OpenRouterModelInfo = {
  id: string;
  name: string;
  context_length?: number;
  created?: number;
  description?: string;
  pricing?: { prompt?: number; completion?: number };
};

/** True when a model id targets the (cheaper) Batch API (`:batch` suffix). */
export function isBatchModelId(id: string): boolean {
  return id.trim().toLowerCase().endsWith(':batch');
}

/**
 * Fetches the list of models available on OpenRouter for the current key.
 * Batch-capable models (`…:batch`) are included in the same response, which
 * lets the UI build separate pickers for live chat and for batches.
 */
export async function listModels(): Promise<OpenRouterModelInfo[]> {
  const key = await resolveApiKey();
  if (!key) {
    throw new OpenRouterError(
      'No OpenRouter API key configured. Add one in the app settings or set EXPO_PUBLIC_OPENROUTER_API_KEY in .env.local.'
    );
  }
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) await parseError(response);

  const payload = (await response.json()) as { data?: Array<Record<string, unknown>> };
  const entries = payload.data ?? [];
  return entries
    .filter((entry) => typeof entry?.id === 'string')
    .map((entry) => ({
      id: entry.id as string,
      name: typeof entry.name === 'string' && entry.name ? (entry.name as string) : (entry.id as string),
      context_length:
        typeof entry.context_length === 'number' ? entry.context_length : undefined,
      created: typeof entry.created === 'number' ? entry.created : undefined,
      description:
        typeof entry.description === 'string' && entry.description
          ? (entry.description as string)
          : undefined,
      pricing:
        typeof entry.pricing === 'object' && entry.pricing !== null
          ? {
              prompt: numberFrom((entry.pricing as Record<string, unknown>).prompt),
              completion: numberFrom((entry.pricing as Record<string, unknown>).completion),
            }
          : undefined,
    }))
    .filter((model) => model.id.length > 0);
}

function numberFrom(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}