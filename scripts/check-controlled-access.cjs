// Live tests restricted to the newly created controlled student fixture.
const fs=require('node:fs'); const {parseEnv}=require('node:util');
const {createClient}=require('@supabase/supabase-js');
const {chromium}=require(process.env.CAMPUSPULSE_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
function input(prompt){
  if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.resume();
  console.log(prompt+' (input is hidden).');let buffer='';
  return new Promise((resolve,reject)=>{const receive=chunk=>{if(chunk.includes('\u0003')){process.stdin.off('data',receive);reject(Error('Cancelled'));return;}buffer+=chunk;if(/[\r\n]/.test(buffer)){process.stdin.off('data',receive);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(buffer.trim()));}catch{reject(Error('Invalid input'));}buffer='';}};process.stdin.on('data',receive);});
}
(async()=>{
 const payload=await input('Ready for controlled access JSON');
 assert.equal(new URL(payload.shareUrl).origin,'https://sygnetta.vercel.app');
 const fixture=JSON.parse(fs.readFileSync('.pilot-test/recovery-account.json','utf8'));assert.equal(fixture.purpose,'Controlled development recovery test');
 const env=parseEnv(fs.readFileSync('.env.local','utf8'));assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,'https://zqljaarwncamxqxawcxd.supabase.co');
 const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(i,o)=>fetch(i,{...o,signal:AbortSignal.timeout(15000)})}});
 const report={kind:'controlled-real-student-access',started_at:new Date().toISOString(),checks:[]};
 const check=(name,ok)=>{report.checks.push({name,passed:!!ok});assert.ok(ok,name);};
 let browser,context,page;
 try{
  const signed=await client.auth.signInWithPassword({email:fixture.email,password:fixture.password});check('Real student sign-in',!signed.error&&!!signed.data.session);const uid=signed.data.user.id;
  const own=await client.from('profiles').select('id,role,institution_id,active');check('Isolated institution shows only the active student profile',!own.error&&own.data.length===1&&own.data[0].id===uid&&own.data[0].role==='student'&&own.data[0].active);
  const other=await client.from('profiles').select('id').eq('id',payload.facultyId);check('Known other-institution faculty profile hidden',!other.error&&other.data.length===0);
  const cross=await client.rpc('create_meeting_request',{p_faculty:payload.facultyId,p_reason:'Controlled cross-institution rejection test',p_preferred_time:'Test only'});check('Other-institution meeting request rejected',cross.error?.message==='Faculty unavailable');
  const status=await client.rpc('set_availability',{p_status:'available',p_duration_minutes:30});check('Student cannot set faculty availability',status.error?.message==='Faculty access required');
  const admin=await client.rpc('admin_update_profile',{p_user:uid,p_name:'Recovery Test Student',p_department:'Test',p_role:'student',p_active:true});check('Student cannot call profile administration',admin.error?.message==='Administrator access required');
  const direct=await client.from('profiles').update({role:'admin'}).eq('id',uid).select('id');const unchanged=await client.from('profiles').select('role').eq('id',uid).single();check('Direct role escalation changes no row and role stays student',!!direct.error||(!unchanged.error&&unchanged.data.role==='student'&&direct.data.length===0));
  await input('Isolation checks passed; ready for test-campus assignment');
  browser=await chromium.launch({channel:'msedge',headless:true});context=await browser.newContext({viewport:{width:390,height:900}});page=await context.newPage();await page.goto(payload.shareUrl);await page.goto('https://sygnetta.vercel.app/software/');await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();await page.getByLabel('Campus email').fill(fixture.email);await page.getByLabel('Password',{exact:true}).fill(fixture.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('navigation').waitFor();check('Real deployed student workspace loads',true);
  await page.getByRole('button',{name:'Request a meeting',exact:true}).first().click();await page.getByLabel('Preferred time',{exact:true}).fill('Pilot test only; no meeting required');await page.getByLabel('Brief reason',{exact:true}).fill('Controlled CampusPulse software verification');await page.getByRole('button',{name:'Send request',exact:true}).click();await page.getByRole('status').filter({hasText:'Request sent'}).waitFor();await page.getByRole('navigation').getByRole('button',{name:'My requests',exact:true}).click();await page.getByText('Controlled CampusPulse software verification',{exact:false}).waitFor();check('Real meeting request created and visible to student',true);
  await page.getByRole('button',{name:'Cancel request',exact:true}).click();await page.getByText('cancelled',{exact:true}).waitFor();check('Real request cancellation reflected in app',true);
  await input('Request checks passed; ready for controlled profile deactivation');
  const denied=await client.from('profiles').select('id');check('Existing session loses profile visibility when disabled',!denied.error&&denied.data.length===0);
  const rejected=await client.rpc('create_meeting_request',{p_faculty:payload.facultyId,p_reason:'Disabled-session rejection test',p_preferred_time:'Test only'});check('Disabled existing session cannot create request',rejected.error?.message==='Student access required');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('heading',{name:'Account not ready'}).waitFor();check('Disabled account cached workspace is cleared',await page.getByRole('navigation').count()===0);
  await input('Deactivation checks passed; ready for reactivation');
  await page.getByRole('button',{name:'Try again'}).click();await page.getByRole('navigation').waitFor();check('Re-enabled student workspace recovers on retry',true);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();check('Browser sign-out returns to login',true);
  report.passed=true;
 }catch{report.passed=false;report.failure='A controlled live access assertion failed; no passwords, session tokens or row contents logged.';process.exitCode=1;}
 finally{const logout=await client.auth.signOut({scope:'local'}).catch(()=>({error:true}));report.api_session_signed_out=!logout.error;if(logout.error){report.passed=false;process.exitCode=1;}report.finished_at=new Date().toISOString();fs.writeFileSync('.pilot-test/controlled-access-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await context?.close();await browser?.close();}
})().catch(()=>{console.error('The controlled access check could not start.');process.exitCode=1;});
