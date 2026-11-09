import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfileCsv } from '../lib/profile-csv.ts';
const header = 'email,name,department,role\r\n';
test('imports quoted commas and escaped quotes', () => {
  const [row] = parseProfileCsv(header + `"jane@bmsit.in","Doe, Jane","Arts ""A""",faculty\r\n`);
  assert.deepEqual(row, { email: 'jane@bmsit.in', name: 'Doe, Jane', department: 'Arts "A"', role: 'faculty' });
});
test('rejects invalid roles, duplicate emails and unterminated fields', () => {
  assert.throws(() => parseProfileCsv(header + `jane@bmsit.in,Jane,CS,admin`));
  assert.throws(() => parseProfileCsv(header + `jane@bmsit.in,Jane,CS,student\njane@bmsit.in,Other,CS,faculty`));
  assert.throws(() => parseProfileCsv(header + `jane@bmsit.in,"Jane,CS,student`));
});
test('allows up to 2000 rows', () => {
  const rows = Array.from({ length: 2000 }, (_, i) => `u${i}@bmsit.in,User ${i},CS,student`).join('\n');
  assert.equal(parseProfileCsv(header + rows).length, 2000);
  assert.throws(() => parseProfileCsv(header + rows + '\nu2000@bmsit.in,User,CS,student'));
});
