import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  splitModelVariant,
  withFlexSuffix,
  withBatchSuffix,
  isFlexId,
  isBatchModelId,
  supportsFlex,
} from '../../.test-build/model-variants.mjs';

test('splitModelVariant detects the :flex suffix', () => {
  assert.deepEqual(splitModelVariant('deepseek/deepseek-v4:flex'), {
    base: 'deepseek/deepseek-v4',
    flex: true,
  });
  assert.deepEqual(splitModelVariant('openai/gpt-x'), { base: 'openai/gpt-x', flex: false });
  assert.deepEqual(splitModelVariant('  anthropic/claude-x  '), {
    base: 'anthropic/claude-x',
    flex: false,
  });
});

test('withFlexSuffix is idempotent (never produces :flex:flex)', () => {
  assert.equal(withFlexSuffix('openai/gpt-x'), 'openai/gpt-x:flex');
  assert.equal(withFlexSuffix('openai/gpt-x:flex'), 'openai/gpt-x:flex');
  assert.equal(withFlexSuffix(' openai/gpt-x '), 'openai/gpt-x:flex');
});

test('withBatchSuffix is idempotent', () => {
  assert.equal(withBatchSuffix('openai/gpt-x'), 'openai/gpt-x:batch');
  assert.equal(withBatchSuffix('openai/gpt-x:batch'), 'openai/gpt-x:batch');
});

test('isFlexId / isBatchModelId are case-insensitive and null-safe', () => {
  assert.equal(isFlexId('model:FLEX'), true);
  assert.equal(isFlexId('model'), false);
  assert.equal(isFlexId(null), false);
  assert.equal(isFlexId(undefined), false);
  assert.equal(isBatchModelId('model:Batch'), true);
  assert.equal(isBatchModelId('model:flex'), false);
});

test('every non-batch model supports flex, batch ids do not', () => {
  assert.equal(supportsFlex('openai/gpt-x'), true);
  assert.equal(supportsFlex('openai/gpt-x:flex'), true);
  assert.equal(supportsFlex('openai/gpt-x:batch'), false);
});
