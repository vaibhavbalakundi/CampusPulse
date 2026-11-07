"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "./software.module.css";
import { campusPresence, type Presence } from "../../lib/availability";
import { NaturalTimeInput } from "./natural-time-input";
import { RequestChips } from "./requests";
import { VoiceNoteInput } from "./voice-note";
import type { MeetingTimeDraft } from "../../lib/natural-meeting-time";
import type { VoiceDraft } from "../../lib/voice-notes";

type Faculty = {
  id: string;
  name: string;
  department: string;
  office_location: string | null;
};

type Availability = { faculty_id: string; status: "available" | "busy" | "away"; updated_at: string; expires_at: string };
type Scheduled = { faculty_id: string; status: "available" | "busy" | "away"; starts_at: string; expires_at: string };
type OfficeHour = { id: string; faculty_id: string; weekday: number; start_time: string; end_time: string; timezone: string };

const labels = { available: "Available", busy: "Busy", away: "Away" } as const;
const stamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function presenceCopy(presence: Presence) {
  if (presence.source === "hours") return "From weekly hours";
  if (presence.expiresAt) return `Until ${stamp(presence.expiresAt)}`;
  return "No current status";
}

export function FacultyDirectory({
  role,
  people,
  search,
  setSearch,
  listMode,
  setListMode,
  scheduleReliable,
  hoursReady,
  availability,
  scheduled,
  hours,
  now,
  target,
  preferred,
  setPreferred,
  reason,
  setReason,
  requestVoice,
  changeRequestVoice,
  captureBusy,
  working,
  captureId,
  userId,
  onChoose,
  onCancel,
  onSend,
}: {
  role: "student" | "admin";
  people: Faculty[];
  search: string;
  setSearch: (value: string) => void;
  listMode: "recent" | "all" | "available";
  setListMode: (value: "recent" | "all" | "available") => void;
  scheduleReliable: boolean;
  hoursReady: boolean;
  availability: Availability[];
  scheduled: Scheduled[];
  hours: OfficeHour[];
  now: number;
  target: string;
  preferred: MeetingTimeDraft;
  setPreferred: (value: MeetingTimeDraft) => void;
  reason: string;
  setReason: (value: string) => void;
  requestVoice: VoiceDraft | null;
  changeRequestVoice: (value: VoiceDraft | null) => void;
  captureBusy: (id: string, busy: boolean) => void;
  working: boolean;
  captureId: string | null;
  userId: string;
  onChoose: (id: string) => void;
  onCancel: () => void;
  onSend: (event: FormEvent) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const savedScroll = useRef(0);
  const openId = useRef("");
  const [anchorId, setAnchorId] = useState("");
  const titleId = useId();
  const chosen = people.find(person => person.id === target) ?? null;
  const chosenPresence = chosen ? campusPresence(
    scheduleReliable ? availability.find(item => item.faculty_id === chosen.id) : undefined,
    scheduleReliable ? scheduled.find(item => item.faculty_id === chosen.id && Date.parse(item.starts_at) <= now) : undefined,
    hoursReady ? hours.filter(item => item.faculty_id === chosen.id) : [],
    now,
  ) : null;

  useEffect(() => {
    const panel = dialog.current;
    if (!panel || role !== "student") return;

    if (target) {
      if (!openId.current) savedScroll.current = window.scrollY;
      openId.current = target;
      setAnchorId(target);
      if (!panel.open) panel.showModal();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.setTimeout(() => {
        form.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      }, reduce ? 0 : 30);
      return;
    }

    if (!openId.current) return;
    const restore = openId.current;
    openId.current = "";
    if (panel.open) panel.close();
    const top = savedScroll.current;
    requestAnimationFrame(() => {
      window.scrollTo(0, top);
      cards.current.get(restore)?.focus({ preventScroll: true });
    });
  }, [target, role]);

  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    const onClose = () => { if (openId.current) onCancel(); };
    const onCancelEvent = (event: Event) => { if (working || captureId) event.preventDefault(); };
    panel.addEventListener("close", onClose);
    panel.addEventListener("cancel", onCancelEvent);
    return () => {
      panel.removeEventListener("close", onClose);
      panel.removeEventListener("cancel", onCancelEvent);
    };
  }, [onCancel, working, captureId]);

  return <>
    <div className={styles.pageHead}>
      <div>
        <h1>{role === "admin" ? "Faculty." : "Find a time."}</h1>
        <p>{role === "student" ? "Choose someone to request a meeting." : "Who is free across campus."}</p>
      </div>
    </div>
    <div className={styles.directoryTools}>
      <label className={styles.searchLabel}>Search faculty
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or department" />
      </label>
    </div>
    <div className={styles.filters} role="group" aria-label="Filter faculty">
      {([["all", "All faculty"], ["available", "Available now"], ["recent", "Recent"]] as const).map(([id, label]) => (
        <button type="button" key={id} aria-pressed={listMode === id && !search.trim()} onClick={() => { setListMode(id); setSearch(""); }}>{label}</button>
      ))}
    </div>
    <p className={styles.resultCount} role="status">{people.length ? `${people.length} faculty` : "No faculty"}</p>
    <div className={styles.facultyGrid}>
      {people.map(person => {
        const presence = campusPresence(
          scheduleReliable ? availability.find(item => item.faculty_id === person.id) : undefined,
          scheduleReliable ? scheduled.find(item => item.faculty_id === person.id && Date.parse(item.starts_at) <= now) : undefined,
          hoursReady ? hours.filter(item => item.faculty_id === person.id) : [],
          now,
        );
        const selected = anchorId === person.id;
        const status = presence.status;
        const cabin = person.office_location || "Not listed";
        const open = () => { if (role === "student") onChoose(person.id); };
        return <article
          key={person.id}
          ref={node => {
            if (node) cards.current.set(person.id, node);
            else cards.current.delete(person.id);
          }}
          className={`${styles.card} ${styles.facultyPick}${selected ? ` ${styles.facultyPickSelected}` : ""}`}
          {...(role === "student" ? {
            role: "button" as const,
            tabIndex: 0,
            "aria-haspopup": "dialog" as const,
            "aria-expanded": target === person.id,
            "aria-label": `Request a meeting with ${person.name}`,
            onClick: open,
            onKeyDown: (event: KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
            },
          } : {})}
        >
          <div className={styles.facultyPickTop}>
            <div className={styles.avatar}>{person.name.charAt(0)}</div>
            <span className={`${styles.badge} ${status === "available" ? styles.good : status ? styles[status] : ""}`}>
              {status ? labels[status] : "Status unknown"}
            </span>
          </div>
          <h2>{person.name}</h2>
          <dl className={styles.facultyMeta}>
            <div><dt>Department</dt><dd>{person.department || "—"}</dd></div>
            <div><dt>Cabin</dt><dd>{cabin}</dd></div>
          </dl>
          <p className={styles.muted}>{presenceCopy(presence)}</p>
          {role === "student" && <p className={styles.facultyHint}>Request a meeting</p>}
        </article>;
      })}
    </div>
    {!people.length && <div className={styles.card}><p>No one here.</p><button className={styles.secondary} type="button" onClick={() => { setSearch(""); setListMode("all"); }}>Show all faculty</button></div>}

    {role === "student" && <dialog ref={dialog} className={styles.requestDialog} aria-labelledby={titleId}>
      {chosen && <form ref={form} className={styles.requestDialogBody} onSubmit={onSend}>
        <div className={styles.requestDialogHead}>
          <button type="button" className={styles.requestBack} disabled={working || !!captureId} onClick={onCancel}>Back</button>
          <span className={styles.eyebrow}>MEETING REQUEST</span>
        </div>
        <h2 id={titleId}>{chosen.name}</h2>
        <dl className={styles.facultyMeta}>
          <div><dt>Department</dt><dd>{chosen.department || "—"}</dd></div>
          <div><dt>Cabin</dt><dd>{chosen.office_location || "Not listed"}</dd></div>
          <div><dt>Status</dt><dd>{chosenPresence?.status ? labels[chosenPresence.status] : "Status unknown"}</dd></div>
        </dl>
        <p className={styles.muted}>Send a time and a short message.</p>
        <NaturalTimeInput label="When" value={preferred} onChange={setPreferred} required />
        <RequestChips value={reason} onPick={setReason} />
        <label>Message<textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="What do you need to discuss?" /></label>
        <VoiceNoteInput key={`${userId}-${chosen.id}`} value={requestVoice} onChange={changeRequestVoice} onBusyChange={busy => captureBusy("request", busy)} disabled={working} label="Voice note" />
        <div className={styles.actions}>
          <button className={styles.primary} disabled={working || !!captureId}>Send request</button>
          <button type="button" disabled={working || !!captureId} onClick={onCancel}>Cancel</button>
        </div>
      </form>}
    </dialog>}
  </>;
}
