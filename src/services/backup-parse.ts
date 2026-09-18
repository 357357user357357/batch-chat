/**
 * Backup-file parsing, extracted from backup.ts so it can be unit-tested
 * with plain node (no expo-file-system imports here). The payload contract
 * lives here too, so backup.ts just re-exports it.
 */

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

export type ParseBackupResult =
  | { ok: true; payload: BackupPayload }
  | { ok: false; error: string };

/** Heuristic: an unclosed string or an opening bracket that never gets its
 * closer (outside strings) means the copy was cut short — catches every
 * truncation shape regardless of the exact JSON.parse error wording. */
function looksTruncated(fileText: string): boolean {
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (const ch of fileText) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
  }
  return inString || depth > 0;
}

/** Human-friendly message for a JSON parse failure — truncated files (an
 * interrupted copy/transfer) surface as "Unexpected end of JSON input" or a
 * bare "Unexpected end of file", which we translate into an actionable hint.
 * `raw` comes from parseBackupText as "<JSON.parse message>\n<file text>",
 * so every check below looks at the FILE text, never at the error message. */
export function describeJsonError(raw: string): string {
  // Split BEFORE any trimming: the empty-file case is exactly
  // "<message>\n" (trailing newline eaten by trim otherwise).
  const newlineAt = raw.indexOf("\n");
  const fileText = (newlineAt === -1 ? raw : raw.slice(newlineAt + 1)).trim();
  if (!fileText) return "The file is empty.";
  if (fileText.length < 2 || !/[[{]/.test(fileText[0])) {
    return "Not a JSON file — expected a Batch Chat backup.";
  }
  if (
    /unexpected end|unexpectedly ended|end of json|end of file|no content|eof|unterminated/i.test(
      raw,
    ) ||
    looksTruncated(fileText)
  ) {
    return "The file is truncated (incomplete copy) — export the backup again.";
  }
  // "position N" from JSON.parse counts offsets in the file text itself.
  const firstBad = raw.match(/position\s+(\d+)/i);
  if (firstBad) {
    const at = Number(firstBad[1]);
    const around = fileText.slice(Math.max(0, at - 20), at + 20).replace(/\s+/g, " ");
    return `Broken JSON near: …${around}…`;
  }
  return "The file is not valid JSON.";
}

/** Structural check: the fields restoreBackupPayload depends on. */
export function isBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.app === "batch-chat" &&
    Array.isArray(candidate.dialogs) &&
    Array.isArray(candidate.batches)
  );
}

/** Parses backup file contents into a validated payload. */
export function parseBackupText(text: string): ParseBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: describeJsonError(`${message}\n${text}`) };
  }
  if (!isBackupPayload(parsed)) {
    return {
      ok: false,
      error: "Not a Batch Chat backup (missing app/dialogs/batches fields).",
    };
  }
  return { ok: true, payload: parsed };
}