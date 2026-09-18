/**
 * Full-app backup/restore: bundles the API keys + every local dialog/batch
 * into one JSON file, so moving to a new phone is just
 * "export -> transfer the file -> import" instead of retyping everything.
 */
import { File, type PickSingleFileResult } from "expo-file-system";

import {
  parseBackupText,
  type BackupPayload,
} from "@/services/backup-parse";
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

export type { BackupPayload } from "@/services/backup-parse";

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

export type RestoreOutcome = "restored" | "canceled" | "invalid";
export type RestoreResult = { outcome: RestoreOutcome; reason?: string };

/** MIME types accepted by the system file picker. Backups exported via the
 * share sheet frequently arrive as text/plain or application/octet-stream on
 * Android — filtering on application/json alone leaves them unselectable and
 * the SAF intent can even surface as a spurious "selection canceled". */
const BACKUP_MIME_TYPES = [
  "application/json",
  "text/plain",
  "application/octet-stream",
  "application/*",
  "text/*",
];

/** Opens the system file picker, then restores everything from the chosen
 * backup file (overwrites current dialogs/batches/keys on this device).
 * Returns the outcome plus a human-readable `reason` for `invalid`, so the
 * caller can show *why* the file was rejected (truncated JSON, wrong app…). */
export async function pickAndRestoreBackup(): Promise<RestoreResult> {
  let picked: PickSingleFileResult;
  try {
    picked = await File.pickFileAsync({ mimeTypes: BACKUP_MIME_TYPES });
  } catch {
    // Some Android providers throw instead of resolving with `canceled`
    // when the user backs out of the document picker — treat as a cancel.
    return { outcome: "canceled" };
  }
  if (picked.canceled || !picked.result) return { outcome: "canceled" };

  let text: string;
  try {
    text = await picked.result.text();
  } catch {
    return { outcome: "invalid", reason: "Could not read the selected file." };
  }
  const parsed = parseBackupText(text);
  if (!parsed.ok) return { outcome: "invalid", reason: parsed.error };

  await restoreBackupPayload(parsed.payload);
  return { outcome: "restored" };
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
