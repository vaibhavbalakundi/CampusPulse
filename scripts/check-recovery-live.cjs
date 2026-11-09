// Controlled-mailbox recovery test. Secret URLs arrive only through hidden stdin.
const fs = require('node:fs');
const crypto = require('node:crypto');
const {chromium} = require(process.env.CAMPUSPULSE_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const origin = 'https://sygnetta.vercel.app';
const phase = process.argv[2];
if (!['request','recover','verify'].includes(phase)) throw Error('Expected request or recover phase');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
console.log('Ready for test JSON on stdin (input is hidden).');
let input = '';
const ready = new Promise((resolve,reject) => process.stdin.on('data',chunk => {
  if (chunk.includes('\u0003')) return reject(Error('Cancelled'));
  input += chunk;
  if (/[\r\n]/.test(input)) {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    try {resolve(JSON.parse(input.trim()));} catch {reject(Error('Invalid test input'));}
    input = '';
  }
}));
(async () => {
  const payload = await ready;
  assert.equal(new URL(payload.shareUrl).origin,origin);
  const path = '.pilot-test/recovery-account.json';
  const fixture = JSON.parse(fs.readFileSync(path,'utf8'));
  assert.equal(fixture.purpose,'Controlled development recovery test');
  const report = {kind:'real-deployed-email-recovery',phase,started_at:new Date().toISOString()};
  const browser = await chromium.launch({channel:'msedge',headless:true});
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  const page = await context.newPage();
  let stage='open';
  try {
    await page.goto(payload.shareUrl);
    if (phase === 'request') {
      await page.goto(origin+'/software/');
      await page.getByRole('link',{name:'Forgot your password?'}).click();
      await page.waitForTimeout(400);
      await page.getByLabel('Campus email').fill(fixture.email);
      const reply = page.waitForResponse(r=>r.url().startsWith('https://zqljaarwncamxqxawcxd.supabase.co/auth/v1/recover') && r.request().method() === 'POST');
      await page.getByRole('button',{name:'Send reset link'}).click();
      const response = await reply;
      report.request_status = response.status();
      report.correct_recipient = response.request().postDataJSON().email === fixture.email;
      report.correct_redirect_requested = new URL(response.url()).searchParams.get('redirect_to') === origin+'/software/recover/';
      assert.equal(report.request_status,200);
      await page.getByRole('status').filter({hasText:'If an account exists'}).waitFor();
      report.request_feedback_displayed = true;
    } else {
      const recovery = new URL(payload.recoveryUrl);
      assert.equal(recovery.origin,'https://zqljaarwncamxqxawcxd.supabase.co');
      assert.equal(recovery.pathname,'/auth/v1/verify');
      assert.equal(recovery.searchParams.get('type'),'recovery');
      assert.equal(recovery.searchParams.get('redirect_to'),origin+'/software/recover/');
      let oldPassword; let nextPassword=fixture.password;
      if (phase === 'recover') {
      await page.goto(recovery.href);
      await page.getByRole('heading',{name:'A fresh start.'}).waitFor();
      report.correct_landing = new URL(page.url()).origin === origin && new URL(page.url()).pathname === '/software/recover/';
      nextPassword = crypto.randomBytes(30).toString('base64url')+'Aa1!';
      // Preserve a candidate locally if a connection failure makes update outcome ambiguous.
      fs.writeFileSync('.pilot-test/recovery-next-password.json',JSON.stringify({password:nextPassword}));
      await page.getByLabel('New password',{exact:true}).fill(nextPassword);
      await page.getByLabel('Confirm new password',{exact:true}).fill(nextPassword);
      await page.getByRole('button',{name:'Save new password'}).click();
      await page.getByRole('status').filter({hasText:'password has been changed'}).waitFor();
      report.password_updated_in_app = true;
      oldPassword = fixture.password; fs.writeFileSync('.pilot-test/recovery-previous-password.json',JSON.stringify({password:oldPassword})); fixture.password = nextPassword;
      fs.writeFileSync(path,JSON.stringify(fixture,null,2));
      fs.unlinkSync('.pilot-test/recovery-next-password.json');
      await page.waitForFunction(()=>localStorage.getItem('sb-zqljaarwncamxqxawcxd-auth-token') === null);
      report.recovery_session_signed_out = true;
      } else { oldPassword=JSON.parse(fs.readFileSync('.pilot-test/recovery-previous-password.json','utf8')).password; }
      await page.goto(origin+'/software/');
      await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
      await page.getByLabel('Campus email').fill(fixture.email);
      await page.getByLabel('Password',{exact:true}).fill(oldPassword);
      const oldReply = page.waitForResponse(r=>r.url().includes('/auth/v1/token?') && r.request().method() === 'POST');
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      const oldResponse = await oldReply;
      const oldBody = await oldResponse.json();
      report.old_password_status=oldResponse.status(); report.old_password_error_code=oldBody.error_code || oldBody.code || null;
      report.old_password_rejected = oldResponse.status() === 400 && report.old_password_error_code === 'invalid_credentials';
      assert.equal(report.old_password_rejected,true);
      stage='old-password-feedback';
      await page.getByRole('alert').filter({hasText:'Invalid login credentials'}).waitFor();
      stage='new-password-signin';
      await page.getByLabel('Password',{exact:true}).fill(nextPassword);
      const newReply = page.waitForResponse(r=>r.url().includes('/auth/v1/token?') && r.request().method() === 'POST');
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      report.new_password_accepted = (await newReply).status() === 200;
      assert.equal(report.new_password_accepted,true);
      stage='unprovisioned-profile';
      if(payload.expectWorkspace){await page.getByRole('navigation').waitFor();report.provisioned_workspace_accessible=true;}else{await page.getByRole('heading',{name:'Account not ready'}).waitFor();report.unprovisioned_account_blocked=true;}
      await page.getByRole('button',{name:'Sign out',exact:true}).click();
      await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
      stage='reused-link';
      await page.goto(recovery.href);
      await page.getByRole('alert').filter({hasText:'missing, expired'}).waitFor();
      report.reused_link_rejected = true;
    }
    report.passed = true;
  } catch (error) {report.failed_stage=stage;report.error_name=error.name;await page.screenshot({path:'.pilot-test/recovery-debug.png',fullPage:true}).catch(()=>{});report.passed = false;report.failure = 'A live recovery check failed. Secret URLs, passwords and response bodies have not been logged.';process.exitCode=1;}
  finally {
    report.finished_at = new Date().toISOString();
    fs.writeFileSync(`.pilot-test/recovery-${phase}-results.json`,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
    await context.close(); await browser.close();
  }
})().catch(()=>{console.error('The controlled recovery test could not start; no secret details logged.');process.exitCode=1;});
