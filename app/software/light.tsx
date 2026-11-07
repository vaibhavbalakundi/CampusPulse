"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase-client";
import type { Presence } from "../../lib/availability";
import styles from "./software.module.css";
import { RequestChips } from "./requests";

const statusWord = { available: "Available", busy: "Busy", away: "Away" } as const;

function upcomingTime() {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`;
}

export function FacultySwitch({ presence, working, onSet, onHours }: {
  presence: Presence; working: boolean; onSet: (status: "available" | "busy" | "away") => void; onHours: () => void;
}) {
  const label = presence.status ? statusWord[presence.status] : "Status unknown";
  return <section className={styles.hero}><div className={styles.sectionHead}><div><h2>{label}</h2><p>Students see this instantly. Busy pauses new requests.</p></div></div>
    <div className={styles.slotRow}>{(["available", "busy", "away"] as const).map(status => <button type="button" key={status} className={presence.status === status ? styles.primary : styles.secondary} aria-pressed={presence.status === status} disabled={working} onClick={() => onSet(status)}>{statusWord[status]}</button>)}</div>
    <button type="button" className={styles.link} onClick={onHours}>Office hours</button>
  </section>;
}

export function AskRow({ slots, waiting, disabled, onSend, onRecord }: {
  slots: { at: string; label: string }[]; waiting: number; disabled: boolean; onSend: (at: string, note: string) => void; onRecord: () => void;
}) {
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(upcomingTime);
  const [problem, setProblem] = useState("");
  if (waiting >= 5) return <p>5 people are already waiting. Try someone else, or come back after one is answered.</p>;
  function send(at?: string) {
    const chosen = at ?? new Date(when).toISOString();
    if (!Number.isFinite(Date.parse(chosen)) || Date.parse(chosen) <= Date.now()) { setProblem("Choose a time that has not passed."); return; }
    setProblem("");
    onSend(chosen, note);
  }
  return <div className={styles.askBlock}>
    {waiting > 0 && <p className={styles.muted}>{waiting} waiting</p>}
    {slots.length > 0 && <div className={styles.slotRow}>{slots.map(slot => <button type="button" key={slot.at} className={styles.secondary} disabled={disabled} onClick={() => send(slot.at)}>{slot.label}</button>)}</div>}
    <RequestChips value={note} onPick={setNote} />
    <div className={styles.askFields}>
      <label>When<input type="datetime-local" value={when} onChange={event => setWhen(event.target.value)} /></label>
      <label>Message<input value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Optional note" /></label>
      <div className={styles.fieldAction}><span aria-hidden="true">Send</span><button type="button" className={styles.primary} disabled={disabled} onClick={() => send()}>Send</button></div>
    </div>
    {problem && <p role="alert" className={styles.error}>{problem}</p>}
    <button type="button" className={styles.link} onClick={onRecord}>Record instead</button>
  </div>;
}

export function ReplyLine({ status, when, person }: { status: string; when: string; person: string }) {
  const word = status === "accepted" ? "Accepted" : status === "declined" ? "Declined" : "Another time";
  return <p className={styles.replyLine}><strong>{word}</strong> · {when} · {person}</p>;
}

const alertKey = (userId: string) => `campuspulse.alerts.v1.${userId}`;

export function CampusAlerts({ userId }: { userId: string }) {
  const [offer, setOffer] = useState(false);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") { setAllowed(true); return; }
    try { if (!localStorage.getItem(alertKey(userId))) setOffer(true); } catch { setOffer(false); }
  }, [userId]);
  useEffect(() => {
    if (!supabase || !allowed) return;
    const channel = supabase.channel(`alerts-${userId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, payload => {
      const row = payload.new as { id?: string; kind?: string; message?: string };
      if (!row.kind || !["meeting", "notice", "event"].includes(row.kind) || !row.message) return;
      const title = row.kind === "notice" ? "Notice" : row.kind === "event" ? "Club event" : "Meeting";
      const show = () => new Notification(title, { body: row.message, tag: row.id });
      if (navigator.serviceWorker?.controller) void navigator.serviceWorker.ready.then(registration => registration.showNotification(title, { body: row.message, tag: row.id, data: { url: "/software/" } })).catch(show);
      else show();
    }).subscribe();
    return () => { void supabase?.removeChannel(channel); };
  }, [userId, allowed]);
  if (!offer) return null;
  return <section className={styles.card}><h2>App alerts</h2><p>Meeting replies, notices, and club events. No email.</p><div className={styles.slotRow}><button type="button" className={styles.primary} onClick={() => { void Notification.requestPermission().then(result => { setOffer(false); if (result === "granted") setAllowed(true); }); }}>Allow</button><button type="button" className={styles.secondary} onClick={() => { try { localStorage.setItem(alertKey(userId), "later"); } catch { /* The choice simply is not remembered. */ } setOffer(false); }}>Not now</button></div></section>;
}
