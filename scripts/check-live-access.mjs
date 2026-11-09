// Real Auth sessions and read-only Data API checks against the development project.
// No passwords, tokens, email addresses or returned records are written to the report.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

class ConfigurationError extends Error {}
const expected = new Map([
  ['A_student', ['A', 'student']], ['A_student2', ['A', 'student']],
  ['A_faculty', ['A', 'faculty']], ['A_admin', ['A', 'admin']],
  ['B_student', ['B', 'student']], ['B_faculty', ['B', 'faculty']], ['B_admin', ['B', 'admin']]
]);
const report = { scope: 'Real session and read-only access smoke checks. Empty results require seeded-data follow-up; this is not the full authenticated procedure.', observed_counts: [], kind: 'real-auth-read-only-access', started_at: new Date().toISOString(), checks: [],
  not_tested: ['Browser interactions', 'Actual recovery email receipt and password reset', 'Disabled-account existing-session access', 'RPC writes and negative mutation attempts', 'Signup delivery'] };
const clients = [];
let failed = false;
const record = (account, test, passed) => { report.checks.push({account, test, status: passed ? 'pass' : 'fail'}); if (!passed) failed = true; };

try {
  const fixture = JSON.parse(await readFile(process.env.CAMPUSPULSE_PILOT_ACCOUNTS || '.pilot-test/accounts.json', 'utf8'));
  if (!Array.isArray(fixture.accounts)) throw new ConfigurationError('Expected an accounts array in the private fixture.');
  const seen = new Set();
  for (const a of fixture.accounts) {
    const shape = expected.get(a.label);
    if (!shape || seen.has(a.label) || a.institution !== shape[0] || a.role !== shape[1]) throw new ConfigurationError('Fixture labels, institution aliases or roles do not match the example.');
    seen.add(a.label);
    if (typeof a.email !== 'string' || typeof a.password !== 'string') throw new ConfigurationError('Each fixture needs email and password strings.');
  }
  const suppliedEmails = fixture.accounts.map(a => a.email.trim().toLowerCase()).filter(Boolean);
  if (new Set(suppliedEmails).size !== suppliedEmails.length) throw new ConfigurationError('Use a distinct confirmed test account for each fixture label.');
  const ready = fixture.accounts.filter(a => a.email.trim() && a.password);
  report.missing_credentials = [...expected.keys()].filter(label => !ready.some(a => a.label === label));
  if (process.argv.includes('--validate')) {
    console.log(JSON.stringify({ready: ready.map(a => a.label), missing: report.missing_credentials}));
    process.exitCode = report.missing_credentials.length ? 1 : 0;
  } else {
    if (!ready.length) throw new ConfigurationError('No test credentials are available. Fill the private fixture locally; do not paste passwords into chat.');
    const env = {...parseEnv(await readFile('.env.local', 'utf8')), ...process.env};
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url !== 'https://zqljaarwncamxqxawcxd.supabase.co' || !key) throw new ConfigurationError('This check is restricted to the documented development project and its public browser key.');
    // Reject privileged keys: access tests must use the same public key as the app.
    if (!key.startsWith('sb_publishable_')) {
      let role; try {role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;} catch {}
      if (role !== 'anon') throw new ConfigurationError('A publishable or legacy anon key is required.');
    }
    const signedIn = [];
    for (const a of ready) {
      const client = createClient(url, key, {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}, global:{fetch:(input,init) => fetch(input,{...init,signal:AbortSignal.timeout(15000)})}});
      clients.push({client,label:a.label});
      const login = await client.auth.signInWithPassword({email:a.email.trim(),password:a.password});
      record(a.label, 'Password sign-in', !login.error && !!login.data.session);
      if (login.error || !login.data.user) continue;
      const verified = await client.auth.getUser();
      record(a.label, 'Auth server verifies session', !verified.error && verified.data.user?.id === login.data.user.id);
      const profile = await client.from('profiles').select('id,institution_id,role,active').eq('id',login.data.user.id).single();
      const valid = !profile.error && profile.data.active && profile.data.role === a.role;
      record(a.label, 'Active profile and expected role', !!valid);
      if (valid) signedIn.push({...a, client, user:login.data.user.id, campus:profile.data.institution_id});
    }
    for (const a of signedIn) {
      const {client} = a;
      for (const peer of signedIn) {
        record(a.label, `Institution grouping with ${peer.label}`, (a.campus === peer.campus) === (a.institution === peer.institution));
        if (peer.institution !== a.institution) {
          const result = await client.from('profiles').select('id').eq('id',peer.user);
          record(a.label, `Other-institution profile hidden: ${peer.label}`, !result.error && result.data.length === 0);
          if (peer.role === 'faculty') {
            for (const table of ['availability','office_hours','scheduled_status']) {
              const result = await client.from(table).select('faculty_id').eq('faculty_id',peer.user);
              record(a.label, `Other-institution ${table} hidden: ${peer.label}`, !result.error && result.data.length === 0);
            }
          }
        }
      }
      const profiles = await client.from('profiles').select('id,institution_id');
      report.observed_counts.push({account:a.label,table:'profiles',count:profiles.data?.length ?? null});
      record(a.label, 'Visible profiles stay within institution', !profiles.error && profiles.data.every(p => p.institution_id === a.campus));
      const requests = await client.from('meeting_requests').select('institution_id,student_id,faculty_id');
      report.observed_counts.push({account:a.label,table:'meeting_requests',count:requests.data?.length ?? null});
      record(a.label, 'Visible requests belong to participant and institution', !requests.error && requests.data.every(r => r.institution_id === a.campus && (r.student_id === a.user || r.faculty_id === a.user)));
      const notices = await client.from('notifications').select('recipient_id');
      report.observed_counts.push({account:a.label,table:'notifications',count:notices.data?.length ?? null});
      record(a.label, 'Visible notices belong to current account', !notices.error && notices.data.every(n => n.recipient_id === a.user));
      const admin = await client.rpc('is_institution_admin');
      record(a.label, 'Administrator recognition matches role', !admin.error && admin.data === (a.role === 'admin'));
    }
    if (!signedIn.some(a=>a.institution === 'A') || !signedIn.some(a=>a.institution === 'B')) report.not_tested.push('Two-institution coverage is incomplete');
    report.complete_fixture = report.missing_credentials.length === 0 && signedIn.length === expected.size;
    if (!report.complete_fixture) report.not_tested.push('One or more required accounts were not tested');
    report.passed = !failed;
    report.finished_at = new Date().toISOString();
    process.exitCode = failed || !report.complete_fixture ? 1 : 0;
  }
} catch (error) {
  // Avoid logging provider responses or objects which might contain credentials.
  failed = true; report.execution_error = true;
  console.error(error instanceof ConfigurationError ? error.message : 'The access check could not load its configuration or complete its requests. No sensitive error details were logged.');
  process.exitCode = 1;
} finally {
  for (const {client,label} of clients) {
    try {const result = await client.auth.signOut({scope:'local'}); record(label,'Test session signed out locally',!result.error);}
    catch {record(label,'Test session signed out locally',false);}
  }
  if (clients.length) {
    report.passed = !failed; report.finished_at = new Date().toISOString();
    await mkdir('.pilot-test', {recursive:true});
    await writeFile('.pilot-test/access-results.json', JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:!failed, complete_fixture:!!report.complete_fixture,checks:report.checks.length,report:'.pilot-test/access-results.json'}));
    if (failed || !report.complete_fixture) process.exitCode = 1;
  }
}
