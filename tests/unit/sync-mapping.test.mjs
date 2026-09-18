import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  conversationToDialog,
  conversationToHistoryItem,
} from '../../.test-build/sync-mapping.mjs';

const CONV = {
  external_id: 'conv-1',
  kind: 'chat',
  model: 'deepseek/deepseek-v4',
  title: 'Test dialog',
  created_at: '2026-09-12T10:00:00+00:00',
  updated_at: '2026-09-12T11:30:00+00:00',
  deleted: false,
  messages: [
    { role: 'system', content: 'sys', model: null },
    {
      role: 'user',
      content: 'Hi',
      model: null,
      id: 41,
      created_at: '2026-09-12T10:00:05+00:00',
    },
    {
      role: 'assistant',
      content: 'Hello!',
      model: 'deepseek/deepseek-v4:flex',
      id: 42,
      created_at: '2026-09-12T10:00:20+00:00',
      reasoning: 'low',
      provider: 'Novita',
      gen_id: 'gen-123',
      tokens_prompt: 100,
      tokens_completion: 200,
      total_tokens: 300,
      cost: 0.0021,
    },
  ],
};

test('conversationToDialog maps a pulled conversation to the local shape', () => {
  let counter = 0;
  const dialog = conversationToDialog(CONV, () => `local-${++counter}`);

  assert.equal(dialog.id, 'conv-1');
  assert.equal(dialog.title, 'Test dialog');
  assert.equal(dialog.model, 'deepseek/deepseek-v4');
  assert.equal(dialog.createdAt, Date.parse('2026-09-12T10:00:00+00:00'));
  assert.equal(dialog.updatedAt, Date.parse('2026-09-12T11:30:00+00:00'));

  // System messages are dropped; user + assistant survive with local ids.
  assert.deepEqual(
    dialog.messages.map((m) => [m.role, m.id]),
    [
      ['user', 'local-1'],
      ['assistant', 'local-2'],
    ],
  );

  const assistant = dialog.messages[1];
  assert.equal(assistant.serverId, 42);
  assert.equal(assistant.model, 'deepseek/deepseek-v4:flex');
  assert.equal(assistant.reasoning, 'low');
  assert.equal(assistant.provider, 'Novita');
  assert.equal(assistant.genId, 'gen-123');
  assert.equal(assistant.totalTokens, 300);
  assert.equal(assistant.cost, 0.0021);
  assert.equal(assistant.createdAt, Date.parse('2026-09-12T10:00:20+00:00'));
});

test('conversationToDialog tolerates missing stamps and ids', () => {
  const dialog = conversationToDialog(
    {
      ...CONV,
      created_at: null,
      updated_at: null,
      messages: [{ role: 'user', content: 'x', model: null }],
    },
    () => 'id-1',
  );
  assert.equal(dialog.createdAt, dialog.updatedAt);
  assert.ok(Number.isFinite(dialog.updatedAt));
  assert.equal(dialog.messages[0].serverId, undefined);
  assert.equal(dialog.messages[0].model, undefined);
});

test('conversationToHistoryItem rebuilds a completed batch with per-result models', () => {
  const item = conversationToHistoryItem(CONV);
  assert.equal(item.id, 'conv-1');
  assert.equal(item.title, 'Test dialog');
  assert.deepEqual(item.prompts, ['Hi']);
  assert.equal(item.batch.status, 'completed');

  const result = item.batch.results[0];
  assert.equal(result.custom_id, 'req-1');
  assert.equal(
    result.response.body.choices[0].message.content,
    'Hello!',
  );
  // The assistant's own model wins over the conversation-level one — the
  // per-result flex marker survives the sync round-trip.
  assert.equal(result.response.body.model, 'deepseek/deepseek-v4:flex');
  assert.deepEqual(item.batch.request_counts, { total: 1, completed: 1, failed: 0 });
});

test('conversationToHistoryItem falls back to the dialog model and counts failures', () => {
  const item = conversationToHistoryItem({
    ...CONV,
    messages: [
      { role: 'user', content: 'q1', model: null },
      { role: 'assistant', content: 'a1', model: null, id: 2 },
      { role: 'user', content: 'q2', model: null },
    ],
  });
  assert.deepEqual(item.prompts, ['q1', 'q2']);
  assert.equal(item.batch.results.length, 1);
  assert.equal(item.batch.results[0].response.body.model, 'deepseek/deepseek-v4');
  assert.deepEqual(item.batch.request_counts, { total: 2, completed: 1, failed: 1 });
});
