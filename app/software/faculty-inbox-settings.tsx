"use client";

import { useEffect, useState } from "react";
import styles from "./software.module.css";

export type FacultyLeaveDay = {
  id: string;
  leave_on: string;
  note: string;
};

export type FacultyInboxPrefsValues = {
  pauseRequests: boolean;
  quietStart: string;
  quietEnd: string;
  autoBusyOutsideHours: boolean;
  snippets: string[];
  leaveDays: FacultyLeaveDay[];
};

export function FacultyInboxPrefs({
  values,
  working,
  onSavePrefs,
  onAddLeaveDay,
  onRemoveLeaveDay,
}: {
  values: FacultyInboxPrefsValues;
  working?: boolean;
  onSavePrefs: (next: Pick<FacultyInboxPrefsValues, "pauseRequests" | "quietStart" | "quietEnd" | "autoBusyOutsideHours" | "snippets">) => void;
  onAddLeaveDay: (leaveOn: string, note: string) => void;
  onRemoveLeaveDay: (id: string) => void;
}) {
  const [pause, setPause] = useState(values.pauseRequests);
  const [quietStart, setQuietStart] = useState(values.quietStart);
  const [quietEnd, setQuietEnd] = useState(values.quietEnd);
  const [autoBusy, setAutoBusy] = useState(values.autoBusyOutsideHours);
  const [snippets, setSnippets] = useState(values.snippets);
  const [snippetDraft, setSnippetDraft] = useState("");
  const [leaveOn, setLeaveOn] = useState("");
  const [leaveNote, setLeaveNote] = useState("");
  const [leaveDayRows, setLeaveDayRows] = useState(values.leaveDays);
  const leaveDaysKey = values.leaveDays.map(day => `${day.id}:${day.leave_on}`).join("|");

  useEffect(() => {
    setPause(values.pauseRequests);
    setQuietStart(values.quietStart);
    setQuietEnd(values.quietEnd);
    setAutoBusy(values.autoBusyOutsideHours);
    setSnippets(values.snippets);
    setLeaveDayRows(values.leaveDays);
  }, [values.pauseRequests, values.quietStart, values.quietEnd, values.autoBusyOutsideHours, values.snippets.join("|"), leaveDaysKey]);

  const addSnippet = () => {
    const text = snippetDraft.trim();
    if (!text || snippets.length >= 12) return;
    setSnippets(previous => [...previous, text].slice(0, 12));
    setSnippetDraft("");
  };

  return <section className={`${styles.card} ${styles.facultyDashCard}`}>
    <div className={styles.sectionHead}>
      <div>
        <h2>Inbox preferences</h2>
        <p>Pause new asks, quiet hours, quick reply snippets, and leave days.</p>
      </div>
    </div>

    <label className={styles.todoCheck}>
      <input type="checkbox" checked={pause} disabled={working} onChange={event => setPause(event.target.checked)} />
      <span>Pause new meeting requests</span>
    </label>
    <p className={styles.muted}>Students can still see your status. Pending requests stay in your inbox.</p>

    <div className={`${styles.hoursFields} ${styles.hoursFieldsLead}`}>
      <label>Quiet hours start<input type="time" value={quietStart} disabled={working} onChange={event => setQuietStart(event.target.value)} /></label>
      <label>Quiet hours end<input type="time" value={quietEnd} disabled={working} onChange={event => setQuietEnd(event.target.value)} /></label>
    </div>
    <p className={styles.muted}>Optional. Used when your campus enables quiet-hour hints on new requests.</p>

    <label className={styles.todoCheck}>
      <input type="checkbox" checked={autoBusy} disabled={working} onChange={event => setAutoBusy(event.target.checked)} />
      <span>Show Busy outside office hours</span>
    </label>
    <p className={styles.muted}>When you have no manual status set, students see Busy instead of Away outside your weekly hours.</p>

    <h3 className={styles.subHead}>Reply snippets</h3>
    <p className={styles.muted}>Tap in Requests to fill a note. Up to 12, 120 characters each.</p>
    {snippets.length > 0 && <ul className={styles.facultyDashList}>
      {snippets.map((item, index) => <li key={`${index}-${item}`}>
        <p>{item}</p>
        <button type="button" className={styles.link} disabled={working} onClick={() => setSnippets(previous => previous.filter((_, i) => i !== index))}>Remove</button>
      </li>)}
    </ul>}
    {snippets.length < 12 && <div className={styles.hoursFields}>
      <label className={styles.todoField}>New snippet<input value={snippetDraft} maxLength={120} disabled={working} onChange={event => setSnippetDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addSnippet(); } }} placeholder="e.g. After 3 pm today" /></label>
      <div className={styles.fieldAction}><span aria-hidden="true">Add</span><button type="button" className={styles.secondary} disabled={working || !snippetDraft.trim()} onClick={addSnippet}>Add snippet</button></div>
    </div>}

    <div className={`${styles.actions} ${styles.actionsSpaced}`}>
      <button type="button" className={styles.primary} disabled={working} onClick={() => onSavePrefs({ pauseRequests: pause, quietStart, quietEnd, autoBusyOutsideHours: autoBusy, snippets })}>Save inbox preferences</button>
    </div>

    <h3 className={styles.subHeadSpaced}>Leave days</h3>
    <p className={styles.muted}>Show students when you are not taking new meetings.</p>
    {leaveDayRows.length > 0 && <ul className={styles.facultyDashList}>
      {leaveDayRows.map(day => <li key={day.id}>
        <div>
          <strong>{day.leave_on}</strong>
          {day.note && <span className={styles.muted}>{day.note}</span>}
        </div>
        <button type="button" className={styles.link} disabled={working} onClick={() => onRemoveLeaveDay(day.id)}>Remove</button>
      </li>)}
    </ul>}
    <form className={`${styles.hoursFields} ${styles.hoursFieldsFollow}`} onSubmit={event => {
      event.preventDefault();
      if (!leaveOn) return;
      onAddLeaveDay(leaveOn, leaveNote.trim());
      setLeaveOn("");
      setLeaveNote("");
    }}>
      <label>Date<input type="date" required value={leaveOn} disabled={working} onChange={event => setLeaveOn(event.target.value)} /></label>
      <label>Note<input value={leaveNote} maxLength={200} disabled={working} onChange={event => setLeaveNote(event.target.value)} placeholder="Optional" /></label>
      <div className={styles.fieldAction}><span aria-hidden="true">Add</span><button type="submit" className={styles.secondary} disabled={working || !leaveOn}>Add leave day</button></div>
    </form>
  </section>;
}
