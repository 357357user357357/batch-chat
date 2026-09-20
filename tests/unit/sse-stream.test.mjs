import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SseChatAccumulator,
  Utf8ChunkDecoder,
} from '../../.test-build/sse-stream.mjs';

const event = (json) => `data: ${JSON.stringify(json)}\n\n`;

test('accumulates deltas across chunk boundaries', () => {
  const acc = new SseChatAccumulator();
  // One event split in the middle of the JSON and across the blank line.
  const full = event({ choices: [{ delta: { content: 'Hello, мир! 🌍' } }] });
  const allDeltas = [];
  // Feed byte-by-byte to stress the line/event buffer.
  const bytes = Array.from(new TextEncoder().encode(full));
  const decoder = new Utf8ChunkDecoder();
  for (const b of bytes) {
    for (const delta of acc.push(decoder.push(new Uint8Array([b])))) {
      allDeltas.push(delta);
    }
  }
  for (const delta of acc.push(decoder.flush()).concat(acc.flush())) {
    allDeltas.push(delta);
  }
  assert.equal(acc.content, 'Hello, мир! 🌍');
  assert.equal(allDeltas.join(''), 'Hello, мир! 🌍');
  assert.equal(acc.finished, false);
});

test('keeps multi-byte characters split across network chunks intact', () => {
  const decoder = new Utf8ChunkDecoder();
  const bytes = new TextEncoder().encode('👍');
  const first = decoder.push(bytes.slice(0, 2)); // split inside the emoji
  const second = decoder.push(bytes.slice(2));
  assert.equal(first + second, '👍');
});

test('ignores keep-alive comments and handles [DONE]', () => {
  const acc = new SseChatAccumulator();
  const deltas = acc.push(
    ': OPENROUTER PROCESSING\n\n' +
      event({ choices: [{ delta: { content: 'Hi' } }] }) +
      'data: [DONE]\n\n'
  );
  assert.equal(deltas.join(''), 'Hi');
  assert.equal(acc.content, 'Hi');
  assert.equal(acc.finished, true);
});

test('captures usage from the final chunk and builds a completion', () => {
  const acc = new SseChatAccumulator();
  acc.push(
    event({
      id: 'gen-1',
      model: 'qwen/qwen3-max:flex',
      provider: 'Alibaba',
      choices: [{ delta: { role: 'assistant', content: 'Answer' }, finish_reason: null }],
      usage: null,
    })
  );
  acc.push(
    event({
      id: 'gen-1',
      choices: [],
      finish_reason: 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.01 },
    })
  );
  const completion = acc.toCompletion();
  assert.equal(completion.id, 'gen-1');
  assert.equal(completion.model, 'qwen/qwen3-max:flex');
  assert.equal(completion.provider, 'Alibaba');
  assert.equal(completion.choices[0].message.content, 'Answer');
  assert.equal(completion.usage.prompt_tokens, 10);
  assert.equal(completion.usage.cost, 0.01);
  assert.equal(acc.finishReason, 'stop');
});

test('flush dispatches a final event that lacks its blank line', () => {
  const acc = new SseChatAccumulator();
  acc.push('data: {"choices":[{"delta":{"content":"tail"}}]}');
  // No trailing \n\n — the event is still pending.
  assert.equal(acc.content, '');
  const deltas = acc.flush();
  assert.equal(deltas.join(''), 'tail');
  assert.equal(acc.content, 'tail');
});

test('tolerates junk events without losing the stream', () => {
  const acc = new SseChatAccumulator();
  acc.push('data: not-json\n\n' + event({ choices: [{ delta: { content: 'ok' } }] }));
  assert.equal(acc.content, 'ok');
});
