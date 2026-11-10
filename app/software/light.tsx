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

const STATUS_NOTE_PRESETS = ["Walk-ins welcome", "Knock for signatures", "In meeting — leave papers"] as const;

export function FacultySwitch({
  presence,
  working,
  onSet,
  onHours,
  presets,
  walkInNote = "",
  onWalkInNote,
  savedWalkInNote = "",
}: {
  presence: Presence;
  working: boolean;
  onSet: (status: "available" | "busy" | "away", walkInNote?: string) => void;
  onHours: () => void;
  presets?: { label: string; disabled?: boolean; onApply: () => void }[];
  walkInNote?: string;
  onWalkInNote?: (note: string) => void;
  savedWalkInNote?: string;
}) {
  const label = presence.status ? statusWord[presence.status] : "Status unknown";
  const noteLive = presence.status === "available" || presence.status === "busy";
  const draft = walkInNote;
  const saved = savedWalkInNote.trim();
  const pending = draft.trim();
  const dirty = pending !== saved;
  const saveNote = () => {
    if (!noteLive || !presence.status) return;
    onSet(presence.status, pending);
  };
  const clearNote = () => {
    onWalkInNote?.("");
    if (noteLive && presence.status) onSet(presence.status, "");
  };
  return <section className={`${styles.hero} ${styles.statusHero}`} data-tour="home">
    <div className={styles.sectionHead}>
      <div>
        <h2>{label}</h2>
        <p>Students see this instantly. Busy means not free now. They can still ask for another time.</p>
      </div>
    </div>
    <div className={styles.statusChoices} role="group" aria-label="Your status">
      {(["available", "busy", "away"] as const).map(status => (
        <button
          type="button"
          key={status}
          data-tour={`status-${status}`}
          className={`${styles.statusChoice} ${presence.status === status ? styles.statusChoiceOn : ""}`}
          aria-pressed={presence.status === status}
          disabled={working}
          onClick={() => onSet(status, status === "away" ? "" : draft)}
        >{statusWord[status]}</button>
      ))}
    </div>
    {!!presets?.length && <div className={styles.statusPresets} role="group" aria-label="Status presets">
      {presets.map(preset => (
        <button key={preset.label} type="button" className={styles.secondary} disabled={working || preset.disabled} onClick={preset.onApply}>
          {preset.label}
        </button>
      ))}
    </div>}
    <div className={styles.walkInEditor}>
      <div className={styles.sectionHead}>
        <div>
          <h3 className={styles.subHead}>Note for students</h3>
          <p className={styles.muted}>Pick a preset or write one, then save. Cleared if you go Away.</p>
        </div>
      </div>
      <div className={styles.chipRow} role="group" aria-label="Note presets">
        {STATUS_NOTE_PRESETS.map(chip => (
          <button
            type="button"
            key={chip}
            className={pending === chip ? styles.chipActive : styles.chip}
            disabled={working || !noteLive}
            aria-pressed={pending === chip}
            onClick={() => onWalkInNote?.(chip)}
          >{chip}</button>
        ))}
      </div>
      <label className={styles.walkInField}>Custom note
        <input
          value={draft}
          maxLength={120}
          disabled={working || !noteLive}
          placeholder={noteLive ? "e.g. Knock for signatures · back at 3" : "Set Available or Busy to add a note"}
          onChange={event => onWalkInNote?.(event.target.value)}
        />
      </label>
      {noteLive && (
        saved ? (
          <p className={`${styles.walkInPreview} ${presence.status === "busy" ? styles.walkInPreviewBusy : ""}`} role="status">
            Students see: {saved}
          </p>
        ) : (
          <p className={styles.muted} role="status">No note is showing to students yet.</p>
        )
      )}
      {noteLive && dirty && (
        <p className={styles.muted} role="status">Draft ready — save to show it to students.</p>
      )}
      {noteLive && (
        <div className={styles.noteActions}>
          <button type="button" className={styles.primary} disabled={working || !dirty} onClick={saveNote}>
            {saved ? "Save note" : "Show note to students"}
          </button>
          {(pending || saved) && (
            <button type="button" className={styles.link} disabled={working} onClick={clearNote}>Clear note</button>
          )}
        </div>
      )}
    </div>
    <button type="button" className={styles.link} onClick={onHours}>Availability settings</button>
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

type MeetingStatus = keyof typeof statusWord;

function otherStatuses(current: MeetingStatus | null): MeetingStatus[] {
  const all: MeetingStatus[] = ["available", "busy", "away"];
  if (!current) return ["available", "busy"];
  return all.filter(status => status !== current).slice(0, 2);
}

async function showCampusNotification(title: string, body: string, tag: string | undefined, data: Record<string, unknown>, actions?: { action: string; title: string }[]) {
  const fallback = () => new Notification(title, { body, tag });
  if (!navigator.serviceWorker?.controller) {
    fallback();
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
      body,
      tag,
      data: { url: "/software/", ...data },
    };
    if (actions?.length) options.actions = actions;
    await registration.showNotification(title, options);
  } catch {
    fallback();
  }
}

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
      if (!row.kind || !["meeting", "notice", "event", "status"].includes(row.kind) || !row.message) return;
      const title = row.kind === "notice" ? "Notice" : row.kind === "event" ? "Club event" : row.kind === "status" ? "Status" : "Meeting";
      void (async () => {
        const body = row.message ?? "";
        if (!body) return;
        if (row.kind !== "status" || !body.toLowerCase().includes("update your status")) {
          await showCampusNotification(title, body, row.id, { kind: row.kind });
          return;
        }
        const client = supabase;
        if (!client) return;
        // Never put JWTs or API keys in notification payloads — OS trays and shared devices can expose them.
        // Action clicks hand off to the open app session (or open /software/ with safe query params).
        const [nudgeResult, availabilityResult] = await Promise.all([
          client.from("status_nudges").select("id").eq("faculty_id", userId).eq("status", "open").gt("expires_at", new Date().toISOString()).maybeSingle(),
          client.from("availability").select("status,expires_at").eq("faculty_id", userId).maybeSingle(),
        ]);
        const current = availabilityResult.data
          && Date.parse(String(availabilityResult.data.expires_at)) > Date.now()
          ? availabilityResult.data.status as MeetingStatus
          : null;
        const choices = otherStatuses(current);
        await showCampusNotification(
          "Update your status?",
          body,
          row.id,
          {
            kind: "status",
            nudgeId: nudgeResult.data?.id ? String(nudgeResult.data.id) : null,
            currentStatus: current,
          },
          choices.map(status => ({ action: status, title: statusWord[status] })),
        );
      })();
    }).subscribe();
    return () => { void supabase?.removeChannel(channel); };
  }, [userId, allowed]);
  if (!offer) return null;
  return <section className={styles.card}><h2>App alerts</h2><p>Meeting replies, notices, club events, and status asks. No email.</p><div className={styles.slotRow}><button type="button" className={styles.primary} onClick={() => { void Notification.requestPermission().then(result => { setOffer(false); if (result === "granted") setAllowed(true); }); }}>Allow</button><button type="button" className={styles.secondary} onClick={() => { try { localStorage.setItem(alertKey(userId), "later"); } catch { /* The choice simply is not remembered. */ } setOffer(false); }}>Not now</button></div></section>;
}
