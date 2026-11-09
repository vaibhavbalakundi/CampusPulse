import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveStatus } from '../lib/availability.ts';

const time = h => `2026-10-29T${String(h).padStart(2,'0')}:00:00Z`;
const manual = { status:'available', updated_at:time(8), expires_at:time(18) };
const schedule = { faculty_id:'example', status:'busy', starts_at:time(10), expires_at:time(11) };
test('a future status does not override the current manual status', () => {
  assert.equal(effectiveStatus(manual,schedule,Date.parse(time(9))).status,'available');
});
test('a scheduled status applies when it begins and expires to unknown', () => {
  assert.equal(effectiveStatus(manual,schedule,Date.parse(time(10))).status,'busy');
  assert.equal(effectiveStatus(manual,schedule,Date.parse(time(11))).current,false);
});
test('a manual change after the scheduled start overrides it', () => {
  const later = { status:'away', updated_at:'2026-10-29T10:30:00Z', expires_at:time(12) };
  assert.equal(effectiveStatus(later,schedule,Date.parse(time(11))).status,'away');
});
test('missing and expired status are distinct from current availability', () => {
  assert.equal(effectiveStatus(undefined,undefined,Date.parse(time(9))),null);
  assert.equal(effectiveStatus(manual,undefined,Date.parse(time(18))).current,false);
});
