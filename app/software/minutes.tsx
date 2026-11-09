"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase-client";
import { cleanMinuteActions, type MinuteAction } from "../../lib/minute-actions";
import { uploadVoice, type VoiceDraft } from "../../lib/voice-notes";
import styles from "./software.module.css";
import { VoiceNoteInput, VoiceNotePlayer } from "./voice-note";

type Minutes = {
  id: string; audio_path: string | null; transcript: string; actions: MinuteAction[]; status: "empty" | "transcribing" | "ready" | "failed";
  failure: string | null; student_confirmed_at: string | null; faculty_flagged_at: string | null; faculty_flag_note: string | null;
};

const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function MeetingMinutes({ requestId, userId, role }: { requestId: string; userId: string; role: "student" | "faculty" | "admin" }) {
  const [row, setRow] = useState<Minutes | null>(null);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [transcript, setTranscript] = useState("");
  const [actionText, setActionText] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const isStudent = role === "student";
  const isFaculty = role === "faculty";

  async function load() {
    if (!supabase) return;
    const { data, error: readError } = await supabase.from("meeting_minutes").select("id,audio_path,transcript,actions,status,failure,student_confirmed_at,faculty_flagged_at,faculty_flag_note").eq("request_id", requestId).maybeSingle();
    if (readError) { setError("Minutes are not available yet."); return; }
    const next = data as Minutes | null;
    setRow(next);
    if (next && next.status !== "transcribing") {
      setTranscript(next.transcript);
      setActionText(next.actions.map(item => item.due_on ? `${item.text} | ${item.due_on}` : item.text).join("\n"));
    }
  }
  useEffect(() => { void load(); }, [requestId]);

  async function transcribe() {
    if (!supabase || !draft) return;
    setBusy(true); setError(""); setMessage("");
    const controller = new AbortController();
    try {
      const path = await uploadVoice(supabase, userId, draft, controller.signal);
      const submitted = await supabase.rpc("submit_meeting_minutes", { p_request: requestId, p_voice_path: path });
      if (submitted.error || !submitted.data) throw new Error(submitted.error?.message || "Could not save this recording.");
      setDraft(null);
      await requestTranscript(String(submitted.data));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this recording.");
    } finally { setBusy(false); }
  }

  async function requestTranscript(minuteId: string) {
    if (!supabase) return;
    const result = await supabase.functions.invoke("transcribe-minutes", { body: { minute_id: minuteId } });
    const body = result.data as { ok?: boolean; message?: string } | null;
    if (result.error || body?.ok === false) setError(body?.message || "The recording is saved. Type the minutes if the transcript does not appear.");
    else setMessage("Transcript ready. Publish when it looks right.");
    await load();
  }

  async function saveText() {
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const actions = cleanMinuteActions(actionText.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
        const [text, due] = line.split("|").map(part => part.trim());
        return { text, due_on: due || null, done: false };
      }));
      const saved = await supabase.rpc("save_meeting_minutes", { p_request: requestId, p_transcript: transcript, p_actions: actions });
      if (saved.error) throw new Error(saved.error.message);
      setMessage(isStudent ? "Saved. Publish when you are happy with this version." : "Minutes updated.");
      setEditing(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the minutes.");
    } finally { setBusy(false); }
  }

  async function publish() {
    if (!supabase) return;
    setBusy(true); setError("");
    const saved = await supabase.rpc("confirm_meeting_minutes", { p_request: requestId });
    setBusy(false);
    if (saved.error) { setError(saved.error.message); return; }
    await load();
  }

  async function flag() {
    if (!supabase) return;
    setBusy(true); setError("");
    const saved = await supabase.rpc("flag_meeting_minutes", { p_request: requestId, p_note: flagNote.trim() || null });
    setBusy(false);
    if (saved.error) { setError(saved.error.message); return; }
    setFlagging(false);
    setFlagNote("");
    setMessage("Student was asked to correct these minutes.");
    await load();
  }

  async function toggle(action: MinuteAction) {
    if (!supabase) return;
    const nextDone = !action.done;
    setRow(current => current ? { ...current, actions: current.actions.map(item => item.id === action.id ? { ...item, done: nextDone } : item) } : current);
    const saved = await supabase.rpc("set_minute_action_done", { p_request: requestId, p_action: action.id, p_done: nextDone });
    if (saved.error) { setError(saved.error.message); await load(); }
  }

  function startEdit() {
    if (!row) return;
    setTranscript(row.transcript);
    setActionText(row.actions.map(item => item.due_on ? `${item.text} | ${item.due_on}` : item.text).join("\n"));
    setEditing(true);
    setFlagging(false);
    setError("");
    setMessage("");
  }

  const published = !!row?.student_confirmed_at;
  const flagged = !!row?.faculty_flagged_at;
  const canRecord = isStudent && (!row || row.status === "empty" || row.status === "failed");
  const showReview = row?.status === "ready" && !editing;

  return <section className={styles.minutes} aria-labelledby={`${requestId}-minutes`}>
    <div className={styles.minutesHead}>
      <h3 id={`${requestId}-minutes`}>Minutes</h3>
      <p className={styles.muted}>{isStudent ? "You own this draft · private · 8 min max" : "Optional glance · actions land on My day"}</p>
    </div>

    {row?.status === "transcribing" && <div className={styles.minutesBar}>
      <p role="status">Transcribing…</p>
      {isStudent && <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setBusy(true); setError(""); setMessage(""); void requestTranscript(row.id).finally(() => setBusy(false)); }}>Retry</button>}
    </div>}

    {row?.status === "failed" && <p role="alert" className={styles.error}>{row.failure || "Transcription failed. Record again or type the minutes."}</p>}

    {isFaculty && (!row || row.status === "empty") && <p className={styles.muted}>Waiting for the student to add minutes after the meeting.</p>}

    {showReview && <>
      {flagged && <p className={styles.error} role="status">Correction requested{row.faculty_flag_note ? `: ${row.faculty_flag_note}` : "."}{isStudent ? " Edit and publish again." : ""}</p>}
      {row.audio_path && <details className={styles.minutesAudio}><summary>Play recording</summary><VoiceNotePlayer path={row.audio_path} user={userId} label="Meeting recording"/></details>}
      <details className={styles.minutesAudio} open={isStudent || flagged}><summary>Minutes</summary><p className={styles.transcript}>{row.transcript || "No minutes yet."}</p></details>
      {row.actions.length > 0 ? <ul className={styles.actionList}>{row.actions.map(action => <li key={action.id}><label className={styles.todoCheck}><input type="checkbox" checked={action.done} onChange={() => void toggle(action)} /><span>{action.text}{action.due_on ? ` · due ${action.due_on}` : ""}</span></label></li>)}</ul> : <p className={styles.muted}>No action points yet.</p>}
      <div className={styles.minutesBar}>
        <p className={styles.muted}>
          {published ? `Published ${date(row.student_confirmed_at!)}` : isStudent ? "Draft - publish when ready" : "Draft - no review required"}
          {flagged ? " · flagged" : ""}
        </p>
        <div className={styles.minutesActions}>
          {isStudent && !published && <button type="button" className={styles.primary} disabled={busy} onClick={() => void publish()}>Publish</button>}
          {isStudent && published && flagged && <button type="button" className={styles.primary} disabled={busy} onClick={() => void publish()}>Publish again</button>}
          {isStudent && <button type="button" className={styles.secondary} disabled={busy} onClick={startEdit}>Edit</button>}
          {isFaculty && !flagged && !flagging && <button type="button" className={styles.secondary} disabled={busy} onClick={() => setFlagging(true)}>Ask for correction</button>}
        </div>
      </div>
      {flagging && <form className={styles.minutesEdit} onSubmit={event => { event.preventDefault(); void flag(); }}>
        <label>What should change?<textarea value={flagNote} rows={2} maxLength={500} onChange={event => setFlagNote(event.target.value)} placeholder="Optional note for the student" /></label>
        <div className={styles.minutesActions}>
          <button type="submit" className={styles.primary} disabled={busy}>Send to student</button>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => setFlagging(false)}>Cancel</button>
        </div>
      </form>}
    </>}

    {editing && row && row.status !== "empty" && <form className={styles.minutesEdit} onSubmit={event => { event.preventDefault(); void saveText(); }}>
      <label>Minutes <span className={styles.muted}>(bullet points)</span><textarea value={transcript} maxLength={12000} rows={4} onChange={event => setTranscript(event.target.value)} placeholder={"- Topic discussed\n- Decision made"} /></label>
      <label>Actions <span className={styles.muted}>(one per line · optional due date after | )</span><textarea value={actionText} rows={3} onChange={event => setActionText(event.target.value)} placeholder="Send the form | 2026-11-20" /></label>
      <div className={styles.minutesActions}>
        <button type="submit" className={styles.primary} disabled={busy}>Save</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>}

    {canRecord && !editing && <>
      <VoiceNoteInput value={draft} onChange={setDraft} onBusyChange={setRecording} disabled={busy} label="Meeting recording" limitSeconds={480} readyHint="Preview, then transcribe." />
      <div className={styles.minutesBar}>
        <p className={styles.muted}>Or type after a failed run.</p>
        <div className={styles.minutesActions}>
          <button type="button" className={styles.primary} disabled={busy || recording || !draft} onClick={() => void transcribe()}>Transcribe</button>
          {row?.status === "failed" && <button type="button" className={styles.secondary} disabled={busy} onClick={startEdit}>Type instead</button>}
        </div>
      </div>
    </>}

    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.success}>{message}</p>}
  </section>;
}
