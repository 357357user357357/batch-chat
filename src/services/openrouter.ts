/**
 * Thin TypeScript client for the OpenRouter API.
 *
 * The API key is read from `process.env.EXPO_PUBLIC_OPENROUTER_API_KEY`
 * (see `.env.example`). `EXPO_PUBLIC_*` variables are inlined into the
 * JS bundle at build/start time, so set them before bundling:
 *
 *   EXPO_PUBLIC_OPENROUTER_API_KEY=sk-or-... npx expo start
 *
 * ⚠️ Note: `EXPO_PUBLIC_*` values end up inside the shipped JS bundle, so
 * they are visible to anyone who can download the app. For a production app
 * the key should live on your own backend / EAS Function instead.
 */

export type OpenRouterRole = 'system' | 'user' | 'assistant';

export type OpenRouterMessage = {
  role: OpenRouterRole;
  content: string;
};

export type ChatRequestOptions = {
  /** OpenRouter model id, e.g. "openai/gpt-4o-mini" or your custom model alias. */
  model: string;
  temperature?: number;
  max_tokens?: number;
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

export const OPENROUTER_MODEL =
  process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';

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

/** Throws a descriptive error when the API key is missing. */
export function getApiKey(): string {
  const key = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
  if (!key) {
    throw new OpenRouterError(
      'EXPO_PUBLIC_OPENROUTER_API_KEY is not set. Copy .env.example to .env.local and fill it in, then restart the bundler.'
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
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: options.temperature,
        max_tokens: options.max_tokens,
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