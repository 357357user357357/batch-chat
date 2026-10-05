// Catalog display names for model ids.
// OpenRouter's /models endpoint gives a human name ("GLM-5.3 Flash") for each
// id ("z-ai/glm-5.3-flash"). We prime a cache from that list and fall back to
// shortModelName() for anything unknown (e.g. custom providers).

import { listModels } from "./openrouter";
import {
    normalizeModelKey,
    setModelDisplayNameResolver,
    shortModelName,
} from "./message-meta";

export { normalizeModelKey };

const nameByKey = new Map<string, string>();
let version = 0;
const listeners = new Set<() => void>();
let priming: Promise<void> | null = null;

// Plug the catalog cache into the pure message-meta formatter, so bubble
// captions (metadataLabel) render friendly names without importing RN code.
setModelDisplayNameResolver((id) => nameByKey.get(normalizeModelKey(id)) ?? null);

/** Display name for a model id: catalog name when known (with 🧊/⚡ tier
 * marks), else the short id fragment. Never returns null. */
export function modelDisplayName(id: string | null | undefined): string {
  if (!id) return "";
  return shortModelName(id) || id;
}

export function getModelNamesVersion(): number {
  return version;
}

export function subscribeModelNames(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // A broken listener must not block the others.
    }
  }
}

function ingest(models: { id: string; name: string }[]): boolean {
  let changed = false;
  for (const m of models) {
    const key = normalizeModelKey(m.id);
    if (m.name && nameByKey.get(key) !== m.name) {
      nameByKey.set(key, m.name);
      changed = true;
    }
  }
  if (changed) {
    version += 1;
    notify();
  }
  return changed;
}

/** Feed catalog entries already fetched elsewhere (e.g. ModelChips.load)
 * into the cache without a second network call. */
export function ingestModelNames(models: { id: string; name: string }[]): void {
  ingest(models);
}

export async function primeModelNames(): Promise<void> {
  try {
    ingest(await listModels());
  } catch {
    // Offline or provider error: keep whatever cache we have; the next
    // ensureModelNamesPrimed() call retries.
  }
}

// Kick off a fetch at most once concurrently; safe to call on every mount.
export function ensureModelNamesPrimed(): Promise<void> {
  if (!priming) {
    priming = primeModelNames().finally(() => {
      priming = null;
    });
  }
  return priming;
}
