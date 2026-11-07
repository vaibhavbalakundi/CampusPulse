import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfileCsv } from '../lib/profile-csv.ts';
const id='11111111-1111-4111-8111-111111111111';
const header='auth_user_id,name,department,role\r\n';
test('imports quoted commas and escaped quotes', () => {
  const [row]=parseProfileCsv(header+`${id},"Doe, Jane","Arts ""A""",faculty\r\n`);
  assert.deepEqual(row,{auth_user_id:id,name:'Doe, Jane',department:'Arts "A"',role:'faculty'});
});
test('rejects invalid roles, duplicate IDs and unterminated fields', () => {
  assert.throws(()=>parseProfileCsv(header+`${id},Jane,CS,admin`));
  assert.throws(()=>parseProfileCsv(header+`${id},Jane,CS,student\n${id},Other,CS,faculty`));
  assert.throws(()=>parseProfileCsv(header+`${id},"Jane,CS,student`));
});
