import { AppState } from "react-native";

import { getCacheDurationSeconds, getKeepAliveHours } from "./cache-settings";
import { chat, type OpenRouterMessage } from "./openrouter";

/**
 * Prompt-cache keep-alive (see cache-settings.ts for the cost model).
 *
 * Per dialog (and per model), remembers the exact message list of the last
 * real request and, every 45 minutes while the app is in the foreground and
 * within the keep-alive window, sends it back with a "." user turn and
 * max_tokens=8. The prefix matches the cached entry, so the ping is a cheap
 * cache-read that refreshes the 1-hour TTL — keeping the cache warm for hours
 * after the last real request.
 */
const PING_INTERVAL_MS = 45 * 60 * 1000;
const TICK_MS = 60 * 1000;
/** Output cap for pings — near-empty by design. */
const PING_MAX_TOKENS = 8;

type KeepAliveEntry = {
  model: string;
  /** Returns the EXACT message list of the last real request (the cached
   * prefix). The ping appends a "." user turn on top of it. */
  buildMessages: () => OpenRouterMessage[];
  lastActivity: number;
  lastPing: number;
  failing: boolean;
};

const entries = new Map<string, KeepAliveEntry>();
let timer: ReturnType<typeof setInterval> | null = null;

export function scheduleKeepAlive(
  key: string,
  model: string,
  buildMessages: () => OpenRouterMessage[]
): void {
  entries.set(key, {
    model,
    buildMessages,
    lastActivity: Date.now(),
    lastPing: 0,
    failing: false,
  });
  ensureTimer();
}

export function cancelKeepAlive(key: string): void {
  entries.delete(key);
  if (entries.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
}

async function tick(): Promise<void> {
  if (AppState.currentState !== "active") return; // background timers are unreliable/pointless
  const [hours, cacheSeconds] = await Promise.all([
    getKeepAliveHours(),
    getCacheDurationSeconds(),
  ]);
  if (hours <= 0 || cacheSeconds < 3600) return; // keep-alive only extends a 1h cache

  const now = Date.now();
  for (const [key, entry] of [...entries.entries()]) {
    if (now - entry.lastActivity > hours * 3600 * 1000) {
      entries.delete(key); // window over — let the cache expire
      continue;
    }
    if (entry.failing) continue; // stop pinging a broken entry until re-scheduled
    if (now - entry.lastPing < PING_INTERVAL_MS) continue;
    entry.lastPing = now; // claim before the await (no ping stampede)
    void ping(key, entry);
  }
}

async function ping(key: string, entry: KeepAliveEntry): Promise<void> {
  try {
    const messages: OpenRouterMessage[] = [
      ...entry.buildMessages(),
      { role: "user", content: "." },
    ];
    await chat(messages, {
      model: entry.model,
      max_tokens: PING_MAX_TOKENS,
      // Flex processing is slower — give those pings more headroom.
      timeoutMs: entry.model.endsWith(":flex") ? 90_000 : 30_000,
    });
  } catch {
    // A failed ping must never surface in the UI; stop retrying this entry
    // until the next real request re-schedules it.
    entry.failing = true;
    void key;
  }
}