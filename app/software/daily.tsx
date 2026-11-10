"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { supabase } from "../../lib/supabase-client";
import {
  discardCampusFile,
  isImageMime,
  isOfficeMime,
  isPdfMime,
  isTextMime,
  prepareCampusFile,
  signedCampusFileUrl,
  uploadCampusFile,
  type CampusFileDraft,
  type CampusFileKind,
} from "../../lib/campus-files";
import { EMPTY_MEETING_TIME, type MeetingTimeDraft } from "../../lib/natural-meeting-time";
import { formatDayLabel, isSameLocalDay, isToday, matchesQuery, startOfLocalDay } from "../../lib/section-browse";
import { NaturalTimeInput } from "./natural-time-input";
import { SectionTools } from "./section-tools";
import { ChoiceSelect } from "./choice-select";
import { PersonPicker } from "./person-picker";
import styles from "./software.module.css";

type Person = { id: string; name: string; role: string; department: string; active: boolean; email?: string };
type Deadline = { id: string; title: string; due_at: string; done: boolean };
type NoticeAttachment = { id?: string; path: string; name: string; mime?: string | null; sort_order?: number };
type NoticeRow = {
  id: string;
  title: string;
  body: string;
  audience: string;
  audience_value: string;
  due_at: string | null;
  expires_at: string;
  created_at: string;
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  notice_attachments?: NoticeAttachment[] | null;
};
type EventRow = { id: string; title: string; body: string; place: string; starts_at: string; ends_at: string | null; audience: string; audience_value: string; author_id: string; club_id: string | null; attachment_path?: string | null; attachment_name?: string | null; attachment_mime?: string | null };
type ClubRow = { id: string; name: string };
type Meeting = { id: string; student_id: string; faculty_id: string; meeting_at: string | null; status: string; reason: string };

const stamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const audienceDepartments = (value: string) => value.split("|").map(part => part.trim()).filter(Boolean);
const audienceIncludesDepartment = (value: string, department: string) => audienceDepartments(value).includes(department);
const audienceLabel = (audience: string, value: string) => {
  if (audience === "institution") return "Whole college";
  if (audience === "department") {
    const departments = audienceDepartments(value);
    if (!departments.length) return "Departments";
    if (departments.length === 1) return departments[0];
    if (departments.length <= 3) return departments.join(" · ");
    return `${departments.length} departments`;
  }
  return value === "student" ? "Students" : value === "faculty" ? "Faculty" : "Administrators";
};
const PREP_ITEMS = ["Bring notes", "Confirm place", "Be on time"] as const;
const prepStorageKey = (userId: string, requestId: string) => `campuspulse.prep.${userId}.${requestId}`;

function loadPrepChecked(userId: string, requestId: string): boolean[] {
  try {
    const raw = JSON.parse(localStorage.getItem(prepStorageKey(userId, requestId)) || "null");
    if (!Array.isArray(raw)) return PREP_ITEMS.map(() => false);
    return PREP_ITEMS.map((_, index) => raw[index] === true);
  } catch {
    return PREP_ITEMS.map(() => false);
  }
}

function savePrepChecked(userId: string, requestId: string, checked: boolean[]) {
  try { localStorage.setItem(prepStorageKey(userId, requestId), JSON.stringify(checked)); } catch { /* not persisted */ }
}

function minutesUntil(iso: string) {
  return Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
}

function hourConflict(meetingAt: string, eventStart: string, eventEnd: string | null) {
  if (!isSameLocalDay(meetingAt, new Date(eventStart))) return false;
  const start = Date.parse(meetingAt);
  const eStart = Date.parse(eventStart);
  const eEnd = eventEnd ? Date.parse(eventEnd) : eStart + 60 * 60 * 1000;
  const mEnd = start + 60 * 60 * 1000;
  if (start < eEnd && mEnd > eStart) return true;
  return Math.abs(start - eStart) <= 60 * 60 * 1000;
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function icsDate(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function downloadMeetingIcs(meeting: Meeting, otherName: string) {
  if (!meeting.meeting_at) return;
  const start = meeting.meeting_at;
  const end = new Date(Date.parse(start) + 60 * 60 * 1000).toISOString();
  const summary = escapeIcs(`Meet ${otherName}`);
  const body = escapeIcs(meeting.reason || "CampusPulse meeting");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CampusPulse//EN",
    "BEGIN:VEVENT",
    `UID:meet-${meeting.id}@campuspulse`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${body}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `meet-${otherName.replace(/[^\w\s-]/g, "").trim().slice(0, 40) || "meeting"}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadEventIcs(event: EventRow, clubName?: string) {
  const summary = escapeIcs(event.title);
  const body = escapeIcs(clubName ? `${clubName}\n\n${event.body}` : event.body);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CampusPulse//EN",
    "BEGIN:VEVENT",
    `UID:${event.id}@campuspulse`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(event.starts_at)}`,
    ...(event.ends_at ? [`DTEND:${icsDate(event.ends_at)}`] : []),
    `SUMMARY:${summary}`,
    ...(event.place ? [`LOCATION:${escapeIcs(event.place)}`] : []),
    `DESCRIPTION:${body}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${event.title.replace(/[^\w\s-]/g, "").trim().slice(0, 60) || "event"}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

function AudienceFields({ audience, value, departments, onAudience, onValue, disabled = false }: {
  audience: string; value: string; departments: string[]; onAudience: (value: string) => void; onValue: (value: string) => void; disabled?: boolean;
}) {
  const selectedDepartments = audienceDepartments(value);
  const toggleDepartment = (department: string) => {
    const next = selectedDepartments.includes(department)
      ? selectedDepartments.filter(item => item !== department)
      : [...selectedDepartments, department];
    onValue(next.join("|"));
  };
  return <div className={styles.publishAudience}>
    <ChoiceSelect
      label="Who should see this"
      value={audience}
      disabled={disabled}
      onChange={next => onAudience(next)}
      options={[
        { value: "institution", label: "Whole college" },
        { value: "department", label: "Selected departments" },
        { value: "role", label: "One role" },
      ]}
    />
    {audience === "department" && (
      <div className={styles.departmentPicker}>
        <span className={styles.choiceSelectLabel}>Departments</span>
        <p className={styles.muted}>Select one or more departments that should see this.</p>
        <div className={styles.chipRow} role="group" aria-label="Departments">
          {departments.map(item => (
            <button
              type="button"
              key={item}
              className={selectedDepartments.includes(item) ? styles.chipActive : styles.chip}
              aria-pressed={selectedDepartments.includes(item)}
              disabled={disabled}
              onClick={() => toggleDepartment(item)}
            >{item}</button>
          ))}
        </div>
        <input type="hidden" value={value} required readOnly />
        {!selectedDepartments.length && <p className={styles.muted}>Choose at least one department.</p>}
      </div>
    )}
    {audience === "role" && (
      <ChoiceSelect
        label="Role"
        value={value || "student"}
        disabled={disabled}
        required
        onChange={onValue}
        options={[
          { value: "student", label: "Students" },
          { value: "faculty", label: "Faculty" },
          { value: "admin", label: "Administrators" },
        ]}
      />
    )}
  </div>;
}

function noticeFiles(row: NoticeRow): NoticeAttachment[] {
  const nested = (row.notice_attachments || [])
    .filter(item => item.path)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (nested.length) return nested;
  if (row.attachment_path) {
    return [{
      path: row.attachment_path,
      name: row.attachment_name || "Attachment",
      mime: row.attachment_mime,
      sort_order: 0,
    }];
  }
  return [];
}

function AttachmentPick({
  kind,
  drafts,
  disabled,
  onChange,
  onError,
  maxFiles = kind === "notice" ? 5 : 1,
}: {
  kind: CampusFileKind;
  drafts: CampusFileDraft[];
  disabled?: boolean;
  onChange: (drafts: CampusFileDraft[]) => void;
  onError: (message: string) => void;
  maxFiles?: number;
}) {
  const multi = maxFiles > 1;
  const label = kind === "event" ? "Poster (optional)" : multi ? "Attachments (optional)" : "Attachment (optional)";
  const hint = kind === "event"
    ? "JPG, PNG, WEBP, or GIF. Up to 10 MB."
    : multi
      ? `PDF, photo, or common office document. Up to ${maxFiles} files · 10 MB each.`
      : "PDF, photo, or common office document. Up to 10 MB.";
  const accept = kind === "event"
    ? "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
    : "image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/csv,.jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    try {
      const room = Math.max(0, maxFiles - drafts.length);
      if (!room) {
        onError(multi ? `You can attach up to ${maxFiles} files.` : "Remove the current file before adding another.");
        return;
      }
      const chosen = files.slice(0, room);
      const prepared: CampusFileDraft[] = [];
      for (const file of chosen) prepared.push(await prepareCampusFile(file, kind));
      onChange(multi ? [...drafts, ...prepared].slice(0, maxFiles) : prepared.slice(0, 1));
      onError(files.length > room ? `Only ${maxFiles} files can be attached.` : "");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not use that file.");
    }
  }

  return <div className={styles.attachmentPick}>
    <label>
      {label}
      <input
        type="file"
        accept={accept}
        multiple={multi}
        disabled={disabled || drafts.length >= maxFiles}
        onChange={event => void pick(event)}
      />
    </label>
    <p className={styles.muted}>{drafts.length ? `${drafts.length} file${drafts.length === 1 ? "" : "s"} selected` : hint}</p>
    {!!drafts.length && (
      <ul className={styles.attachmentList}>
        {drafts.map(draft => (
          <li key={draft.id}>
            <span>{draft.name}</span>
            <button
              type="button"
              className={styles.link}
              disabled={disabled}
              onClick={() => onChange(drafts.filter(item => item.id !== draft.id))}
            >Remove</button>
          </li>
        ))}
      </ul>
    )}
  </div>;
}

function AttachmentView({ path, name, mime }: { path: string; name?: string | null; mime?: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [textBody, setTextBody] = useState<string | null>(null);
  const [textFailed, setTextFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const label = name?.trim() || "Attachment";
  const image = isImageMime(mime);
  const pdf = isPdfMime(mime);
  const text = isTextMime(mime);
  const office = isOfficeMime(mime);
  const canPreview = image || pdf || text;

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    setFailed(false);
    void signedCampusFileUrl(supabase, path).then(next => {
      if (alive) setUrl(next);
    }).catch(() => {
      if (alive) setFailed(true);
    });
    return () => { alive = false; };
  }, [path]);

  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    if (open) {
      if (!panel.open) panel.showModal();
      return;
    }
    if (panel.open) panel.close();
  }, [open]);

  useEffect(() => {
    if (!open || !url || !text) {
      setTextBody(null);
      setTextFailed(false);
      return;
    }
    let alive = true;
    setTextBody(null);
    setTextFailed(false);
    void fetch(url).then(async response => {
      if (!response.ok) throw new Error("Could not read file");
      const body = await response.text();
      if (alive) setTextBody(body);
    }).catch(() => {
      if (alive) setTextFailed(true);
    });
    return () => { alive = false; };
  }, [open, url, text]);

  async function downloadFile() {
    if (!url || downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not download this file.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = label;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not download this file.");
    } finally {
      setDownloading(false);
    }
  }

  if (failed) return <p className={styles.muted}>Attachment unavailable.</p>;
  if (!url) return <p className={styles.muted}>Opening attachment…</p>;

  if (office || !canPreview) {
    return <div className={styles.attachmentPreview}>
      <p className={styles.attachmentFileName}>{label}</p>
      <p className={styles.muted}>Download the file, then open it on your device.</p>
      <div className={styles.attachmentActions}>
        <button type="button" className={styles.secondary} disabled={downloading} onClick={() => void downloadFile()}>
          {downloading ? "Downloading…" : "Download"}
        </button>
        <a className={styles.link} href={url} target="_blank" rel="noreferrer">Open in new tab</a>
      </div>
      {downloadError && <p role="alert" className={styles.error}>{downloadError}</p>}
    </div>;
  }

  return <div className={styles.attachmentPreview}>
    {image ? (
      <button type="button" className={styles.attachmentThumb} onClick={() => setOpen(true)} aria-label={`View ${label}`}>
        <img src={url} alt="" />
      </button>
    ) : null}
    <div className={styles.attachmentActions}>
      <button type="button" className={styles.secondary} onClick={() => setOpen(true)}>View in app</button>
      <button type="button" className={styles.link} disabled={downloading} onClick={() => void downloadFile()}>
        {downloading ? "Downloading…" : "Download"}
      </button>
      <a className={styles.link} href={url} target="_blank" rel="noreferrer">Open in new tab</a>
    </div>
    {downloadError && <p role="alert" className={styles.error}>{downloadError}</p>}
    <dialog
      ref={dialog}
      className={styles.fileDialog}
      aria-label={label}
      onClose={() => setOpen(false)}
      onClick={event => { if (event.target === dialog.current) setOpen(false); }}
    >
      <div className={styles.fileDialogBody}>
        <div className={styles.fileDialogHead}>
          <button type="button" className={styles.requestBack} onClick={() => setOpen(false)}>Close</button>
          <a className={styles.link} href={url} target="_blank" rel="noreferrer">Open in new tab</a>
        </div>
        <h2 className={styles.fileDialogTitle}>{label}</h2>
        {image && <img className={styles.fileDialogImage} src={url} alt={label} />}
        {pdf && <iframe className={styles.fileDialogFrame} title={label} src={url} />}
        {text && (
          textFailed
            ? <p className={styles.muted}>Could not preview this text file. Download it instead.</p>
            : textBody == null
              ? <p className={styles.muted}>Loading preview…</p>
              : <pre className={styles.fileDialogText}>{textBody}</pre>
        )}
      </div>
    </dialog>
  </div>;
}

export function MyDay({ role = "student", userId, meetings, names, officeHours = [], lead }: { role?: string; userId: string; meetings: Meeting[]; names: (id: string) => string; officeHours?: { id: string; weekday: number; start_time: string; end_time: string; timezone: string }[]; lead?: ReactNode }) {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [title, setTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [due, setDue] = useState<MeetingTimeDraft>(EMPTY_MEETING_TIME);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [actions, setActions] = useState<{ requestId: string; id: string; text: string; due_on: string | null; done: boolean }[]>([]);
  const [day, setDay] = useState(() => startOfLocalDay());
  const [search, setSearch] = useState("");
  const [prepByRequest, setPrepByRequest] = useState<Record<string, boolean[]>>({});
  const doneKey = `campuspulse.todo.${userId}`;

  async function load() {
    if (!supabase) return;
    const requestIds = meetings.filter(item => ["accepted", "alternative"].includes(item.status)).map(item => item.id);
    const [deadlineResult, noticeResult, eventResult, minuteResult] = await Promise.all([
      supabase.from("personal_deadlines").select("id,title,due_at,done").order("due_at"),
      supabase.from("notices").select("id,title,body,audience,audience_value,due_at,expires_at,created_at").order("expires_at"),
      supabase.from("club_events").select("id,title,body,place,starts_at,ends_at,audience,audience_value,author_id,club_id").order("starts_at"),
      requestIds.length
        ? supabase.from("meeting_minutes").select("request_id,actions,status").in("request_id", requestIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (deadlineResult.error || noticeResult.error || eventResult.error) setError("Some of today’s items could not be loaded. Try again.");
    else setError("");
    setDeadlines((deadlineResult.data ?? []) as Deadline[]);
    setNotices((noticeResult.data ?? []) as NoticeRow[]);
    setEvents((eventResult.data ?? []) as EventRow[]);
    const nextActions: { requestId: string; id: string; text: string; due_on: string | null; done: boolean }[] = [];
    for (const row of (minuteResult.data ?? []) as { request_id: string; actions: unknown; status: string }[]) {
      if (row.status !== "ready" || !Array.isArray(row.actions)) continue;
      for (const item of row.actions as { id?: string; text?: string; due_on?: string | null; done?: boolean }[]) {
        if (!item?.id || !item.text) continue;
        nextActions.push({ requestId: row.request_id, id: item.id, text: item.text, due_on: item.due_on ?? null, done: item.done === true });
      }
    }
    setActions(nextActions);
    setReady(true);
  }
  const meetingKey = meetings.map(item => `${item.id}:${item.status}:${item.meeting_at}`).join("|");
  useEffect(() => { void load(); }, [userId, meetingKey]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(doneKey) || "[]");
      setChecked(Array.isArray(saved) ? saved.filter((item: unknown) => typeof item === "string") : []);
    } catch { setChecked([]); }
  }, [doneKey]);
  useEffect(() => {
    const next: Record<string, boolean[]> = {};
    for (const meeting of meetings) {
      if (meeting.status !== "accepted" || !meeting.meeting_at || !isSameLocalDay(meeting.meeting_at, day)) continue;
      next[meeting.id] = loadPrepChecked(userId, meeting.id);
    }
    setPrepByRequest(next);
  }, [userId, meetingKey, day, meetings]);

  const tasks = useMemo(() => {
    const viewingToday = isToday(day);
    const next: { key: string; id: string; kind: string; title: string; at: string; detail: string; done: boolean; requestId?: string }[] = [];
    meetings.forEach(meeting => {
      if (!meeting.meeting_at || !isSameLocalDay(meeting.meeting_at, day)) return;
      const other = meeting.student_id === userId ? meeting.faculty_id : meeting.student_id;
      if (meeting.status === "pending") next.push({ key: `wait-${meeting.id}`, id: meeting.id, kind: "Waiting", title: `Waiting on ${names(other)}`, at: meeting.meeting_at, detail: meeting.reason, done: false });
      else if (meeting.status === "alternative") next.push({ key: `meet-${meeting.id}`, id: meeting.id, kind: "Another time", title: `Meet ${names(other)}`, at: meeting.meeting_at, detail: meeting.reason, done: checked.includes(`meet-${meeting.id}`) });
      else if (["accepted", "expired"].includes(meeting.status)) next.push({ key: `meet-${meeting.id}`, id: meeting.id, kind: "Meeting", title: `Meet ${names(other)}`, at: meeting.meeting_at, detail: meeting.reason, done: checked.includes(`meet-${meeting.id}`) });
    });
    actions.forEach(item => {
      const at = item.due_on ? `${item.due_on}T09:00:00` : null;
      if (at ? !isSameLocalDay(at, day) : !viewingToday) return;
      next.push({ key: `action-${item.id}`, id: item.id, kind: "Action", title: item.text, at: at ?? day.toISOString(), detail: "From meeting minutes", done: item.done, requestId: item.requestId });
    });
    deadlines.filter(item => isSameLocalDay(item.due_at, day)).forEach(item => next.push({ key: `due-${item.id}`, id: item.id, kind: "Yours", title: item.title, at: item.due_at, detail: "Only you", done: item.done }));
    notices.filter(item => item.due_at && isSameLocalDay(item.due_at, day)).forEach(item => next.push({ key: `notice-${item.id}`, id: item.id, kind: "Notice", title: item.title, at: item.due_at!, detail: "Notice", done: checked.includes(`notice-${item.id}`) }));
    events.filter(item => isSameLocalDay(item.starts_at, day)).forEach(item => next.push({ key: `event-${item.id}`, id: item.id, kind: "Event", title: item.title, at: item.starts_at, detail: item.place || "Event", done: checked.includes(`event-${item.id}`) }));
    if (role === "faculty") officeHours.filter(hour => hour.weekday === day.getDay()).forEach(hour => {
      const [hours, minutes] = hour.start_time.split(":");
      const at = new Date(day);
      at.setHours(Number(hours), Number(minutes), 0, 0);
      next.push({ key: `hours-${hour.id}`, id: hour.id, kind: "Hours", title: "Office hours", at: at.toISOString(), detail: `${hour.start_time.slice(0, 5)}-${hour.end_time.slice(0, 5)}`, done: checked.includes(`hours-${hour.id}`) });
    });
    const queried = next.filter(item => matchesQuery(`${item.title} ${item.kind} ${item.detail}`, search));
    return queried.sort((a, b) => Number(a.done) - Number(b.done) || Date.parse(a.at) - Date.parse(b.at));
  }, [meetings, deadlines, notices, events, officeHours, checked, userId, names, role, actions, day, search]);

  const conflictKeys = useMemo(() => {
    const keys = new Set<string>();
    const dayMeetings = meetings.filter(item => item.meeting_at && isSameLocalDay(item.meeting_at, day));
    const dayEvents = events.filter(item => isSameLocalDay(item.starts_at, day));
    for (const meeting of dayMeetings) {
      for (const event of dayEvents) {
        if (!hourConflict(meeting.meeting_at!, event.starts_at, event.ends_at)) continue;
        keys.add(`meet-${meeting.id}`);
        keys.add(`event-${event.id}`);
      }
    }
    return keys;
  }, [meetings, events, day]);

  const acceptedToday = useMemo(
    () => meetings
      .filter(item => item.status === "accepted" && item.meeting_at && isSameLocalDay(item.meeting_at, day))
      .sort((a, b) => Date.parse(a.meeting_at!) - Date.parse(b.meeting_at!)),
    [meetings, day],
  );

  const meetingReminder = useMemo(() => {
    const horizon = Date.now() + 2 * 60 * 60 * 1000;
    return meetings
      .filter(item => item.status === "accepted" && item.meeting_at && Date.parse(item.meeting_at) >= Date.now() && Date.parse(item.meeting_at) <= horizon)
      .sort((a, b) => Date.parse(a.meeting_at!) - Date.parse(b.meeting_at!))[0] ?? null;
  }, [meetings]);

  function togglePrep(requestId: string, index: number) {
    setPrepByRequest(previous => {
      const current = previous[requestId] ?? PREP_ITEMS.map(() => false);
      const next = current.map((value, i) => (i === index ? !value : value));
      savePrepChecked(userId, requestId, next);
      return { ...previous, [requestId]: next };
    });
  }

  async function addDeadline(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (!due.iso) { setError(due.error || "Add a future date, for example tomorrow or next Monday."); return; }
    const clean = title.trim();
    if (clean.length < 1) { setError("Add a short private note."); return; }
    if (editingId) {
      const removed = await supabase.rpc("remove_personal_deadline", { p_id: editingId });
      if (removed.error) { setError(removed.error.message); return; }
    }
    const saved = await supabase.rpc("add_personal_deadline", { p_title: clean, p_due: due.iso });
    if (saved.error) { setError(saved.error.message); return; }
    setTitle(""); setDue(EMPTY_MEETING_TIME); setEditingId(null); setError(""); await load();
  }
  function beginEditDeadline(item: Deadline) {
    setEditingId(item.id);
    setTitle(item.title);
    const label = stamp(item.due_at);
    setDue({ text: label, iso: item.due_at, preview: label, error: "", dateOnly: false });
    setError("");
  }
  function cancelEditDeadline() {
    setEditingId(null);
    setTitle("");
    setDue(EMPTY_MEETING_TIME);
    setError("");
  }
  async function changeDeadline(id: string, done: boolean) {
    if (!supabase) return;
    const previous = deadlines;
    setDeadlines(list => list.map(item => item.id === id ? { ...item, done } : item));
    setError("");
    const saved = await supabase.rpc("set_personal_deadline_done", { p_id: id, p_done: done });
    if (saved.error) { setDeadlines(previous); setError(saved.error.message); }
  }
  function toggleLocal(key: string) {
    setChecked(previous => {
      const next = previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key];
      try { localStorage.setItem(doneKey, JSON.stringify(next)); } catch { /* the tick simply is not remembered */ }
      return next;
    });
  }
  async function toggleAction(requestId: string, actionId: string, done: boolean) {
    if (!supabase) return;
    const previous = actions;
    setActions(list => list.map(item => item.id === actionId ? { ...item, done } : item));
    setError("");
    const saved = await supabase.rpc("set_minute_action_done", { p_request: requestId, p_action: actionId, p_done: done });
    if (saved.error) { setActions(previous); setError(saved.error.message); }
  }
  async function removeDeadline(id: string) {
    if (!supabase) return;
    const previous = deadlines;
    setDeadlines(list => list.filter(item => item.id !== id));
    setError("");
    const saved = await supabase.rpc("remove_personal_deadline", { p_id: id });
    if (saved.error) { setDeadlines(previous); setError(saved.error.message); }
  }
  function markItem(item: { key: string; id: string; kind: string; requestId?: string }, done: boolean) {
    if (item.kind === "Yours") void changeDeadline(item.id, done);
    else if (item.kind === "Action" && item.requestId) void toggleAction(item.requestId, item.id, done);
    else toggleLocal(item.key);
  }
  const open = tasks.filter(item => !item.done);
  const done = tasks.filter(item => item.done);
  const viewingToday = isToday(day);
  const isPastDay = day.getTime() < startOfLocalDay().getTime();
  const dayTitle = viewingToday ? "Today." : `${formatDayLabel(day)}.`;
  const renderTaskRow = (item: typeof tasks[number], done: boolean) => (
    <li key={item.key} className={styles.todoRow}>
      <label className={styles.todoCheck}>
        <input type="checkbox" checked={done} disabled={!done && item.kind === "Waiting"} onChange={() => markItem(item, !done)} />
        <span>
          <strong>{item.title}</strong>
          <small>{item.kind} · {stamp(item.at)} · {item.detail}</small>
          {conflictKeys.has(item.key) && <small className={styles.muted}>Within an hour of another item today.</small>}
        </span>
      </label>
      {item.kind === "Yours" && !isPastDay && !done && <div className={styles.inlineCluster}>
        <button type="button" className={styles.link} onClick={() => {
          const row = deadlines.find(deadline => deadline.id === item.id);
          if (row) beginEditDeadline(row);
        }}>Edit</button>
        <button type="button" className={styles.todoRemove} aria-label={`Remove ${item.title}`} onClick={() => void removeDeadline(item.id)}>Remove</button>
      </div>}
    </li>
  );
  const reminderName = meetingReminder
    ? names(meetingReminder.student_id === userId ? meetingReminder.faculty_id : meetingReminder.student_id)
    : "";
  return <><div className={styles.pageHead}><div><h1>{dayTitle}</h1><p>{isPastDay ? "Tasks from this day." : "What needs you next."}</p></div><p className={styles.resultCount}>{ready ? `${open.length} open` : ""}</p></div>
    {lead}
    {meetingReminder && viewingToday && <section className={styles.card} role="status"><div className={styles.requestTop}><div className={styles.inlineCluster}><span className={`${styles.badge} ${styles.busy}`}>Soon</span><span>Meeting with {reminderName} in {minutesUntil(meetingReminder.meeting_at!)} minutes</span></div></div></section>}
    {acceptedToday.length > 0 && <section className={styles.card}>
      <h2>Meeting prep</h2>
      <p className={styles.muted}>For accepted meetings today.</p>
      {acceptedToday.map(meeting => {
        const other = names(meeting.student_id === userId ? meeting.faculty_id : meeting.student_id);
        const prep = prepByRequest[meeting.id] ?? PREP_ITEMS.map(() => false);
        return <div key={meeting.id} className={styles.minutes}>
          <div className={styles.requestTop}>
            <p className={styles.minutesHead}><strong>{other}</strong><span className={styles.muted}>{stamp(meeting.meeting_at!)}</span></p>
            <button type="button" className={styles.secondary} onClick={() => downloadMeetingIcs(meeting, other)}>Add to calendar</button>
          </div>
          <ul className={styles.todoList}>{PREP_ITEMS.map((label, index) => <li key={label} className={styles.todoRow}><label className={styles.todoCheck}><input type="checkbox" checked={prep[index]} onChange={() => togglePrep(meeting.id, index)} /> <span>{label}</span></label></li>)}</ul>
        </div>;
      })}
    </section>}
    <SectionTools search={search} onSearch={setSearch} searchPlaceholder="Search this day" day={day} onDayChange={setDay} />
    <section className={styles.card}>
      {!ready ? <p>Loading…</p> : open.length === 0 ? (
        <div>
          <p>{search.trim() ? "No matches on this day." : viewingToday ? "Clear day so far." : "Nothing on this day yet."}</p>
          {!search.trim() && !isPastDay && <p className={styles.muted}>Add a private note below, or check another day. Meetings and campus notices appear here when they land on this date.</p>}
        </div>
      ) : <ul className={styles.todoList}>{open.map(item => renderTaskRow(item, false))}</ul>}
      {done.length > 0 && <details className={styles.todoDone}><summary>Done · {done.length}</summary><ul className={styles.todoList}>{done.map(item => renderTaskRow(item, true))}</ul></details>}
      {!isPastDay && <form className={styles.todoAdd} onSubmit={event => void addDeadline(event)}>
        <label className={styles.todoField}>{editingId ? "Edit private note" : "Private note"}<input value={title} maxLength={160} required onChange={event => setTitle(event.target.value)} /></label>
        <NaturalTimeInput label="When" value={due} onChange={setDue} required allowDateOnly />
        <button className={`${styles.secondary} ${styles.todoAddButton}`} type="submit">{editingId ? "Save" : "Add"}</button>
        {editingId && <button type="button" className={styles.link} onClick={cancelEditDeadline}>Cancel edit</button>}
      </form>}
    </section>
    {error && <p role="alert" className={styles.error}>{error}</p>}</>;
}

export function CampusNotices({ isAdmin, userId, people = [], departments, homeDepartment = "" }: {
  isAdmin: boolean; userId: string; people?: Person[]; departments: string[]; homeDepartment?: string;
}) {
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [posters, setPosters] = useState<string[]>([]);
  const [poster, setPoster] = useState("");
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [audience, setAudience] = useState("institution"); const [value, setValue] = useState("student");
  const [due, setDue] = useState(""); const [expires, setExpires] = useState("");
  const [attachments, setAttachments] = useState<CampusFileDraft[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"active" | "action" | "expired">("active");
  const [board, setBoard] = useState<"department" | "all">(() => homeDepartment ? "department" : "all");
  const canPublish = isAdmin || posters.includes(userId);
  async function load() {
    if (!supabase) return;
    const [noticeResult, posterResult] = await Promise.all([
      supabase.from("notices").select("id,title,body,audience,audience_value,due_at,expires_at,created_at,attachment_path,attachment_name,attachment_mime,notice_attachments(id,path,name,mime,sort_order)").order("created_at", { ascending: false }),
      supabase.from("notice_posters").select("profile_id"),
    ]);
    if (noticeResult.error) setError("Notices could not be loaded.");
    else { setError(""); setRows((noticeResult.data ?? []) as NoticeRow[]); }
    setPosters(((posterResult.data ?? []) as { profile_id: string }[]).map(item => item.profile_id));
    setReady(true);
  }
  useEffect(() => { void load(); }, [userId]);
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!supabase || publishing) return;
    if (audience === "department" && !audienceDepartments(value).length) {
      setError("Choose at least one department.");
      return;
    }
    setPublishing(true);
    setError("");
    setMessage("");
    const uploaded: CampusFileDraft[] = [];
    try {
      const paths: string[] = [];
      const names: string[] = [];
      for (const draft of attachments) {
        paths.push(await uploadCampusFile(supabase, userId, draft));
        names.push(draft.name);
        uploaded.push(draft);
      }
      const saved = await supabase.rpc("publish_notice", {
        p_title: title, p_body: body, p_audience: audience, p_audience_value: audience === "institution" ? "" : value,
        p_due: due ? new Date(due).toISOString() : null, p_expires: new Date(expires).toISOString(),
        p_attachment_paths: paths, p_attachment_names: names,
      });
      if (saved.error) {
        for (const draft of uploaded) void discardCampusFile(supabase, userId, draft);
        setError(saved.error.message);
        return;
      }
      setTitle(""); setBody(""); setDue(""); setExpires(""); setAttachments([]);
      setComposing(false);
      setMessage("Notice published. Matching people are notified in Updates.");
      await load();
    } catch (publishError) {
      for (const draft of uploaded) void discardCampusFile(supabase, userId, draft);
      setError(publishError instanceof Error ? publishError.message : "Could not publish this notice.");
    } finally {
      setPublishing(false);
    }
  }
  function closeComposer() {
    if (publishing) return;
    setComposing(false);
    setError("");
  }
  const now = Date.now();
  const visible = rows.filter(row => {
    const expired = Date.parse(row.expires_at) <= now;
    if (scope === "active" && expired) return false;
    if (scope === "action" && (expired || !row.due_at)) return false;
    if (scope === "expired" && !expired) return false;
    if (board === "department" && homeDepartment) {
      const forDept = row.audience === "department" && audienceIncludesDepartment(row.audience_value, homeDepartment);
      const campusWide = row.audience === "institution";
      if (!forDept && !campusWide) return false;
      // Prefer dept board: when filtering department, still show campus-wide but rank later via sort
    }
    return matchesQuery(`${row.title} ${row.body} ${audienceLabel(row.audience, row.audience_value)}`, search);
  }).sort((a, b) => {
    if (board !== "department" || !homeDepartment) return Date.parse(b.created_at) - Date.parse(a.created_at);
    const score = (row: NoticeRow) => row.audience === "department" && audienceIncludesDepartment(row.audience_value, homeDepartment) ? 1 : 0;
    return score(b) - score(a) || Date.parse(b.created_at) - Date.parse(a.created_at);
  });
  const boardLine = homeDepartment
    ? `Your ${homeDepartment} board first, then campus-wide.`
    : "Notes from your college.";
  return <><div className={styles.pageHead}>
      <div>
        <h1>Notices.</h1>
        <p>{boardLine}</p>
      </div>
    </div>
    {(!!homeDepartment || canPublish) && (
      <div className={styles.boardBar}>
        {!!homeDepartment ? (
          <div className={styles.filters} role="group" aria-label="Notice board">
            <button type="button" aria-pressed={board === "department"} onClick={() => setBoard("department")}>{homeDepartment}</button>
            <button type="button" aria-pressed={board === "all"} onClick={() => setBoard("all")}>All campus</button>
          </div>
        ) : <div />}
        {canPublish && (
          <button
            type="button"
            className={composing ? styles.secondary : styles.primary}
            disabled={publishing}
            onClick={() => {
              if (composing) closeComposer();
              else { setComposing(true); setMessage(""); setError(""); }
            }}
          >{composing ? "Close" : "Publish a notice"}</button>
        )}
      </div>
    )}
    {canPublish && composing && <form className={`${styles.card} ${styles.publishForm}`} onSubmit={event => void publish(event)}>
      <h2>Publish a notice</h2>
      <p className={styles.muted}>For the college, selected departments, or a role. It leaves when it expires.</p>
      <label>Title<input required maxLength={120} value={title} disabled={publishing} onChange={event => setTitle(event.target.value)} /></label>
      <label>Notice<textarea required maxLength={2000} value={body} disabled={publishing} onChange={event => setBody(event.target.value)} /></label>
      <AudienceFields audience={audience} value={value} departments={departments} disabled={publishing} onAudience={next => { setAudience(next); setValue(next === "role" ? "student" : ""); }} onValue={setValue} />
      <div className={styles.publishPair}>
        <label>Due date, if this notice has one<input type="datetime-local" value={due} disabled={publishing} onChange={event => setDue(event.target.value)} /></label>
        <label>Expires<input type="datetime-local" required value={expires} disabled={publishing} onChange={event => setExpires(event.target.value)} /></label>
      </div>
      <AttachmentPick kind="notice" drafts={attachments} disabled={publishing} onChange={setAttachments} onError={setError} />
      <p className={styles.muted}>Only the chosen people see it.</p>
      <div className={styles.publishActions}>
        <button className={styles.primary} type="submit" disabled={publishing}>{publishing ? "Publishing…" : "Publish notice"}</button>
        <button type="button" className={styles.link} disabled={publishing} onClick={closeComposer}>Cancel</button>
      </div>
    </form>}
    <SectionTools search={search} onSearch={setSearch} searchPlaceholder="Search notices" chips={[{ id: "active", label: "Active" }, { id: "action", label: "Needs action" }, { id: "expired", label: "Expired" }]} chip={scope} onChip={id => setScope(id as "active" | "action" | "expired")} />
    {ready && visible.length === 0 && <div className={styles.card}><h2>{search.trim() ? "No matching notices" : "No notices right now"}</h2></div>}
    {visible.map(row => {
      const files = noticeFiles(row);
      return <article className={styles.requestCard} key={row.id}><div className={styles.requestTop}><div><h2>{row.title}</h2><span className={styles.muted}>{audienceLabel(row.audience, row.audience_value)} · expires {stamp(row.expires_at)}</span></div></div><p>{row.body}</p>{row.due_at && <p><strong>Due:</strong> {stamp(row.due_at)}</p>}{files.map(file => <AttachmentView key={file.id || file.path} path={file.path} name={file.name} mime={file.mime} />)}</article>;
    })}
    {isAdmin && <form className={styles.card} onSubmit={event => {
      event.preventDefault();
      if (!poster) { setError("Choose a person to authorize."); return; }
      void supabase?.rpc("grant_notice_poster", { p_user: poster }).then(result => {
        if (result.error) setError(result.error.message);
        else { setMessage("That person can now publish notices."); setError(""); setPoster(""); void load(); }
      });
    }}>
      <h2>Authorize notice publishers</h2>
      <p className={styles.muted}>Admins can assign multiple people. Search by name or email.</p>
      <PersonPicker people={people} value={poster} onChange={setPoster} required label="Person" />
      <button className={styles.secondary} type="submit">Allow notice posts</button>
      {posters.map(id => {
        const person = people.find(item => item.id === id);
        return <div className={styles.hourRow} key={id}>
          <span>{person?.name ?? "Campus member"}{person?.email ? ` · ${person.email}` : ""}</span>
          <button type="button" onClick={() => void supabase?.rpc("revoke_notice_poster", { p_user: id }).then(() => load())}>Remove</button>
        </div>;
      })}
    </form>}
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}</>;
}

type ClubPoster = { profile_id: string; club_id: string };

export function ClubEvents({ role = "student", isAdmin, userId, people, departments }: { role?: string; isAdmin: boolean; userId: string; people: Person[]; departments: string[] }) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [follows, setFollows] = useState<string[]>([]);
  const [posters, setPosters] = useState<ClubPoster[]>([]);
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [place, setPlace] = useState(""); const [clubName, setClubName] = useState("");
  const [starts, setStarts] = useState(""); const [ends, setEnds] = useState("");
  const [audience, setAudience] = useState("institution"); const [value, setValue] = useState("student");
  const [poster, setPoster] = useState("");
  const [posterClub, setPosterClub] = useState("");
  const [attachments, setAttachments] = useState<CampusFileDraft[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [day, setDay] = useState(() => startOfLocalDay());
  const [scope, setScope] = useState<"upcoming" | "day" | "all">("upcoming");
  const [clubId, setClubId] = useState<string | null>(null);
  const myClubs = posters.filter(item => item.profile_id === userId).map(item => item.club_id);
  const canPost = isAdmin || myClubs.length > 0;
  const focusedClub = clubs.find(club => club.id === clubId) ?? null;
  const eventsByClub = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (!row.club_id) continue;
      counts[row.club_id] = (counts[row.club_id] ?? 0) + 1;
    }
    return counts;
  }, [rows]);
  const clubHits = useMemo(() => {
    if (clubId || !search.trim()) return [];
    return clubs
      .filter(club => matchesQuery(club.name, search))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 12);
  }, [clubs, search, clubId]);
  function openClub(id: string) {
    setClubId(id);
    setSearch("");
    setScope("all");
  }
  function clearClub() {
    setClubId(null);
    setScope("upcoming");
  }
  async function load() {
    if (!supabase) return;
    const [eventResult, posterResult, clubResult, followResult] = await Promise.all([
      supabase.from("club_events").select("id,title,body,place,starts_at,ends_at,audience,audience_value,author_id,club_id,attachment_path,attachment_name,attachment_mime").order("starts_at"),
      supabase.from("club_posters").select("profile_id,club_id"),
      supabase.from("clubs").select("id,name").order("name"),
      supabase.from("club_follows").select("club_id"),
    ]);
    if (eventResult.error || posterResult.error || clubResult.error || followResult.error) setError("Club events could not be loaded.");
    else setError("");
    setRows((eventResult.data ?? []) as EventRow[]);
    setClubs((clubResult.data ?? []) as ClubRow[]);
    setFollows(((followResult.data ?? []) as { club_id: string }[]).map(item => item.club_id));
    setPosters((posterResult.data ?? []) as ClubPoster[]);
  }
  useEffect(() => { void load(); }, [userId]);
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!supabase || publishing) return;
    if (audience === "department" && !audienceDepartments(value).length) {
      setError("Choose at least one department.");
      return;
    }
    setPublishing(true);
    setError("");
    setMessage("");
    const uploaded = attachments[0] ?? null;
    try {
      let path: string | null = null;
      if (uploaded) path = await uploadCampusFile(supabase, userId, uploaded);
      const saved = await supabase.rpc("publish_club_event", {
        p_title: title, p_body: body, p_place: place, p_starts: new Date(starts).toISOString(), p_ends: ends ? new Date(ends).toISOString() : null,
        p_audience: audience, p_audience_value: audience === "institution" ? "" : value, p_club_name: clubName.trim(),
        p_attachment_path: path, p_attachment_name: uploaded?.name ?? null,
      });
      if (saved.error) {
        if (uploaded) void discardCampusFile(supabase, userId, uploaded);
        setError(saved.error.message);
        return;
      }
      setTitle(""); setBody(""); setPlace(""); setClubName(""); setStarts(""); setEnds(""); setAttachments([]);
      setComposing(false);
      setMessage("Event posted. People who follow this club are notified.");
      await load();
    } catch (publishError) {
      if (uploaded) void discardCampusFile(supabase, userId, uploaded);
      setError(publishError instanceof Error ? publishError.message : "Could not post this event.");
    } finally {
      setPublishing(false);
    }
  }
  function closeComposer() {
    if (publishing) return;
    setComposing(false);
    setError("");
  }
  async function toggleFollow(clubId: string) {
    if (!supabase) return;
    const wasFollowing = follows.includes(clubId);
    const saved = await supabase.rpc(wasFollowing ? "unfollow_club" : "follow_club", { p_club: clubId });
    if (saved.error) { setError(saved.error.message); return; }
    setError("");
    setMessage(wasFollowing ? "Unfollowed. You will not get new alerts for this club." : "Following. You get a phone alert when this club posts an event for your audience.");
    await load();
  }
  const eventLine = isAdmin
    ? "Search events or clubs. Open a club to see its events. Assign people to post for a specific club."
    : role === "faculty"
      ? "Search events or clubs. Open a club to see its events. Post only for clubs you are assigned."
      : "Search events or clubs. Open a club to see all of its events.";
  const visible = rows
    .filter(row => {
      if (clubId) return row.club_id === clubId;
      if (scope === "upcoming" && Date.parse(row.starts_at) < startOfLocalDay().getTime()) return false;
      if (scope === "day" && !isSameLocalDay(row.starts_at, day)) return false;
      const club = clubs.find(item => item.id === row.club_id)?.name ?? "";
      return matchesQuery(`${row.title} ${row.body} ${row.place} ${club}`, search);
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const postableClubs = isAdmin ? clubs : clubs.filter(club => myClubs.includes(club.id));
  return <><div className={styles.pageHead}>
      <div>
        <h1>{focusedClub ? focusedClub.name : "Events."}</h1>
        <p>{focusedClub ? `${visible.length} ${visible.length === 1 ? "event" : "events"} for this club.` : eventLine}</p>
      </div>
      {focusedClub && <button type="button" className={styles.secondary} onClick={clearClub}>All events</button>}
    </div>
    {(!focusedClub || canPost) && (
      <div className={styles.boardBar}>
        {!focusedClub ? (
          <div className={styles.filters} role="group" aria-label="Event filter">
            <button type="button" aria-pressed={scope === "upcoming"} onClick={() => setScope("upcoming")}>Upcoming</button>
            <button type="button" aria-pressed={scope === "day"} onClick={() => setScope("day")}>This day</button>
            <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>All</button>
          </div>
        ) : <div />}
        {canPost && (
          <button
            type="button"
            className={composing ? styles.secondary : styles.primary}
            disabled={publishing}
            onClick={() => {
              if (composing) closeComposer();
              else { setComposing(true); setMessage(""); setError(""); }
            }}
          >{composing ? "Close" : "Post an event"}</button>
        )}
      </div>
    )}
    {canPost && composing && <form className={`${styles.card} ${styles.publishForm}`} onSubmit={event => void publish(event)}>
      <h2>Post a club event</h2>
      <p className={styles.muted}>Only the chosen audience can see this event. Followers in that audience get a phone alert.</p>
      {isAdmin ? <label>Club<input required maxLength={80} value={clubName} disabled={publishing} onChange={event => setClubName(event.target.value)} placeholder="Club name" /></label>
        : <label>Club<select required value={clubName} disabled={publishing} onChange={event => setClubName(event.target.value)}>
          <option value="">Choose your club</option>
          {postableClubs.map(club => <option key={club.id} value={club.name}>{club.name}</option>)}
        </select></label>}
      <label>Title<input required maxLength={120} value={title} disabled={publishing} onChange={event => setTitle(event.target.value)} /></label>
      <label>Details<textarea required maxLength={2000} value={body} disabled={publishing} onChange={event => setBody(event.target.value)} /></label>
      <label>Place<input maxLength={160} value={place} disabled={publishing} onChange={event => setPlace(event.target.value)} /></label>
      <AudienceFields audience={audience} value={value} departments={departments} disabled={publishing} onAudience={next => { setAudience(next); setValue(next === "role" ? "student" : ""); }} onValue={setValue} />
      <div className={styles.publishPair}>
        <label>Starts<input type="datetime-local" required value={starts} disabled={publishing} onChange={event => setStarts(event.target.value)} /></label>
        <label>Ends<input type="datetime-local" value={ends} disabled={publishing} onChange={event => setEnds(event.target.value)} /></label>
      </div>
      <AttachmentPick kind="event" drafts={attachments} disabled={publishing} onChange={setAttachments} onError={setError} />
      <div className={styles.publishActions}>
        <button className={styles.primary} type="submit" disabled={publishing}>{publishing ? "Posting…" : "Post event"}</button>
        <button type="button" className={styles.link} disabled={publishing} onClick={closeComposer}>Cancel</button>
      </div>
    </form>}
    {!focusedClub && <SectionTools search={search} onSearch={setSearch} searchPlaceholder="Search events or clubs" day={scope === "day" ? day : undefined} onDayChange={scope === "day" ? setDay : undefined} />}
    {focusedClub && (
      <div className={styles.eventClubBar}>
        <div className={styles.eventActions}>
          <button type="button" className={styles.secondary} onClick={() => void toggleFollow(focusedClub.id)}>{follows.includes(focusedClub.id) ? "Following" : "Follow club"}</button>
        </div>
        <p className={styles.muted}>Follow for phone alerts. You still only see events meant for your role.</p>
      </div>
    )}
    {clubHits.length > 0 && (
      <section className={styles.card}>
        <h2>Clubs</h2>
        <p className={styles.muted}>Open a club to see all of its events.</p>
        <ul className={styles.clubHitList}>
          {clubHits.map(club => {
            const count = eventsByClub[club.id] ?? 0;
            return <li key={club.id}>
              <button type="button" className={styles.clubHitButton} onClick={() => openClub(club.id)}>
                <strong>{club.name}</strong>
                <span className={styles.muted}>{count} {count === 1 ? "event" : "events"}</span>
              </button>
              <button type="button" className={styles.secondary} onClick={() => void toggleFollow(club.id)}>{follows.includes(club.id) ? "Following" : "Follow"}</button>
            </li>;
          })}
        </ul>
      </section>
    )}
    {visible.length === 0 && <div className={styles.card}><h2>{focusedClub ? "No events for this club yet." : search.trim() ? "No matching events." : "No events right now."}</h2>{!focusedClub && search.trim() && !clubHits.length && <p className={styles.muted}>No clubs matched that search either.</p>}</div>}
    {visible.map(row => {
      const club = clubs.find(item => item.id === row.club_id);
      return <article className={styles.requestCard} key={row.id}>
        <div className={styles.requestTop}>
          <div>
            <h2>{row.title}</h2>
            <span className={styles.muted}>
              {club && !focusedClub ? <>
                <button type="button" className={styles.link} onClick={() => openClub(club.id)}>{club.name}</button>
                {" · "}
              </> : null}
              {stamp(row.starts_at)}{row.ends_at ? ` - ${stamp(row.ends_at)}` : ""} · {audienceLabel(row.audience, row.audience_value)}
            </span>
          </div>
          <div className={styles.eventActions}>
            {row.club_id && !focusedClub && <button type="button" className={styles.secondary} onClick={() => openClub(row.club_id!)}>View club</button>}
            {row.club_id && <button type="button" className={styles.secondary} onClick={() => void toggleFollow(row.club_id!)}>{follows.includes(row.club_id) ? "Following" : "Follow"}</button>}
            <button type="button" className={styles.secondary} onClick={() => downloadEventIcs(row, club?.name)}>Add to calendar</button>
          </div>
        </div>
        {row.place && <p><strong>Place:</strong> {row.place}</p>}
        <p>{row.body}</p>
        {row.attachment_path && <AttachmentView path={row.attachment_path} name={row.attachment_name} mime={row.attachment_mime} />}
      </article>;
    })}
    {isAdmin && <form className={styles.card} onSubmit={event => {
      event.preventDefault();
      if (!poster || !posterClub) { setError("Choose a person and a club."); return; }
      void supabase?.rpc("grant_club_poster", { p_user: poster, p_club: posterClub }).then(result => {
        if (result.error) setError(result.error.message);
        else { setMessage("That person can now post events for the selected club."); setError(""); setPoster(""); setPosterClub(""); void load(); }
      });
    }}>
      <h2>Authorize a club poster</h2>
      <p className={styles.muted}>They may post events only for that club. Search by name or email.</p>
      <PersonPicker people={people} value={poster} onChange={setPoster} required label="Person" />
      <label>Club<select required value={posterClub} onChange={event => setPosterClub(event.target.value)}>
        <option value="">Choose a club</option>
        {clubs.map(club => <option key={club.id} value={club.id}>{club.name}</option>)}
      </select></label>
      {!clubs.length && <p className={styles.muted}>Create a club by posting an event once, then assign posters here.</p>}
      <button className={styles.secondary} type="submit" disabled={!clubs.length}>Allow club posts</button>
      {posters.map(item => {
        const person = people.find(entry => entry.id === item.profile_id);
        const club = clubs.find(entry => entry.id === item.club_id);
        return <div className={styles.hourRow} key={`${item.profile_id}-${item.club_id}`}>
          <span>{person?.name ?? "Campus member"}{person?.email ? ` · ${person.email}` : ""} · {club?.name ?? "Club"}</span>
          <button type="button" onClick={() => void supabase?.rpc("revoke_club_poster", { p_user: item.profile_id, p_club: item.club_id }).then(() => load())}>Remove</button>
        </div>;
      })}
    </form>}
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}</>;
}
