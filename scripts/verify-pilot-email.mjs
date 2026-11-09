// Consume only the controlled signup email supplied through hidden stdin.
// Recovery links/password updates are tested separately through the actual UI.
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
console.log('Ready for verification JSON on stdin (input is hidden).');
let input = '';
const payload = await new Promise((resolve,reject) => {
  process.stdin.on('data',chunk => {
    if (chunk.includes('\u0003')) {reject(new Error('Cancelled')); return;}
    input += chunk;
    if (/[\r\n]/.test(input)) {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      try {resolve(JSON.parse(input.trim()));} catch {reject(new Error('Invalid verification input'));}
      input = '';
    }
  });
});
const url = new URL(payload.url);
if (url.origin !== 'https://zqljaarwncamxqxawcxd.supabase.co' || url.pathname !== '/auth/v1/verify' || url.searchParams.get('type') !== 'signup') throw new Error('Expected the development signup confirmation URL.');
const env = parseEnv(await readFile('.env.local','utf8'));
const controlled=JSON.parse(await readFile('.pilot-test/recovery-account.json','utf8'));
const candidateFiles={B_student:'.pilot-test/b-provision-candidate.json',B_faculty:'.pilot-test/B_faculty-candidate.json',B_admin:'.pilot-test/B_admin-candidate.json',import_student:'.pilot-test/import-candidate.json'};
const fixture=payload.label ? JSON.parse(await readFile(candidateFiles[payload.label] || '', 'utf8')) : controlled;
if (payload.label && (fixture.label!==payload.label || fixture.email.split('@')[0].split('+')[0]!==controlled.email.split('@')[0] || fixture.email.split('@')[1]!==controlled.email.split('@')[1])) throw new Error('Controlled alias mismatch');
if (!payload.label && fixture.purpose !== 'Controlled development recovery test') throw new Error('Controlled mailbox fixture mismatch.');
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(i,o)=>fetch(i,{...o,signal:AbortSignal.timeout(15000)})}});
const report = {kind:'controlled-signup-verification',started_at:new Date().toISOString()};
try {
  const before = await client.auth.signInWithPassword({email:fixture.email,password:fixture.password});
  report.before_confirmation = {accepted:!before.error,error_code:before.error?.code ?? null};
  if (before.error?.code === 'email_not_confirmed') {
    const result = await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000)});
    const redirect = new URL(result.headers.get('location') || url.origin);
    report.confirmation = {http_status:result.status,redirect_origin:redirect.origin,redirect_path:redirect.pathname,error:redirect.searchParams.get('error_code') || new URLSearchParams(redirect.hash.slice(1)).get('error_code') || null};
  } else report.confirmation = {skipped: true};
  const after = await client.auth.signInWithPassword({email:fixture.email,password:fixture.password});
  report.after_confirmation = {accepted:!after.error,error_code:after.error?.code ?? null};
  if (!after.error) {
    const checked = await client.auth.getUser();
    report.auth_server_verified = !checked.error && checked.data.user?.id === after.data.user.id;
    const profile = await client.from('profiles').select('id').eq('id',after.data.user.id);
    report.profile_present = !profile.error && profile.data.length === 1;
  }
} catch {report.execution_error = true;process.exitCode = 1;}
finally {
  const logout = await client.auth.signOut({scope:'local'}).catch(()=>({error:true}));
  report.signed_out = !logout.error;
  report.finished_at = new Date().toISOString();
  await writeFile('.pilot-test/'+(payload.label||'controlled')+'-signup-results.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if (!report.after_confirmation?.accepted || !report.auth_server_verified || !report.signed_out) process.exitCode = 1;
}
