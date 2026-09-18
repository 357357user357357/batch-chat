import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeJsonError,
  isBackupPayload,
  parseBackupText,
} from '../../.test-build/backup-parse.mjs';

const validPayload = {
  app: 'batch-chat',
  backupVersion: 1,
  exportedAt: '2026-09-12T10:00:00.000Z',
  openrouterApiKey: 'sk-or-v1-abc',
  tavilyApiKey: null,
  dialogs: [{ id: 'd1', title: 'Hello' }],
  activeDialogId: 'd1',
  batches: [],
  selectedBatchId: null,
};

test('parseBackupText accepts a valid payload', () => {
  const parsed = parseBackupText(JSON.stringify(validPayload));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.payload.openrouterApiKey, 'sk-or-v1-abc');
    assert.deepEqual(parsed.payload.dialogs, [{ id: 'd1', title: 'Hello' }]);
  }
});

test('parseBackupText explains empty files', () => {
  const parsed = parseBackupText('');
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.error, 'The file is empty.');
});

test('parseBackupText recognizes truncated JSON (the reported EOF bug)', () => {
  const truncated = JSON.stringify(validPayload).slice(0, 40);
  const parsed = parseBackupText(truncated);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.error, /truncated/);
  assert.match(describeJsonError('Unexpected end of JSON input\n{"app":'), /truncated/);
});

test('parseBackupText rejects non-backup content', () => {
  // Not even JSON-parseable text.
  const notJson = parseBackupText('hello world');
  assert.equal(notJson.ok, false);
  if (!notJson.ok) assert.match(notJson.error, /Not a JSON file/);

  // Valid JSON, but not a backup payload shape.
  const justAString = parseBackupText('"just a string"');
  assert.equal(justAString.ok, false);
  if (!justAString.ok) assert.match(justAString.error, /Not a Batch Chat backup/);

  const wrongApp = parseBackupText('{"app":"other","dialogs":[],"batches":[]}');
  assert.equal(wrongApp.ok, false);
  if (!wrongApp.ok) assert.match(wrongApp.error, /Not a Batch Chat backup/);
});

test('describeJsonError points at the broken position when known', () => {
  // Real call shape: "<JSON.parse error message>\n<file text>" — the file
  // text starts with `{`, so the first-char sanity check passes.
  const message = describeJsonError(
    'Unexpected token } in JSON at position 42\n{"app":"batch-chat","dialogs":[oops]}',
  );
  assert.match(message, /Broken JSON near/);
});

test('isBackupPayload is a strict structural check', () => {
  assert.equal(isBackupPayload(validPayload), true);
  assert.equal(isBackupPayload({ app: 'batch-chat' }), false);
  assert.equal(isBackupPayload(null), false);
});
