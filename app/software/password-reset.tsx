"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase-client";
import { WorkspaceBrand } from "./workspace";
import styles from "./software.module.css";

export function PasswordResetRequest() {
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => {active.current = true; return () => {active.current = false;};}, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!supabase || working) return;
    setWorking(true); setError("");
    try {
      const result = await supabase.auth.resetPasswordForEmail(email.trim(), {redirectTo: `${window.location.origin}/software/recover/`});
      if (!active.current) return;
      if (result.error) setError("We couldn’t send a reset link. Try again later or contact your campus administrator.");
      else {setSent(true); setEmail("");}
    } catch {if (active.current) setError("Could not connect. Check your connection and try again.");}
    finally {if (active.current) setWorking(false);}
  }
  return <><h1>Let’s get you back in.</h1><p>Enter the email you use for CampusPulse.</p>{sent ? <p role="status" className={styles.success}>If an account exists for that address, a reset link will be sent. Check your inbox and spam folder. If it doesn’t arrive, contact your campus administrator.</p> : <form onSubmit={submit}><label>Campus email<input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)}/></label><button className={styles.primary} disabled={working || !supabase}>{working ? "Sending…" : "Send reset link"}</button></form>}{error && <p role="alert" className={styles.error}>{error}</p>}<a className={styles.link} href="/software/">Back to sign in →</a></>;
}

export function PasswordRecovery() {
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "done">("loading");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const account = useRef<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    if (!supabase) {setState("invalid"); return;}
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event, session) => {
      if (account.current !== (session?.user.id ?? null)) {setPassword(""); setConfirmation(""); setError("");}
      account.current = session?.user.id ?? null;
      setState(previous => previous === "done" ? previous : session ? "ready" : "invalid");
    });
    return () => {active.current = false; account.current = null; subscription.unsubscribe();};
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!supabase || working || !account.current) return;
    if (password !== confirmation) {setError("The passwords don’t match. Enter them again."); return;}
    const user = account.current; setWorking(true); setError("");
    try {
      const result = await supabase.auth.updateUser({password});
      if (!active.current || account.current !== user) return;
      if (result.error) {setError(result.error.message); return;}
      setPassword(""); setConfirmation(""); setState("done");
      // Recovery revokes refresh sessions on other devices as well as this browser.
      const signedOut = await supabase.auth.signOut({scope:"global"});
      if (signedOut.error && active.current) setError("Your password was changed, but sign-out could not finish. Reconnect and sign out before sharing this device; contact support if another device may have access.");
    } catch {if (active.current) setError("Could not connect. Check your connection and try again.");}
    finally {if (active.current) setWorking(false);}
  }
  return <main className={styles.loginPage}><div className={styles.loginCard}><WorkspaceBrand/>
    {state === "loading" && <p role="status">Checking your reset link…</p>}
    {state === "invalid" && <><p role="alert" className={styles.error}>This reset link is missing, expired or has already been used. Request a new link to continue.</p><PasswordResetRequest/></>}
    {state === "ready" && <><h1>A fresh start.</h1><p>Choose a new password for your CampusPulse account.</p><form onSubmit={submit}><label>New password<input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}/></label><label>Confirm new password<input type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label><p className={styles.muted}>Use at least 8 characters. Your institution’s password rules also apply.</p><button className={styles.primary} disabled={working}>{working ? "Saving…" : "Save new password"}</button></form><a className={styles.link} href="/software/">Return to CampusPulse →</a></>}
    {state === "done" && <><h1>You’re ready to return.</h1><p role="status" className={styles.success}>Your password has been changed.</p><a className={styles.link} href="/software/">Sign in with your new password →</a></>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div></main>;
}
