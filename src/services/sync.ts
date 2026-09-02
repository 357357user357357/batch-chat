/**
 * Multi-device sync against a batch-chat-server.
 *
 * Pairing = logging in like the web UI (POST /api/auth/login with the shared
 * password): the returned bearer token doubles as this phone's sync key, so
 * three PCs and this phone can all sync the same account with no separate
 * device registry. Push sends every local dialog/batch (plus ids deleted
 * locally since the last sync); pull merges the server's view back in
 * (per-conversation last-write-wins, tombstones remove locally too).
 */
import {
  type OpenRouterBatch,
  type OpenRouterBatchResultItem,
} from "@/services/openrouter";
import {
  getStoredApiKey,
  getStoredTavilyApiKey,
  storeApiKey,
  storeTavilyApiKey,
} from "@/services/key-store";
import { loadJSON, saveJSON } from "@/services/storage";

const DIALOGS_STORAGE_KEY = "openrouter.dialogs.v1";
const BATCHES_STORAGE_KEY = "openrouter.batches.history.v1";
const SYNC_SETTINGS_KEY = "sync.settings.v1";
const SYNC_SNAPSHOT_KEY = "sync.snapshotIds.v1";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  latexContent?: string;
  error?: boolean;
};

type Dialog = {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

type HistoryItem = {
  id: string;
  model: string;
  prompts: string[];
  createdAt: number;
  batch: OpenRouterBatch | null;
  error?: string;
  title?: string;
};

export type SyncSettings = {
  serverUrl: string;
  token: string;
  lastSyncAt: string | null;
};

type SyncSnapshot = { dialogIds: string[]; batchIds: string[] };

type PulledConversation = {
  external_id: string;
  kind: string;
  model: string | null;
  title: string;
  created_at: string | null;
  updated_at: string | null;
  deleted: boolean;
  messages: { role: string; content: string; model: string | null }[];
};

let idCounter = 0;
function makeLocalId(): string {
  idCounter += 1;
  return `sync-${Date.now().toString(36)}-${idCounter}`;
}

function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

const FETCH_TIMEOUT_MS = 15000;

/** fetch() with a hard timeout so a dead/unreachable server fails loudly
 * instead of leaving the UI stuck on "Syncing…" forever. */
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "The server didn't respond in time — check the address and your connection.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getSyncSettings(): Promise<SyncSettings | null> {
  return loadJSON<SyncSettings | null>(SYNC_SETTINGS_KEY, null);
}

/** Pairs this device with a server, the same way the web UI logs in. */
export async function pairDevice(serverUrl: string, password: string): Promise<void> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) {
    throw new Error("Enter the server address (e.g. https://myserver.example.com).");
  }
  const resp = await fetchWithTimeout(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!resp.ok) {
    throw new Error(resp.status === 401 ? "Wrong password." : `Server error (HTTP ${resp.status}).`);
  }
  const data = (await resp.json()) as { token: string };
  const settings: SyncSettings = { serverUrl: base, token: data.token, lastSyncAt: null };
  await saveJSON(SYNC_SETTINGS_KEY, settings);
}

export async function unpairDevice(): Promise<void> {
  await saveJSON(SYNC_SETTINGS_KEY, null);
  await saveJSON(SYNC_SNAPSHOT_KEY, null);
}

export type SyncSummary = { pushed: number; pulled: number };

async function syncErrorMessage(resp: Response): Promise<string> {
  if (resp.status === 401) return "Pairing expired — pair this device again.";
  try {
    const data = (await resp.json()) as { detail?: string };
    return data.detail || `Server error (HTTP ${resp.status}).`;
  } catch {
    return `Server error (HTTP ${resp.status}).`;
  }
}

function conversationToDialog(conv: PulledConversation): Dialog {
  const updated = conv.updated_at ? Date.parse(conv.updated_at) : NaN;
  const created = conv.created_at ? Date.parse(conv.created_at) : NaN;
  const updatedAt = Number.isFinite(updated) ? updated : Date.now();
  return {
    id: conv.external_id,
    title: conv.title,
    model: conv.model || "",
    messages: conv.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: makeLocalId(),
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    createdAt: Number.isFinite(created) ? created : updatedAt,
    updatedAt,
  };
}

/** Rebuilds a synthetic (already-"completed") OpenRouterBatch from the
 * flattened prompt/answer message pairs a sync pull returns. */
function conversationToHistoryItem(conv: PulledConversation): HistoryItem {
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
    const next = conv.messages[i + 1];
    if (next && next.role === "assistant") {
      const customId = `req-${reqIndex}`;
      results.push({
        id: `res-${customId}`,
        custom_id: customId,
        response: {
          status_code: 200,
          body: {
            id: `res-${customId}`,
            model: conv.model || "",
            raw: null,
            choices: [
              { index: 0, message: { role: "assistant", content: next.content }, finish_reason: "stop" },
            ],
          },
        },
      });
    }
  }

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
      total: prompts.length,
      completed: results.length,
      failed: prompts.length - results.length,
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

/** Push every local dialog/batch, then pull the server's view back in.
 * Last-write-wins per conversation; server-side tombstones remove the local
 * copy too. Throws with a user-facing message on any failure. */
export async function runSync(): Promise<SyncSummary> {
  const settings = await getSyncSettings();
  if (!settings) throw new Error("Pair this device with a server first.");

  const [dialogs, batches, snapshot] = await Promise.all([
    loadJSON<Dialog[]>(DIALOGS_STORAGE_KEY, []),
    loadJSON<HistoryItem[]>(BATCHES_STORAGE_KEY, []),
    loadJSON<SyncSnapshot | null>(SYNC_SNAPSHOT_KEY, null),
  ]);

  // Anything present in the last synced snapshot but missing locally now was
  // deleted on this device since the last sync -> tell the server to tombstone it.
  const currentIds = new Set([...dialogs.map((d) => d.id), ...batches.map((b) => b.id)]);
  const previousIds = new Set([...(snapshot?.dialogIds ?? []), ...(snapshot?.batchIds ?? [])]);
  const deletedIds = [...previousIds].filter((id) => !currentIds.has(id));

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.token}`,
  };

  // Offer this device's provider keys so the server can adopt any it lacks
  // (unified OpenRouter/Tavily keys across phone + server).
  const [openrouterKey, tavilyKey] = await Promise.all([
    getStoredApiKey(),
    getStoredTavilyApiKey(),
  ]);

  const pushResp = await fetchWithTimeout(`${settings.serverUrl}/api/sync/push`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      dialogs: dialogs.map((d) => ({
        id: d.id,
        title: d.title,
        model: d.model,
        messages: d.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content })),
      })),
      batches: batches.map((b) => ({
        id: b.id,
        title: b.title,
        model: b.model,
        prompts: b.prompts,
        batch: b.batch,
      })),
      deleted_external_ids: deletedIds,
      keys: {
        openrouter_api_key: openrouterKey ?? "",
        tavily_api_key: tavilyKey ?? "",
      },
    }),
  });
  if (!pushResp.ok) throw new Error(await syncErrorMessage(pushResp));
  const pushResult = (await pushResp.json()) as {
    created: number;
    updated: number;
    deleted: number;
  };

  const pullUrl = new URL(`${settings.serverUrl}/api/sync/pull`);
  if (settings.lastSyncAt) pullUrl.searchParams.set("since", settings.lastSyncAt);
  const pullResp = await fetchWithTimeout(pullUrl.toString(), { headers });
  if (!pullResp.ok) throw new Error(await syncErrorMessage(pullResp));
  const pullResult = (await pullResp.json()) as {
    server_time: string;
    conversations: PulledConversation[];
    keys?: { openrouter_api_key?: string; tavily_api_key?: string };
  };

  // Adopt any keys the server already has that this device is missing.
  if (pullResult.keys?.openrouter_api_key && !(await getStoredApiKey())) {
    await storeApiKey(pullResult.keys.openrouter_api_key);
  }
  if (pullResult.keys?.tavily_api_key && !(await getStoredTavilyApiKey())) {
    await storeTavilyApiKey(pullResult.keys.tavily_api_key);
  }

  let nextDialogs = dialogs;
  let nextBatches = batches;
  for (const conv of pullResult.conversations) {
    if (conv.kind === "batch") {
      nextBatches = nextBatches.filter((b) => b.id !== conv.external_id);
      if (!conv.deleted) nextBatches = [...nextBatches, conversationToHistoryItem(conv)];
    } else {
      nextDialogs = nextDialogs.filter((d) => d.id !== conv.external_id);
      if (!conv.deleted) nextDialogs = [...nextDialogs, conversationToDialog(conv)];
    }
  }

  const nextSnapshot: SyncSnapshot = {
    dialogIds: nextDialogs.map((d) => d.id),
    batchIds: nextBatches.map((b) => b.id),
  };
  const nextSettings: SyncSettings = { ...settings, lastSyncAt: pullResult.server_time };

  await Promise.all([
    saveJSON(DIALOGS_STORAGE_KEY, nextDialogs),
    saveJSON(BATCHES_STORAGE_KEY, nextBatches),
    saveJSON(SYNC_SNAPSHOT_KEY, nextSnapshot),
    saveJSON(SYNC_SETTINGS_KEY, nextSettings),
  ]);

  return {
    pushed: pushResult.created + pushResult.updated + pushResult.deleted,
    pulled: pullResult.conversations.length,
  };
}
