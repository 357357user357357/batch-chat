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
  getStoredApiKey,
  getStoredTavilyApiKey,
  storeApiKey,
  storeTavilyApiKey,
} from "@/services/key-store";
import { loadJSON, saveJSON } from "@/services/storage";
import {
  conversationToDialog,
  conversationToHistoryItem,
  type Dialog,
  type HistoryItem,
  type PulledConversation,
} from "@/services/sync-mapping";
import * as WebBrowser from "expo-web-browser";

const DIALOGS_STORAGE_KEY = "openrouter.dialogs.v1";
const BATCHES_STORAGE_KEY = "openrouter.batches.history.v1";
const SYNC_SETTINGS_KEY = "sync.settings.v1";
const SYNC_SNAPSHOT_KEY = "sync.snapshotIds.v1";

/** Who this device is synced as — fetched from GET /api/auth/me and shown
 * on the sync card so the user always sees which account is syncing. */
export type SyncAccount = {
  account_id: string | null;
  label: string | null;
  email: string | null;
  is_owner: boolean;
};

export type SyncSettings = {
  serverUrl: string;
  token: string;
  lastSyncAt: string | null;
  /** Filled by pairDevice / runSync (best effort — missing info is fine). */
  account?: SyncAccount | null;
};

import * as Device from "expo-device";

import { loadString, saveString } from "@/services/storage";

const DEVICE_NAME_STORAGE_KEY = "sync.deviceName";
let cachedDeviceName: string | null = null;

/**
 * Stable, generic per-install device label for the master server's audit
 * trail — derived from the real device model at runtime (e.g. a phone
 * marketed as "Some Phone 12 Pro" -> "some-phone-12-pro-4kq8") with a random
 * suffix so multiple phones of the same model are distinguishable. No
 * specific device is ever hardcoded.
 */
export async function getDeviceName(): Promise<string> {
  if (cachedDeviceName) return cachedDeviceName;
  const stored = await loadString(DEVICE_NAME_STORAGE_KEY);
  if (stored) {
    cachedDeviceName = stored;
    return stored;
  }
  const model =
    (Device.modelName ?? Device.deviceName ?? "phone")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "phone";
  const suffix = Math.random().toString(36).slice(2, 6);
  const name = `${model}-${suffix}`.slice(0, 40);
  await saveString(DEVICE_NAME_STORAGE_KEY, name);
  cachedDeviceName = name;
  return name;
}

type SyncSnapshot = { dialogIds: string[]; batchIds: string[] };

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

// ------------------------------------------------------------- remember me

type RememberedCredentials = { login: string; password: string };

const REMEMBER_KEY = "sync.rememberCredentials";

/** Login+password kept on the device when "Remember" is checked (null = off). */
export async function getRememberedCredentials(): Promise<RememberedCredentials | null> {
  return loadJSON<RememberedCredentials | null>(REMEMBER_KEY, null);
}

export async function saveRememberedCredentials(
  credentials: RememberedCredentials | null,
): Promise<void> {
  await saveJSON(REMEMBER_KEY, credentials);
}

/**
 * A pasted pairing code may carry the server origin with it:
 * "https://host|account-id|account-key" (copied from the web Settings).
 * Plain passwords and bare "id|key" codes pass through untouched.
 */
export function parsePairingCode(secret: string): { serverUrl: string | null; code: string } {
  const parts = secret.trim().split("|").filter((p) => p.length > 0);
  if (parts.length === 3) return { serverUrl: parts[0], code: `${parts[1]}|${parts[2]}` };
  return { serverUrl: null, code: secret.trim() };
}

/**
 * Pairs this device with a server. Three accepted credentials, tried in
 * order: a pairing code (account_id|account_key, optionally prefixed with
 * the server origin), a login+password combination (when `login` is given),
 * or a plain master password (legacy fallback).
 */
export async function pairDevice(
  serverUrl: string,
  secret: string,
  login?: string,
): Promise<void> {
  const parsed = parsePairingCode(secret);
  const base = normalizeServerUrl(serverUrl || parsed.serverUrl || "");
  if (!base) {
    throw new Error("Enter the server address (e.g. https://myserver.example.com).");
  }
  let token: string | null = null;
  if (login && login.trim()) {
    // Login + password path (client accounts).
    token = await loginWith(base, login.trim(), parsed.code);
  } else {
    const pairResp = await fetchWithTimeout(`${base}/api/auth/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: parsed.code }),
    });
    if (pairResp.ok) {
      token = ((await pairResp.json()) as { token: string }).token;
    } else if (pairResp.status === 404 || pairResp.status === 405) {
      // Older server without the pairing endpoint — plain password login.
      token = await passwordLogin(base, parsed.code);
    } else if (pairResp.status === 401) {
      // Maybe the user typed the password into the same field — try it.
      token = await passwordLogin(base, parsed.code);
    } else {
      throw new Error(`Server error (HTTP ${pairResp.status}).`);
    }
  }
  // Who did we just pair as? (best effort — shown on the sync card)
  const account = await fetchSyncAccount(base, token);
  const settings: SyncSettings = { serverUrl: base, token, lastSyncAt: null, account };
  await saveJSON(SYNC_SETTINGS_KEY, settings);
}

/** Self-service registration: unique e-mail + mandatory password. The
 * server mails a confirmation link; login works after confirming. */
export async function registerAccount(
  serverUrl: string,
  email: string,
  password: string,
): Promise<{ detail?: string }> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) {
    throw new Error("Enter the server address (e.g. https://myserver.example.com).");
  }
  const resp = await fetchWithTimeout(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (!resp.ok) {
    let detail = `Server error (HTTP ${resp.status}).`;
    try {
      const data = (await resp.json()) as { detail?: string };
      if (data.detail) detail = data.detail;
    } catch {}
    throw new Error(detail);
  }
  return (await resp.json()) as { detail?: string };
}

/** Google sign-in: opens the system browser, the server's OAuth callback
 * deep-links back into the app (batchchat://oauth#token=…). Depending on the
 * device, the redirect is either intercepted by the browser session (promise
 * resolves) or delivered straight to the app as a deep link (handled by the
 * /oauth route via completeOAuthFromUrl). Both paths are supported. */
const OAUTH_PENDING_KEY = "sync.oauthPending.v1";

export async function completeOAuthFromUrl(url: string): Promise<void> {
  const fragment = url.split("#")[1] || "";
  const params = new URLSearchParams(fragment);
  const token = params.get("token");
  if (!token) {
    throw new Error("Sign-in did not return a session token.");
  }
  const pending = await loadJSON<{ base?: string } | null>(OAUTH_PENDING_KEY, null);
  const base = pending?.base ? normalizeServerUrl(pending.base) : "";
  if (!base) {
    throw new Error("Missing server address for sign-in.");
  }
  const account = await fetchSyncAccount(base, token);
  const settings: SyncSettings = { serverUrl: base, token, lastSyncAt: null, account };
  await saveJSON(SYNC_SETTINGS_KEY, settings);
  await saveJSON(OAUTH_PENDING_KEY, null);
}

export async function signInWithGoogle(serverUrl: string): Promise<void> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) {
    throw new Error("Enter the server address (e.g. https://myserver.example.com).");
  }
  await saveJSON(OAUTH_PENDING_KEY, { base });
  const result = await WebBrowser.openAuthSessionAsync(
    `${base}/api/auth/oauth/google/start?client=phone`,
    "batchchat://oauth",
  );
  if (result.type === "success" && result.url) {
    await completeOAuthFromUrl(result.url);
    return;
  }
  // On many devices the OS delivers the deep link straight into the app
  // (the /oauth route completes sign-in there). Give it a moment to land,
  // then fail gracefully if nothing arrived.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const settings = await getSyncSettings();
  if (settings?.token && settings.serverUrl === base) {
    await saveJSON(OAUTH_PENDING_KEY, null);
    return;
  }
  throw new Error("Google sign-in was cancelled.");
}

async function loginWith(base: string, login: string, password: string): Promise<string> {
  const resp = await fetchWithTimeout(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password }),
  });
  if (!resp.ok) {
    let detail = resp.status === 401 ? "Wrong login or password." : `Server error (HTTP ${resp.status}).`;
    try {
      const data = (await resp.json()) as { detail?: string };
      if (data.detail) detail = data.detail;
    } catch {}
    throw new Error(detail);
  }
  return ((await resp.json()) as { token: string }).token;
}

async function passwordLogin(base: string, password: string): Promise<string> {
  const resp = await fetchWithTimeout(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!resp.ok) {
    throw new Error(
      resp.status === 401
        ? "Invalid pairing code or wrong password."
        : `Server error (HTTP ${resp.status}).`,
    );
  }
  return ((await resp.json()) as { token: string }).token;
}

export async function unpairDevice(): Promise<void> {
  await saveJSON(SYNC_SETTINGS_KEY, null);
  await saveJSON(SYNC_SNAPSHOT_KEY, null);
  await saveRememberedCredentials(null);
}

/** Self-service account deletion: removes the account and ALL its server-side
 * data (dialogs, messages, batches, sessions), then unpairs this device.
 * The e-mail/login is freed, so the same address can register again. */
export async function deleteAccount(): Promise<{ deleted_dialogs: number }> {
  const settings = await getSyncSettings();
  if (!settings) throw new Error("Not paired to a server.");
  const base = settings.serverUrl.replace(/\/+$/, "");
  const resp = await fetch(`${base}/api/auth/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${settings.token}` },
  });
  if (!resp.ok) throw new Error(await syncErrorMessage(resp));
  const data = (await resp.json()) as { deleted_dialogs?: number };
  await unpairDevice();
  return { deleted_dialogs: data.deleted_dialogs ?? 0 };
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

/** Best-effort account lookup (GET /api/auth/me): who is this token for?
 * Never throws — an unknown account only means the card shows less info. */
async function fetchSyncAccount(
  base: string,
  token: string,
): Promise<SyncAccount | null> {
  try {
    const resp = await fetchWithTimeout(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      account_id?: string | null;
      label?: string | null;
      email?: string | null;
      is_owner?: boolean;
    };
    return {
      account_id: data.account_id ?? null,
      label: data.label ?? null,
      email: data.email ?? null,
      is_owner: Boolean(data.is_owner),
    };
  } catch {
    return null;
  }
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

  const deviceName = await getDeviceName();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.token}`,
    // Audit trail on the master server: which device created/modified/deleted
    // each synced record. Generic per-install name (model + random suffix).
    "X-Device-Name": deviceName,
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
        // Lets the master server merge messages instead of replacing them:
        // web-added messages newer than this stamp are kept on push.
        updated_at: new Date(d.updatedAt).toISOString(),
        messages: d.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role,
            content: m.content,
            // Exact serving model per reply (assistant) — round-trips so the
            // phone shows which model answered each message after a pull.
            model: m.model ?? null,
            reasoning: m.reasoning ?? null,
            provider: m.provider ?? null,
            gen_id: m.genId ?? null,
            tokens_prompt: m.tokensPrompt ?? null,
            tokens_completion: m.tokensCompletion ?? null,
            total_tokens: m.totalTokens ?? null,
            cost: m.cost ?? null,
          })),
      })),
      batches: batches.map((b) => ({
        id: b.id,
        title: b.title,
        model: b.model,
        prompts: b.prompts,
        batch: b.batch,
        updated_at: new Date(b.updatedAt ?? b.createdAt).toISOString(),
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
      if (!conv.deleted) nextDialogs = [...nextDialogs, conversationToDialog(conv, makeLocalId)];
    }
  }

  const nextSnapshot: SyncSnapshot = {
    dialogIds: nextDialogs.map((d) => d.id),
    batchIds: nextBatches.map((b) => b.id),
  };
  // Refresh the account display (email/owner flag) on every successful sync.
  const account = await fetchSyncAccount(settings.serverUrl, settings.token);
  const nextSettings: SyncSettings = {
    ...settings,
    lastSyncAt: pullResult.server_time,
    ...(account ? { account } : {}),
  };

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
