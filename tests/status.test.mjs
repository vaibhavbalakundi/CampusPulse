import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo, deviceState, heartbeat, selectStatus, STALE_MS, OFFLINE_MS } from '../lib/demo.ts';

test('heartbeats and reconnection cannot freshen an old faculty declaration', () => {
  const now = 1800000000000;
  const original = createDemo(now)[0];
  const later = now + STALE_MS;
  const reconnected = heartbeat(original, later);
  assert.equal(reconnected.updatedAt, original.updatedAt);
  assert.equal(reconnected.status, original.status);
  assert.deepEqual(deviceState(reconnected, later), { offline: false, stale: true, current: false });
});

test('device silence retains status but makes it non-current', () => {
  const now = 1800000000000;
  const original = createDemo(now)[0];
  const later = now + OFFLINE_MS;
  assert.deepEqual(deviceState(original, later), { offline: true, stale: false, current: false });
  assert.equal(original.status, 'AVAILABLE');
});

test('an explicit button selection records a fresh declaration', () => {
  const now = 1800000000000;
  const original = createDemo(now)[6];
  assert.equal(deviceState(original, now).current, false);
  const changed = selectStatus(original, 'BUSY', now);
  assert.equal(changed.status, 'BUSY');
  assert.equal(changed.updatedAt, now);
  assert.equal(changed.lastSeenAt, now);
  assert.equal(deviceState(changed, now).current, true);
  assert.notEqual(original.status, changed.status);
});
