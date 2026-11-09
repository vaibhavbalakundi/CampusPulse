import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail } from '../lib/signup-domain.ts';

test('accepts common email shapes', () => {
  assert.equal(isValidEmail('student@bmsit.in'), true);
  assert.equal(isValidEmail(' Faculty@Gmail.com '), true);
  assert.equal(isValidEmail('a.b+tag@college.edu'), true);
});

test('rejects empty or malformed values', () => {
  for (const value of ['student@', '@college.edu', 'not-an-email', 'x@@y.com', 'x y@z.com', '']) {
    assert.equal(isValidEmail(value), false);
  }
});
