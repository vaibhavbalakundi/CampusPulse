import {test} from 'node:test'; import assert from 'node:assert/strict';
import {parseMeetingTime} from '../lib/natural-meeting-time.ts';
const ref=new Date(2026,10,3,15,0,0); // Tuesday in the test device's local time zone.
test('meeting requests require a clock time',()=>{
  const bare=parseMeetingTime('tomorrow',ref);assert.equal(bare.iso,null);assert.match(bare.error,/clock time/i);
  const vague=parseMeetingTime('tomorrow afternoon',ref);assert.equal(vague.iso,null);
});
test('now means an immediate meeting about two minutes ahead',()=>{
  const r=parseMeetingTime('now',ref);assert.ok(r.iso);assert.equal(Date.parse(r.iso)-ref.getTime(),120000);assert.match(r.preview,/2 minutes/i);
  assert.equal(Date.parse(parseMeetingTime('right now',ref).iso)-ref.getTime(),120000);
});
test('todo deadlines allow a date alone and use the end of that day',()=>{
  const r=parseMeetingTime('tomorrow',ref,{allowDateOnly:true});assert.ok(r.iso);assert.equal(r.dateOnly,true);assert.match(r.preview,/4 Nov/);
  const when=new Date(r.iso);assert.equal(when.getDate(),4);assert.equal(when.getHours(),23);assert.equal(when.getMinutes(),59);
});
test('combined day and time and next-occurrence time-only phrases resolve precisely',()=>{
  const tomorrow=new Date(parseMeetingTime('tomorrow at 10 pm',ref).iso);assert.equal(tomorrow.getDate(),4);assert.equal(tomorrow.getHours(),22);
  const today=new Date(parseMeetingTime('10 pm',ref).iso);assert.equal(today.getDate(),3);assert.equal(today.getHours(),22);
  const next=new Date(parseMeetingTime('10 pm',new Date(2026,10,3,23)).iso);assert.equal(next.getDate(),4);
  const monday=new Date(parseMeetingTime('next Monday at 2 pm',ref).iso);assert.equal(monday.getDate(),9);assert.equal(monday.getHours(),14);
});
test('ambiguous or conflicting proposals are never silently selected',()=>{
  for(const s of ['tomorrow at 10','tomorrow afternoon','10 pm or 11 pm','tomorrow 10-11am','not tomorrow at 10pm','32 November at 10pm','yesterday at 10pm','sometime soon'])assert.equal(parseMeetingTime(s,ref).iso,null,s);
});
test('Indian numeric dates, explicit IST and 24-hour notation work',()=>{
  const r=parseMeetingTime('13/11/2026 at 14:00',ref);assert.ok(r.iso);assert.equal(new Date(r.iso).getDate(),13);assert.equal(new Date(r.iso).getHours(),14);
  assert.equal(parseMeetingTime('4 November 2026 at 10 pm IST',ref).iso,'2026-11-04T16:30:00.000Z');
});
test('relative-hour values are frozen to their parsing reference',()=>{
  const r=parseMeetingTime('in 2 hours',ref);assert.equal(Date.parse(r.iso)-ref.getTime(),7200000);
});
