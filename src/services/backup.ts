/**
 * Full-app backup/restore: bundles the API keys + every local dialog/batch
 * into one JSON file, so moving to a new phone is just
 * "export -> transfer the file -> import" instead of retyping everything.
 */
import { File } from "expo-file-system";

import { saveTextFile, type SaveOutcome } from "@/services/files";
import {
  clearStoredApiKey,
  clearStoredTavilyApiKey,
  getStoredApiKey,
  getStoredTavilyApiKey,
  storeApiKey,
  storeTavilyApiKey,
} from "@/services/key-store";
import { loadJSON, loadString, saveJSON, saveString } from "@/services/storage";

const DIALOGS_STORAGE_KEY = "openrouter.dialogs.v1";
const ACTIVE_DIALOG_STORAGE_KEY = "openrouter.active-dialog.v1";
const BATCHES_STORAGE_KEY = "openrouter.batches.history.v1";
const BATCHES_SELECTED_STORAGE_KEY = "openrouter.batches.selected.v1";

const BACKUP_VERSION = 1;

export type BackupPayload = {
  app: "batch-chat";
  backupVersion: number;
  exportedAt: string;
  openrouterApiKey: string | null;
  tavilyApiKey: string | null;
  dialogs: unknown[];
  activeDialogId: string | null;
  batches: unknown[];
  selectedBatchId: string | null;
};

async function buildBackupPayload(): Promise<BackupPayload> {
  const [openrouterApiKey, tavilyApiKey, dialogs, activeDialogId, batches, selectedBatchId] =
    await Promise.all([
      getStoredApiKey(),
      getStoredTavilyApiKey(),
      loadJSON<unknown[]>(DIALOGS_STORAGE_KEY, []),
      loadString(ACTIVE_DIALOG_STORAGE_KEY),
      loadJSON<unknown[]>(BATCHES_STORAGE_KEY, []),
      loadString(BATCHES_SELECTED_STORAGE_KEY),
    ]);
  return {
    app: "batch-chat",
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    openrouterApiKey,
    tavilyApiKey,
    dialogs,
    activeDialogId,
    batches,
    selectedBatchId,
  };
}

/** Writes every dialog/batch/key to one JSON file and opens the save/share sheet. */
export async function exportBackup(): Promise<SaveOutcome> {
  const payload = await buildBackupPayload();
  const filename = `batch-chat-backup-${payload.exportedAt.slice(0, 10)}.json`;
  return saveTextFile(filename, JSON.stringify(payload, null, 2), "application/json");
}

function isBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.app === "batch-chat" &&
    Array.isArray(candidate.dialogs) &&
    Array.isArray(candidate.batches)
  );
}

/** Overwrites every key/dialog/batch on this device from a restored payload. */
async function restoreBackupPayload(payload: BackupPayload): Promise<void> {
  if (payload.openrouterApiKey) await storeApiKey(payload.openrouterApiKey);
  else await clearStoredApiKey();

  if (payload.tavilyApiKey) await storeTavilyApiKey(payload.tavilyApiKey);
  else await clearStoredTavilyApiKey();

  await saveJSON(DIALOGS_STORAGE_KEY, payload.dialogs ?? []);
  await saveString(ACTIVE_DIALOG_STORAGE_KEY, payload.activeDialogId ?? "");
  await saveJSON(BATCHES_STORAGE_KEY, payload.batches ?? []);
  await saveString(BATCHES_SELECTED_STORAGE_KEY, payload.selectedBatchId ?? "");
}

export type RestoreOutcome = "restored" | "canceled" | "invalid";

/** Opens the system file picker, then restores everything from the chosen
 * backup file (overwrites current dialogs/batches/keys on this device). */
export async function pickAndRestoreBackup(): Promise<RestoreOutcome> {
  const picked = await File.pickFileAsync({ mimeTypes: "application/json" });
  if (picked.canceled || !picked.result) return "canceled";

  let parsed: unknown;
  try {
    parsed = await picked.result.json();
  } catch {
    return "invalid";
  }
  if (!isBackupPayload(parsed)) return "invalid";

  await restoreBackupPayload(parsed);
  return "restored";
}
