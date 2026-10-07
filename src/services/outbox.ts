/**
 * Offline outbox for the live chat.
 *
 * When a message is sent while the phone has no network (and no token has
 * streamed yet), the request is persisted here instead of failing. A flush
 * pass in chat.tsx replays the stored requests one by one — after the app
 * restarts, on a 20s ticker while items remain, and after every send — and
 * patches the waiting assistant bubble with the answer once the network is
 * back. Storage is AsyncStorage, so the queue survives app kills.
 */
import type { OpenRouterMessage, ReasoningEffort } from "./openrouter";
import { loadJSON, saveJSON } from "./storage";

const OUTBOX_KEY = "openrouter.outbox.v1";

export type OutboxItem = {
  id: string;
  /** Dialog that holds the pending assistant bubble. */
  dialogId: string;
  /** The bubble patched with the answer once the replay succeeds. */
  pendingMessageId: string;
  /** Exact request snapshot (system + history) captured at queue time. */
  requestMessages: OpenRouterMessage[];
  /** Model id, already ":flex"-suffixed when the flex tier was chosen. */
  model: string;
  reasoning: ReasoningEffort | null;
  createdAt?: number;
};

export async function loadOutbox(): Promise<OutboxItem[]> {
  const list = await loadJSON<OutboxItem[]>(OUTBOX_KEY, []);
  return Array.isArray(list) ? list : [];
}

/** Appends an item and returns the new queue length. */
export async function queueOutbox(item: OutboxItem): Promise<number> {
  const list = await loadOutbox();
  list.push(item);
  await saveJSON(OUTBOX_KEY, list);
  return list.length;
}

/** Drops one item and returns the remaining items. */
export async function removeFromOutbox(id: string): Promise<OutboxItem[]> {
  const list = (await loadOutbox()).filter((item) => item.id !== id);
  await saveJSON(OUTBOX_KEY, list);
  return list;
}
