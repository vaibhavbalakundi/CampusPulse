"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase-client";
import { isSameLocalDay, matchesQuery, startOfLocalDay } from "../../lib/section-browse";
import styles from "./software.module.css";
import { NaturalTimeInput } from "./natural-time-input";
import { MeetingMinutes } from "./minutes";
import { SectionTools } from "./section-tools";
import { VoiceNoteInput, VoiceNotePlayer } from "./voice-note";
import { EMPTY_MEETING_TIME, type MeetingTimeDraft } from "../../lib/natural-meeting-time";
import type { VoiceDraft } from "../../lib/voice-notes";

type MinutesHint = { status: string; published: boolean; flagged: boolean };

export type RequestRow = {
  id: string;
  student_id: string;
  faculty_id: string;
  reason: string;
  meeting_at: string | null;
  status: string;
  response_note: string | null;
  request_voice_path: string | null;
  response_voice_path: string | null;
  created_at: string;
};

const stamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export const requestStatus = {
  pending: "Waiting",
  accepted: "Accepted",
  declined: "Declined",
  alternative: "Another time",
  cancelled: "Cancelled",
  expired: "Expired",
} as const;

export const requestChips = ["Project doubt", "Signature needed", "Backlog review", "Quick question"] as const;
export const replyChips = ["Come in office hours", "Send the draft first", "After 3 pm today", "Next week works"] as const;

export function RequestChips({ value, onPick }: { value: string; onPick: (text: string) => void }) {
  return <div className={styles.chipRow} role="group" aria-label="Quick reasons">
    {requestChips.map(chip => <button type="button" key={chip} className={value === chip ? styles.chipActive : styles.chip} onClick={() => onPick(chip)}>{chip}</button>)}
  </div>;
}

export function RequestInbox({
  role,
  userId,
  rows,
  names,
  working,
  captureId,
  notes,
  setNotes,
  replyVoices,
  setReplyVoice,
  onBusy,
  alternativeTimes,
  setAlternativeTime,
  onRespond,
  onCancel,
}: {
  role: "student" | "faculty" | "admin";
  userId: string;
  rows: RequestRow[];
  names: (id: string) => string;
  working: boolean;
  captureId: string | null;
  notes: Record<string, string>;
  setNotes: (id: string, value: string) => void;
  replyVoices: Record<string, VoiceDraft | null>;
  setReplyVoice: (id: string, value: VoiceDraft | null) => void;
  onBusy: (id: string, busy: boolean) => void;
  alternativeTimes: Record<string, MeetingTimeDraft>;
  setAlternativeTime: (id: string, value: MeetingTimeDraft) => void;
  onRespond: (id: string, status: "accepted" | "declined" | "alternative") => void;
  onCancel: (id: string) => void;
}) {
  const [openMinutes, setOpenMinutes] = useState<string | null>(null);
  const [minutesHints, setMinutesHints] = useState<Record<string, MinutesHint>>({});
  const [search, setSearch] = useState("");
  const [day, setDay] = useState(() => startOfLocalDay());
  const [scope, setScope] = useState<"open" | "day" | "all">("open");
  const mine = useMemo(() => rows.filter(row => role === "faculty" ? row.faculty_id === userId : row.student_id === userId)
    .sort((a, b) => Number(a.status !== "pending") - Number(b.status !== "pending") || Date.parse(b.created_at) - Date.parse(a.created_at)), [rows, role, userId]);
  const pending = mine.filter(row => row.status === "pending").length;
  const visible = useMemo(() => mine.filter(row => {
    if (scope === "open") {
      if (role === "faculty" && row.status !== "pending") return false;
      if (role !== "faculty" && !["pending", "alternative"].includes(row.status)) return false;
    }
    if (scope === "day" && !isSameLocalDay(row.created_at, day)) return false;
    const other = role === "faculty" ? row.student_id : row.faculty_id;
    const label = requestStatus[row.status as keyof typeof requestStatus] ?? row.status;
    return matchesQuery(`${names(other)} ${row.reason} ${row.response_note ?? ""} ${label}`, search);
  }), [mine, scope, role, day, search, names]);
  const minuteIds = visible.filter(row => ["accepted", "alternative", "expired"].includes(row.status)).map(row => row.id);

  useEffect(() => {
    if (!supabase || minuteIds.length === 0) { setMinutesHints({}); return; }
    let alive = true;
    void supabase.from("meeting_minutes").select("request_id,status,student_confirmed_at,faculty_flagged_at").in("request_id", minuteIds)
      .then(({ data }) => {
        if (!alive) return;
        const next: Record<string, MinutesHint> = {};
        for (const item of data ?? []) {
          next[item.request_id as string] = {
            status: String(item.status),
            published: !!item.student_confirmed_at,
            flagged: !!item.faculty_flagged_at,
          };
        }
        setMinutesHints(next);
      });
    return () => { alive = false; };
  }, [minuteIds.join("|")]);

  return <>
    <div className={styles.pageHead}>
      <div>
        <h1>Requests.</h1>
        <p>{role === "faculty" ? `${pending} waiting for you.` : "Status stays here. No email."}</p>
      </div>
    </div>
    <SectionTools
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Search by name or reason"
      chips={[{ id: "open", label: "Open" }, { id: "day", label: "This day" }, { id: "all", label: "All" }]}
      chip={scope}
      onChip={id => setScope(id as "open" | "day" | "all")}
      day={scope === "day" ? day : undefined}
      onDayChange={scope === "day" ? setDay : undefined}
    />
    {!mine.length && <section className={styles.card}><p>Nothing here yet.</p></section>}
    {!!mine.length && visible.length === 0 && <section className={styles.card}><p>{search.trim() ? "No matching requests." : scope === "day" ? "No requests on this day." : "Nothing open right now."}</p></section>}
    {visible.map(row => {
      const other = role === "faculty" ? row.student_id : row.faculty_id;
      const label = requestStatus[row.status as keyof typeof requestStatus] ?? row.status;
      const when = row.meeting_at ? stamp(row.meeting_at) : "Time unset";
      const canReply = role === "faculty" && row.status === "pending";
      const canCancel = row.status === "pending" || (role === "student" && row.status === "alternative");
      const showMinutes = ["accepted", "alternative", "expired"].includes(row.status);
      return <article className={styles.requestCard} key={row.id}>
        <div className={styles.requestTop}>
          <div>
            <h2>{names(other)}</h2>
            <span className={styles.muted}>{when}</span>
          </div>
          <span className={`${styles.badge} ${row.status === "accepted" ? styles.good : row.status === "pending" ? "" : styles.away}`}>{label}</span>
        </div>
        <p>{row.reason}</p>
        {row.response_note && <p className={styles.muted}>{row.response_note}</p>}
        {row.request_voice_path && <VoiceNotePlayer path={row.request_voice_path} user={userId} label="Request voice" />}
        {row.response_voice_path && <VoiceNotePlayer path={row.response_voice_path} user={userId} label="Reply voice" />}
        {canReply && <>
          <div className={styles.chipRow}>
            {replyChips.map(chip => <button type="button" key={chip} className={notes[row.id] === chip ? styles.chipActive : styles.chip} onClick={() => setNotes(row.id, chip)}>{chip}</button>)}
          </div>
          <label>Note<input value={notes[row.id] || ""} maxLength={500} onChange={event => setNotes(row.id, event.target.value)} placeholder="Optional" /></label>
          <NaturalTimeInput label="Another time" value={alternativeTimes[row.id] || EMPTY_MEETING_TIME} onChange={value => setAlternativeTime(row.id, value)} />
          <VoiceNoteInput value={replyVoices[row.id] || null} onChange={value => setReplyVoice(row.id, value)} onBusyChange={busy => onBusy(row.id, busy)} disabled={working} label="Reply voice" />
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={working || !!captureId} onClick={() => onRespond(row.id, "accepted")}>Accept</button>
            <button type="button" className={styles.secondary} disabled={working || !!captureId} onClick={() => onRespond(row.id, "alternative")}>Another time</button>
            <button type="button" disabled={working || !!captureId} onClick={() => onRespond(row.id, "declined")}>Decline</button>
          </div>
        </>}
        {canCancel && <div className={styles.actions}><button type="button" disabled={working} onClick={() => onCancel(row.id)}>{row.status === "alternative" ? "Cancel this time" : "Cancel request"}</button></div>}
        {showMinutes && <>
          <div className={styles.minutesLinkRow}>
            <button type="button" className={styles.link} onClick={() => setOpenMinutes(openMinutes === row.id ? null : row.id)}>{openMinutes === row.id ? "Hide minutes" : "Minutes"}</button>
            {minutesHints[row.id]?.flagged ? <span className={`${styles.badge} ${styles.busy}`}>Correction needed</span>
              : minutesHints[row.id]?.published ? <span className={`${styles.badge} ${styles.good}`}>Published</span>
              : minutesHints[row.id]?.status === "ready" ? <span className={styles.badge}>{role === "faculty" ? "Draft ready" : "Ready to publish"}</span>
              : minutesHints[row.id]?.status === "transcribing" ? <span className={styles.badge}>Transcribing</span>
              : null}
          </div>
          {openMinutes === row.id && <MeetingMinutes requestId={row.id} userId={userId} role={role} />}
        </>}
      </article>;
    })}
  </>;
}
