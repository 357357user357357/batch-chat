import assert from 'node:assert/strict';
import { test } from 'node:test';

import { maxTokenLimitFromError } from '../../.test-build/token-limits.mjs';

test('parses the provider cap out of an OpenRouter-wrapped 400 body', () => {
  const wrapped = {
    error: {
      message: 'Provider returned error',
      code: 400,
      metadata: {
        raw: '[{\n  "error": {\n    "code": 400,\n    "message": "Requested maximum tokens of 131072 exceeds the maximum output tokens limit: 102400.",\n    "status": "INVALID_ARGUMENT"\n  }\n}\n]',
        provider_name: 'Google',
        is_byok: false,
      },
    },
    user_id: 'user_x',
  };
  assert.equal(maxTokenLimitFromError(wrapped), 102400);
});

test('plain-string and loosely nested variants work too', () => {
  assert.equal(
    maxTokenLimitFromError(
      'Requested maximum tokens of 131072 exceeds the maximum output tokens limit: 8192.'
    ),
    8192
  );
  assert.equal(
    maxTokenLimitFromError({ detail: 'max output tokens limit:  4096' }),
    4096
  );
});

test('returns null for unrelated rejections', () => {
  assert.equal(maxTokenLimitFromError({ error: { message: 'Provider returned error' } }), null);
  assert.equal(maxTokenLimitFromError(''), null);
  assert.equal(maxTokenLimitFromError(null), null);
});