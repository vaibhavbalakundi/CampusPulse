import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBmsitEmail } from '../lib/signup-domain.ts';

test('allows the exact campus email domain regardless of case', () => {
  assert.equal(isBmsitEmail('student@bmsit.in'), true);
  assert.equal(isBmsitEmail(' Faculty@BMSIT.IN '), true);
});
test('rejects unrelated domains, lookalikes and missing usernames', () => {
  for (const value of ['student@example.com','student@bmsit.in.example.com','@bmsit.in','x@@bmsit.in','x y@bmsit.in']) {
    assert.equal(isBmsitEmail(value), false);
  }
});
