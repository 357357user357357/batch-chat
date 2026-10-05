import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatCost,
  formatMessageDate,
  formatTokens,
  hasReplyMetadata,
  metadataLabel,
  metadataStatsLabel,
  normalizeModelKey,
  shortModelName,
} from '../../.test-build/message-meta.mjs';

test('formatTokens compacts big counts', () => {
  assert.equal(formatTokens(850), '850');
  assert.equal(formatTokens(1234), '1.2k');
  assert.equal(formatTokens(12400), '12.4k');
  assert.equal(formatTokens(120000), '120k');
  assert.equal(formatTokens(0), null);
  assert.equal(formatTokens(null), null);
});

test('formatCost renders compact prices', () => {
  assert.equal(formatCost(0.0123), '$0.0123');
  assert.equal(formatCost(2.5), '$2.50');
  assert.equal(formatCost(0.00005), '<$0.0001');
  assert.equal(formatCost(0), '$0');
  assert.equal(formatCost(null), null);
  assert.equal(formatCost(Number.NaN), null);
});

test('shortModelName drops the vendor prefix and marks flex', () => {
  assert.equal(shortModelName('anthropic/claude-x'), 'claude-x');
  assert.equal(shortModelName('deepseek/deepseek-v4:flex'), 'deepseek-v4 🧊');
  assert.equal(shortModelName(null), null);
  assert.equal(shortModelName('  '), null);
});

test('shortModelName strips gateway prefixes and marks batch tier', () => {
  assert.equal(shortModelName('custom:z-ai/glm-5.3-flash'), 'glm-5.3-flash');
  assert.equal(shortModelName('vertex:gemma-3'), 'gemma-3');
  assert.equal(shortModelName('bedrock:meta/llama-4'), 'llama-4');
  assert.equal(shortModelName('z-ai/glm-5.3:batch'), 'glm-5.3 ⚡');
  assert.equal(shortModelName('anthropic/claude-fable-5.1:batch'), 'claude-fable-5.1 ⚡');
  assert.equal(shortModelName('custom:z-ai/glm-5.3:batch'), 'glm-5.3 ⚡');
  assert.equal(shortModelName('plain-id'), 'plain-id');
});

test('formatMessageDate uses DD.MM.YY HH.MM in local time', () => {
  // Built from local components so the assertion is timezone-independent.
  const ts = new Date(2026, 8, 12, 14, 3).getTime();
  assert.equal(formatMessageDate(ts), '12.09.26 14.03');
  assert.equal(formatMessageDate(null), null);
  assert.equal(formatMessageDate('not-a-date'), null);
});

test('hasReplyMetadata detects any usage info', () => {
  assert.equal(hasReplyMetadata({}), false);
  assert.equal(hasReplyMetadata({ model: 'openai/gpt-x' }), true);
  assert.equal(hasReplyMetadata({ total_tokens: 5 }), true);
  assert.equal(hasReplyMetadata({ cost: 0 }), true);
  assert.equal(hasReplyMetadata({ cost: null, total_tokens: 0 }), false);
});

test('metadataLabel builds the full bubble caption', () => {
  const ts = new Date(2026, 8, 12, 14, 3).getTime();
  assert.equal(
    metadataLabel({
      createdAt: ts,
      model: 'deepseek/deepseek-v4:flex',
      total_tokens: 1234,
      cost: 0.0123,
    }),
    '12.09.26 14.03 · deepseek-v4 🧊 · 1.2k tok · $0.0123',
  );
  assert.equal(metadataLabel({}), null);
});

test('metadataStatsLabel omits the date and keeps model, tokens, cost', () => {
  assert.equal(
    metadataStatsLabel({
      model: 'openai/gpt-5.6-sol-pro:batch',
      total_tokens: 30700,
      cost: 0.0915,
    }),
    'gpt-5.6-sol-pro ⚡ · 30.7k tok · $0.0915',
  );
  assert.equal(
    metadataStatsLabel({ model: 'z-ai/glm-5.3-flash', total_tokens: 850, cost: 0 }),
    'glm-5.3-flash · 850 tok · $0',
  );
  assert.equal(metadataStatsLabel({}), null);
});

test('normalizeModelKey canonicalizes ids for the catalog cache', () => {
  assert.equal(normalizeModelKey('openai/gpt-5.6-sol-pro'), 'openai/gpt-5.6-sol-pro');
  assert.equal(normalizeModelKey('custom:Z-AI/GLM-5.3-Flash:batch'), 'z-ai/glm-5.3-flash');
  assert.equal(normalizeModelKey('vertex:deepseek/deepseek-v4:flex'), 'deepseek/deepseek-v4');
  assert.equal(normalizeModelKey('bedrock:anthropic/claude-x:batch'), 'anthropic/claude-x');
  assert.equal(normalizeModelKey('  openai/gpt-x:flex  '), 'openai/gpt-x');
  assert.equal(normalizeModelKey(null), '');
  assert.equal(normalizeModelKey(''), '');
});
