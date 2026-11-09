import {test} from 'node:test'; import assert from 'node:assert/strict';
import {meetingState,localMeetingIso} from '../lib/meeting-time.ts';
const at='2026-11-03T15:00:00Z', now=Date.parse(at);
test('active requests expire exactly at the meeting time, while terminal records stay terminal',()=>{
  for(const status of ['pending','accepted','alternative']){assert.equal(meetingState(status,at,now-1),status);assert.equal(meetingState(status,at,now),'expired');}
  for(const status of ['cancelled','declined'])assert.equal(meetingState(status,at,now),status);
  assert.equal(meetingState('pending',null,now),'pending');
});
test('meeting entry requires a finite future instant within the supported booking window',()=>{
  assert.throws(()=>localMeetingIso('bad',now),/future/);assert.throws(()=>localMeetingIso(at,now),/future/);
  assert.throws(()=>localMeetingIso('2028-11-03T15:00:00Z',now),/180 days/);
  assert.equal(localMeetingIso('2026-11-03T15:01:00Z',now),'2026-11-03T15:01:00.000Z');
});
