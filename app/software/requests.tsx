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
export const declineChips = ["Not available this week", "Send email instead", "See office hours", "Already answered"] as const;

const hasReplyNote = (notes: Record<string, string>, id: string) => (notes[id] || "").trim().length > 0;

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
  onOpenOverview,
  onBatchAccept,
  onBatchAlternative,
  onAcceptAlternative,
  onAssignFollowup,
  snippets,
  pauseActive,
  loadError,
  onRetryLoad,
  studentContext,
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
  onRespond: (id: string, status: "accepted" | "declined" | "alternative", note?: string) => void;
  onCancel: (id: string) => void;
  onOpenOverview?: () => void;
  onBatchAccept?: (ids: string[]) => void;
  onBatchAlternative?: (ids: string[]) => void;
  onAcceptAlternative?: (id: string) => void;
  onAssignFollowup?: (studentId: string, title: string, dueIso: string) => void;
  snippets?: string[];
  pauseActive?: boolean;
  loadError?: string | null;
  onRetryLoad?: () => void;
  studentContext?: Record<string, { lastLine?: string; followups?: string[]; meetingToday?: boolean }>;
}) {
  const [openMinutes, setOpenMinutes] = useState<string | null>(null);
  const [openFollowup, setOpenFollowup] = useState<string | null>(null);
  const [followupTitles, setFollowupTitles] = useState<Record<string, string>>({});
  const [followupTimes, setFollowupTimes] = useState<Record<string, MeetingTimeDraft>>({});
  const [minutesHints, setMinutesHints] = useState<Record<string, MinutesHint>>({});
  const [search, setSearch] = useState("");
  const [day, setDay] = useState(() => startOfLocalDay());
  const [scope, setScope] = useState<"open" | "day" | "all">("open");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [declineNeed, setDeclineNeed] = useState<string | null>(null);
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
  const batchable = useMemo(() => visible.filter(row => role === "faculty" && row.status === "pending"), [visible, role]);
  const batchIds = useMemo(() => batchable.map(row => row.id), [batchable]);
  const selectedPending = useMemo(() => batchIds.filter(id => selected.has(id)), [batchIds, selected]);

  const toggleSelected = (id: string, on: boolean) => {
    setSelected(previous => {
      const next = new Set(previous);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const tryDecline = (id: string) => {
    if (!hasReplyNote(notes, id) && !replyVoices[id]) {
      setDeclineNeed(id);
      return;
    }
    setDeclineNeed(null);
    onRespond(id, "declined");
  };

  useEffect(() => {
    setSelected(previous => {
      const next = new Set([...previous].filter(id => batchIds.includes(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [batchIds.join("|")]);

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
        <p>{role === "faculty" ? (pending ? `${pending} waiting for you.` : "Inbox clear. New asks land here.") : "Status stays here. No email."}</p>
      </div>
      {role === "faculty" && pending > 0 && <p className={styles.resultCount} role="status">{pending} open</p>}
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
    {loadError && <section className={`${styles.card} ${styles.facultyDashCard}`} role="alert">
      <p>Could not load requests.</p>
      <p className={styles.muted}>{loadError}</p>
      {onRetryLoad && <button type="button" className={styles.secondary} disabled={working} onClick={onRetryLoad}>Try again</button>}
    </section>}
    {role === "faculty" && pauseActive && <p className={styles.muted} role="status">New requests are paused. Students still see your status; only pending items appear below until you turn pause off in Availability settings.</p>}
    {role === "faculty" && onBatchAccept && batchable.length > 0 && <div className={styles.actions}>
      {selectedPending.length > 0 ? <>
        <button type="button" className={styles.primary} disabled={working || !!captureId} onClick={() => { onBatchAccept(selectedPending); setSelected(new Set()); }}>Accept selected · {selectedPending.length}</button>
        {onBatchAlternative && <button type="button" className={styles.secondary} disabled={working || !!captureId} onClick={() => { onBatchAlternative(selectedPending); setSelected(new Set()); }}>Another time for selected</button>}
        <button type="button" className={styles.secondary} disabled={working} onClick={() => setSelected(new Set())}>Clear selection</button>
      </> : <button type="button" className={styles.secondary} disabled={working} onClick={() => setSelected(new Set(batchIds))}>Select all waiting ({batchable.length})</button>}
    </div>}
    {!loadError && !mine.length && <section className={`${styles.card} ${styles.facultyDashCard}`}>
      <p>{role === "faculty" ? "Inbox clear." : "No requests yet."}</p>
      <p className={styles.muted}>{role === "faculty" ? "When a student asks for a time, it lands here." : "After you send a meeting ask from Find faculty, status stays here — no email."}</p>
      {role === "faculty" && onOpenOverview && <button type="button" className={styles.link} onClick={onOpenOverview}>Back to Overview</button>}
    </section>}
    {!loadError && !!mine.length && visible.length === 0 && <section className={`${styles.card} ${styles.facultyDashCard}`}>
      <p>{search.trim() ? "No matching requests." : scope === "day" ? "No requests on this day." : "Nothing open right now."}</p>
      {role === "faculty" && scope === "open" && !search.trim() && <>
        <p className={styles.muted}>When students ask for a time, accept, suggest another, or decline here.</p>
        {onOpenOverview && <button type="button" className={styles.link} onClick={onOpenOverview}>Check your status on Overview</button>}
      </>}
    </section>}
    {visible.map(row => {
      const other = role === "faculty" ? row.student_id : row.faculty_id;
      const label = requestStatus[row.status as keyof typeof requestStatus] ?? row.status;
      const when = row.meeting_at ? stamp(row.meeting_at) : "Time unset";
      const canReply = role === "faculty" && row.status === "pending";
      const canCancel = row.status === "pending" || (role === "student" && row.status === "alternative");
      const showMinutes = ["accepted", "alternative", "expired"].includes(row.status);
      const showFollowup = role === "faculty" && ["accepted", "alternative"].includes(row.status) && !!onAssignFollowup;
      const showBatchSelect = canReply && !!onBatchAccept;
      const quickSnippets = snippets?.length ? snippets : null;
      return <article className={`${styles.requestCard} ${canReply ? styles.facultyPendingCard : ""}`} key={row.id}>
        <div className={styles.requestTop}>
          <div>
            <div className={styles.requestTitleRow}>
              {showBatchSelect && <label className={`${styles.todoCheck} ${styles.batchPick}`}>
                <input type="checkbox" checked={selected.has(row.id)} disabled={working || !!captureId} onChange={event => toggleSelected(row.id, event.target.checked)} aria-label={`Select ${names(other)}`} />
              </label>}
              <div>
                <h2>{names(other)}</h2>
                <span className={styles.muted}>{when}</span>
              </div>
            </div>
          </div>
          <span className={`${styles.badge} ${row.status === "accepted" ? styles.good : row.status === "pending" ? styles.busy : styles.away}`}>{label}</span>
        </div>
        <p>{row.reason}</p>
        {row.response_note && <p className={styles.muted}>{row.response_note}</p>}
        {canReply && studentContext?.[row.student_id] && (() => {
          const ctx = studentContext[row.student_id];
          return <div className={styles.studentContext} aria-label="Student context">
            {ctx.lastLine && <p>{ctx.lastLine}</p>}
            {ctx.meetingToday && <p>You already have a meeting with them today.</p>}
            {!!ctx.followups?.length && <p>Open follow-ups: {ctx.followups.slice(0, 2).join(" · ")}</p>}
            <ul className={styles.prepChecklist}>
              <li>Quick prep · skim their note</li>
              <li>Confirm cabin / online place if needed</li>
              <li>Have the next step ready (accept, another time, or decline)</li>
            </ul>
          </div>;
        })()}
        {row.request_voice_path && <VoiceNotePlayer path={row.request_voice_path} user={userId} label="Request voice" />}
        {row.response_voice_path && <VoiceNotePlayer path={row.response_voice_path} user={userId} label="Reply voice" />}
        {canReply && <div className={styles.facultyReplyBlock}>
          {quickSnippets && quickSnippets.length > 0 && <div className={styles.chipRow} role="group" aria-label="Accept with your snippet">
            {quickSnippets.slice(0, 4).map(chip => (
              <button
                type="button"
                key={chip}
                className={styles.chip}
                disabled={working || !!captureId}
                onClick={() => { setNotes(row.id, chip); setDeclineNeed(null); onRespond(row.id, "accepted", chip); }}
              >Accept · {chip}</button>
            ))}
          </div>}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={working || !!captureId} onClick={() => onRespond(row.id, "accepted")}>Accept</button>
            <button type="button" className={styles.secondary} disabled={working || !!captureId} onClick={() => onRespond(row.id, "alternative")}>Another time</button>
            <button type="button" className={styles.secondary} disabled={working || !!captureId} onClick={() => tryDecline(row.id)}>Decline</button>
          </div>
          {declineNeed === row.id && <p role="alert" className={styles.error}>Pick a decline reason or type a short note before declining.</p>}
          <div className={styles.chipRow} role="group" aria-label="Quick replies">
            {replyChips.map(chip => <button type="button" key={chip} className={notes[row.id] === chip ? styles.chipActive : styles.chip} onClick={() => { setNotes(row.id, chip); if (declineNeed === row.id) setDeclineNeed(null); }}>{chip}</button>)}
          </div>
          <div className={styles.chipRow} role="group" aria-label="Decline reasons">
            {declineChips.map(chip => <button type="button" key={chip} className={notes[row.id] === chip ? styles.chipActive : styles.chip} onClick={() => { setNotes(row.id, chip); if (declineNeed === row.id) setDeclineNeed(null); }}>{chip}</button>)}
          </div>
          <label>Note<input value={notes[row.id] || ""} maxLength={500} onChange={event => { setNotes(row.id, event.target.value); if (declineNeed === row.id && event.target.value.trim()) setDeclineNeed(null); }} placeholder="Optional for accept or another time; needed to decline" /></label>
          <NaturalTimeInput label="Another time" value={alternativeTimes[row.id] || EMPTY_MEETING_TIME} onChange={value => setAlternativeTime(row.id, value)} />
          <VoiceNoteInput value={replyVoices[row.id] || null} onChange={value => setReplyVoice(row.id, value)} onBusyChange={busy => onBusy(row.id, busy)} disabled={working} label="Reply voice" />
        </div>}
        {role === "student" && row.status === "alternative" && onAcceptAlternative && <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={working || !!captureId} onClick={() => onAcceptAlternative(row.id)}>Accept this time</button>
        </div>}
        {canCancel && <div className={styles.actions}><button type="button" disabled={working} onClick={() => onCancel(row.id)}>{row.status === "alternative" ? "Cancel this time" : "Cancel request"}</button></div>}
        {showFollowup && <div className={styles.followupBlock}>
          <button type="button" className={styles.link} onClick={() => setOpenFollowup(openFollowup === row.id ? null : row.id)}>{openFollowup === row.id ? "Hide follow-up" : "Assign follow-up"}</button>
          {openFollowup === row.id && <form className={styles.followupForm} onSubmit={event => {
            event.preventDefault();
            const title = (followupTitles[row.id] || "").trim();
            const dueIso = followupTimes[row.id]?.iso || "";
            if (title.length < 2) return;
            if (!dueIso) return;
            onAssignFollowup(row.student_id, title, dueIso);
            setFollowupTitles(previous => ({ ...previous, [row.id]: "" }));
            setFollowupTimes(previous => ({ ...previous, [row.id]: EMPTY_MEETING_TIME }));
            setOpenFollowup(null);
          }}>
            <label>Title<input value={followupTitles[row.id] || ""} maxLength={200} required onChange={event => setFollowupTitles(previous => ({ ...previous, [row.id]: event.target.value }))} placeholder="e.g. Submit revised draft" /></label>
            <NaturalTimeInput label="Due" value={followupTimes[row.id] || EMPTY_MEETING_TIME} onChange={value => setFollowupTimes(previous => ({ ...previous, [row.id]: value }))} required />
            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={working}>Assign to student</button>
            </div>
          </form>}
        </div>}
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
