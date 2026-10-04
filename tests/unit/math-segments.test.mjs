import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  autoDelimitRawLatex,
  normalizeMathPasteArtifacts,
} from '../../.test-build/components-math-segments.mjs';

test('normalizeMathPasteArtifacts repairs rendered-math glyph-per-line text', () => {
  const broken = [
    'Hey! Please explain: ### Step 2: The lifting step Key claim: If',
    'π', '1', '(', 'V', '0', ')', '≠', '1',
    'π', '1', '​(V​0​)', '', '=1, then',
    'V', '0', 'V​0​', 'admits a connected double cover',
    'p', '1', ' ⁣', ':', 'V~', '0', '→', 'V', '0',
  ].join('\n');
  const fixed = normalizeMathPasteArtifacts(broken);
  assert.ok(fixed.includes('π 1 (V 0) ≠ 1'));
  assert.ok(fixed.includes('admits a connected double cover'));
  assert.ok(fixed.split('\n').length < broken.split('\n').length);
});

test('autoDelimitRawLatex normalizes before detecting math atoms', () => {
  const broken = ['π', '1', '(', 'V', '0', ')', '≠', '1'].join('\n');
  const fixed = autoDelimitRawLatex(broken);
  assert.ok(fixed.includes('π 1 (V 0) ≠ 1'));
  assert.ok(fixed.length < broken.length + 20);
});
