"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "../../lib/supabase-client";
import { EMPTY_MEETING_TIME, type MeetingTimeDraft } from "../../lib/natural-meeting-time";
import { formatDayLabel, isSameLocalDay, isToday, matchesQuery, startOfLocalDay } from "../../lib/section-browse";
import { NaturalTimeInput } from "./natural-time-input";
import { SectionTools } from "./section-tools";
import styles from "./software.module.css";

type Person = { id: string; name: string; role: string; department: string; active: boolean };
type Deadline = { id: string; title: string; due_at: string; done: boolean };
type NoticeRow = { id: string; title: string; body: string; audience: string; audience_value: string; due_at: string | null; expires_at: string; created_at: string };
type EventRow = { id: string; title: string; body: string; place: string; starts_at: string; ends_at: string | null; audience: string; audience_value: string; author_id: string; club_id: string | null };
type ClubRow = { id: string; name: string };
type Meeting = { id: string; student_id: string; faculty_id: string; meeting_at: string | null; status: string; reason: string };

const stamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const audienceLabel = (audience: string, value: string) => audience === "institution" ? "Whole college" : audience === "department" ? value : value === "student" ? "Students" : value === "faculty" ? "Faculty" : "Administrators";

function AudienceFields({ audience, value, departments, onAudience, onValue }: {
  audience: string; value: string; departments: string[]; onAudience: (value: string) => void; onValue: (value: string) => void;
}) {
  return <div className={styles.hoursFields}>
    <label>Who should see this<select value={audience} onChange={event => onAudience(event.target.value)}><option value="institution">Whole college</option><option value="department">One department</option><option value="role">One role</option></select></label>
    {audience === "department" && <label>Department<select value={value} onChange={event => onValue(event.target.value)} required><option value="">Choose a department</option>{departments.map(item => <option key={item}>{item}</option>)}</select></label>}
    {audience === "role" && <label>Role<select value={value} onChange={event => onValue(event.target.value)}><option value="student">Students</option><option value="faculty">Faculty</option><option value="admin">Administrators</option></select></label>}
  </div>;
}

export function MyDay({ role = "student", userId, meetings, names, officeHours = [], lead }: { role?: string; userId: string; meetings: Meeting[]; names: (id: string) => string; officeHours?: { id: string; weekday: number; start_time: string; end_time: string; timezone: string }[]; lead?: ReactNode }) {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<MeetingTimeDraft>(EMPTY_MEETING_TIME);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [actions, setActions] = useState<{ requestId: string; id: string; text: string; due_on: string | null; done: boolean }[]>([]);
  const [day, setDay] = useState(() => startOfLocalDay());
  const [search, setSearch] = useState("");
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
      next.push({ key: `hours-${hour.id}`, id: hour.id, kind: "Hours", title: "Office hours", at: at.toISOString(), detail: `${hour.start_time.slice(0, 5)}–${hour.end_time.slice(0, 5)}`, done: checked.includes(`hours-${hour.id}`) });
    });
    const queried = next.filter(item => matchesQuery(`${item.title} ${item.kind} ${item.detail}`, search));
    return queried.sort((a, b) => Number(a.done) - Number(b.done) || Date.parse(a.at) - Date.parse(b.at));
  }, [meetings, deadlines, notices, events, officeHours, checked, userId, names, role, actions, day, search]);

  const upcoming = useMemo(() => {
    const soon = Date.now() + 3 * 60 * 60 * 1000;
    return meetings
      .filter(item => ["accepted", "alternative"].includes(item.status) && item.meeting_at && Date.parse(item.meeting_at) >= Date.now() && Date.parse(item.meeting_at) <= soon)
      .sort((a, b) => Date.parse(a.meeting_at!) - Date.parse(b.meeting_at!))[0] ?? null;
  }, [meetings]);

  async function addDeadline(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (!due.iso) { setError(due.error || "Add a future date, for example tomorrow or next Monday."); return; }
    const saved = await supabase.rpc("add_personal_deadline", { p_title: title, p_due: due.iso });
    if (saved.error) { setError(saved.error.message); return; }
    setTitle(""); setDue(EMPTY_MEETING_TIME); setError(""); await load();
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
  return <><div className={styles.pageHead}><div><h1>{dayTitle}</h1><p>{isPastDay ? "Tasks from this day." : "What needs you next."}</p></div><p className={styles.resultCount}>{ready ? `${open.length} open` : ""}</p></div>
    {lead}
    {upcoming && viewingToday && <p className={styles.upcoming} role="status">Next · {stamp(upcoming.meeting_at!)} · {names(upcoming.student_id === userId ? upcoming.faculty_id : upcoming.student_id)}</p>}
    <SectionTools search={search} onSearch={setSearch} searchPlaceholder="Search this day" day={day} onDayChange={setDay} />
    <section className={styles.card}>
      {!ready ? <p>Loading…</p> : open.length === 0 ? <p>{search.trim() ? "No matches on this day." : "Nothing for this day."}</p> : <ul className={styles.todoList}>{open.map(item => <li key={item.key} className={styles.todoRow}><label className={styles.todoCheck}><input type="checkbox" checked={false} disabled={item.kind === "Waiting"} onChange={() => markItem(item, true)} /> <span><strong>{item.title}</strong><small>{item.kind} · {stamp(item.at)} · {item.detail}</small></span></label>{item.kind === "Yours" && !isPastDay && <button type="button" className={styles.todoRemove} aria-label={`Remove ${item.title}`} onClick={() => void removeDeadline(item.id)}>Remove</button>}</li>)}</ul>}
      {done.length > 0 && <details className={styles.todoDone}><summary>Done · {done.length}</summary><ul className={styles.todoList}>{done.map(item => <li key={item.key} className={styles.todoRow}><label className={styles.todoCheck}><input type="checkbox" checked onChange={() => markItem(item, false)} /> <span><strong>{item.title}</strong><small>{item.kind} · {stamp(item.at)}</small></span></label></li>)}</ul></details>}
      {!isPastDay && <form className={styles.todoAdd} onSubmit={event => void addDeadline(event)}>
        <label className={styles.todoField}>Private note<input value={title} maxLength={160} required onChange={event => setTitle(event.target.value)} /></label>
        <NaturalTimeInput label="When" value={due} onChange={setDue} required allowDateOnly />
        <button className={`${styles.secondary} ${styles.todoAddButton}`} type="submit">Add</button>
      </form>}
    </section>
    {error && <p role="alert" className={styles.error}>{error}</p>}</>;
}

export function CampusNotices({ isAdmin, departments }: { isAdmin: boolean; departments: string[] }) {
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [audience, setAudience] = useState("institution"); const [value, setValue] = useState("student");
  const [due, setDue] = useState(""); const [expires, setExpires] = useState("");
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"active" | "expired" | "all">("active");
  async function load() {
    if (!supabase) return;
    const result = await supabase.from("notices").select("id,title,body,audience,audience_value,due_at,expires_at,created_at").order("created_at", { ascending: false });
    if (result.error) setError("Notices could not be loaded.");
    else { setError(""); setRows((result.data ?? []) as NoticeRow[]); }
    setReady(true);
  }
  useEffect(() => { void load(); }, []);
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const saved = await supabase.rpc("publish_notice", {
      p_title: title, p_body: body, p_audience: audience, p_audience_value: audience === "institution" ? "" : value,
      p_due: due ? new Date(due).toISOString() : null, p_expires: new Date(expires).toISOString(),
    });
    if (saved.error) { setError(saved.error.message); setMessage(""); return; }
    setTitle(""); setBody(""); setDue(""); setExpires(""); setMessage("Notice published. Matching people are notified in Updates."); setError(""); await load();
  }
  const now = Date.now();
  const visible = rows.filter(row => {
    const expired = Date.parse(row.expires_at) <= now;
    if (scope === "active" && expired) return false;
    if (scope === "expired" && !expired) return false;
    return matchesQuery(`${row.title} ${row.body} ${audienceLabel(row.audience, row.audience_value)}`, search);
  });
  return <><div className={styles.pageHead}><div><h1>{isAdmin ? "Publish a notice." : "Notices."}</h1><p>{isAdmin ? "For the college, a department, or a role. It leaves when it expires." : "Notes from your college."}</p></div></div>
    {isAdmin && <form className={styles.card} onSubmit={event => void publish(event)}><h2>Publish a notice</h2><label>Title<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label><label>Notice<textarea required maxLength={2000} value={body} onChange={event => setBody(event.target.value)} /></label><AudienceFields audience={audience} value={value} departments={departments} onAudience={next => { setAudience(next); setValue(next === "role" ? "student" : ""); }} onValue={setValue} /><div className={styles.hoursFields}><label>Due date, if this notice has one<input type="datetime-local" value={due} onChange={event => setDue(event.target.value)} /></label><label>Expires<input type="datetime-local" required value={expires} onChange={event => setExpires(event.target.value)} /></label></div><p className={styles.muted}>Only the chosen people see it.</p><button className={styles.primary} type="submit">Publish notice</button></form>}
    <SectionTools search={search} onSearch={setSearch} searchPlaceholder="Search notices" chips={[{ id: "active", label: "Active" }, { id: "expired", label: "Expired" }, { id: "all", label: "All" }]} chip={scope} onChip={id => setScope(id as "active" | "expired" | "all")} />
    {ready && visible.length === 0 && <div className={styles.card}><h2>{search.trim() ? "No matching notices" : "No notices right now"}</h2></div>}
    {visible.map(row => <article className={styles.requestCard} key={row.id}><div className={styles.requestTop}><div><h2>{row.title}</h2><span className={styles.muted}>{audienceLabel(row.audience, row.audience_value)} · expires {stamp(row.expires_at)}</span></div></div><p>{row.body}</p>{row.due_at && <p><strong>Due:</strong> {stamp(row.due_at)}</p>}</article>)}
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}</>;
}

export function ClubEvents({ role = "student", isAdmin, userId, people, departments }: { role?: string; isAdmin: boolean; userId: string; people: Person[]; departments: string[] }) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [follows, setFollows] = useState<string[]>([]);
  const [posters, setPosters] = useState<string[]>([]);
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [place, setPlace] = useState(""); const [clubName, setClubName] = useState("");
  const [starts, setStarts] = useState(""); const [ends, setEnds] = useState("");
  const [audience, setAudience] = useState("institution"); const [value, setValue] = useState("student");
  const [poster, setPoster] = useState("");
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [day, setDay] = useState(() => startOfLocalDay());
  const [scope, setScope] = useState<"upcoming" | "day" | "all">("upcoming");
  const canPost = isAdmin || posters.includes(userId);
  async function load() {
    if (!supabase) return;
    const [eventResult, posterResult, clubResult, followResult] = await Promise.all([
      supabase.from("club_events").select("id,title,body,place,starts_at,ends_at,audience,audience_value,author_id,club_id").order("starts_at"),
      supabase.from("club_posters").select("profile_id"),
      supabase.from("clubs").select("id,name").order("name"),
      supabase.from("club_follows").select("club_id"),
    ]);
    if (eventResult.error || posterResult.error || clubResult.error || followResult.error) setError("Club events could not be loaded.");
    else setError("");
    setRows((eventResult.data ?? []) as EventRow[]);
    setClubs((clubResult.data ?? []) as ClubRow[]);
    setFollows(((followResult.data ?? []) as { club_id: string }[]).map(item => item.club_id));
    setPosters(((posterResult.data ?? []) as { profile_id: string }[]).map(item => item.profile_id));
  }
  useEffect(() => { void load(); }, [userId]);
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const saved = await supabase.rpc("publish_club_event", {
      p_title: title, p_body: body, p_place: place, p_starts: new Date(starts).toISOString(), p_ends: ends ? new Date(ends).toISOString() : null,
      p_audience: audience, p_audience_value: audience === "institution" ? "" : value, p_club_name: clubName.trim(),
    });
    if (saved.error) { setError(saved.error.message); setMessage(""); return; }
    setTitle(""); setBody(""); setPlace(""); setClubName(""); setStarts(""); setEnds(""); setMessage("Event posted. People who follow this club are notified."); setError(""); await load();
  }
  async function toggleFollow(clubId: string) {
    if (!supabase) return;
    const saved = await supabase.rpc(follows.includes(clubId) ? "unfollow_club" : "follow_club", { p_club: clubId });
    if (saved.error) { setError(saved.error.message); return; }
    setError(""); await load();
  }
  const eventLine = isAdmin ? "Post one, or let someone else post." : role === "faculty" ? "Posts shared with you. Post one if you are allowed." : "Posts shared with you.";
  const visible = rows.filter(row => {
    if (scope === "upcoming" && Date.parse(row.starts_at) < startOfLocalDay().getTime()) return false;
    if (scope === "day" && !isSameLocalDay(row.starts_at, day)) return false;
    const club = clubs.find(item => item.id === row.club_id)?.name ?? "";
    return matchesQuery(`${row.title} ${row.body} ${row.place} ${club}`, search);
  });
  return <><div className={styles.pageHead}><div><h1>Events.</h1><p>{eventLine}</p></div></div>
    {isAdmin && <form className={styles.card} onSubmit={event => { event.preventDefault(); void supabase?.rpc("grant_club_poster", { p_user: poster }).then(result => { if (result.error) setError(result.error.message); else { setMessage("That person can now post club events."); setError(""); void load(); } }); }}><h2>Authorize a poster</h2><label>Person<select required value={poster} onChange={event => setPoster(event.target.value)}><option value="">Choose a person</option>{people.filter(person => person.active).map(person => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label><button className={styles.secondary} type="submit">Allow event posts</button>{posters.map(id => { const person = people.find(item => item.id === id); return <div className={styles.hourRow} key={id}><span>{person?.name ?? "Campus member"}</span><button type="button" onClick={() => void supabase?.rpc("revoke_club_poster", { p_user: id }).then(() => load())}>Remove</button></div>; })}</form>}
    {canPost && <form className={styles.card} onSubmit={event => void publish(event)}><h2>Post a club event</h2><label>Club<input required maxLength={80} value={clubName} onChange={event => setClubName(event.target.value)} placeholder="Club name" /></label><label>Title<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label><label>Details<textarea required maxLength={2000} value={body} onChange={event => setBody(event.target.value)} /></label><label>Place<input maxLength={160} value={place} onChange={event => setPlace(event.target.value)} /></label><AudienceFields audience={audience} value={value} departments={departments} onAudience={next => { setAudience(next); setValue(next === "role" ? "student" : ""); }} onValue={setValue} /><div className={styles.hoursFields}><label>Starts<input type="datetime-local" required value={starts} onChange={event => setStarts(event.target.value)} /></label><label>Ends<input type="datetime-local" value={ends} onChange={event => setEnds(event.target.value)} /></label></div><p className={styles.muted}>People who follow this club get an alert. The event stays visible to the audience you choose.</p><button className={styles.primary} type="submit">Post event</button></form>}
    {clubs.length > 0 && <section className={styles.card}><h2>Clubs</h2>{clubs.map(club => <div className={styles.hourRow} key={club.id}><span>{club.name}</span><button type="button" onClick={() => void toggleFollow(club.id)}>{follows.includes(club.id) ? "Following" : "Follow"}</button></div>)}</section>}
    <SectionTools search={search} onSearch={setSearch} searchPlaceholder="Search events" chips={[{ id: "upcoming", label: "Upcoming" }, { id: "day", label: "This day" }, { id: "all", label: "All" }]} chip={scope} onChip={id => setScope(id as "upcoming" | "day" | "all")} day={scope === "day" ? day : undefined} onDayChange={scope === "day" ? setDay : undefined} />
    {visible.length === 0 && <div className={styles.card}><h2>{search.trim() ? "No matching events" : "No events right now"}</h2></div>}
    {visible.map(row => { const club = clubs.find(item => item.id === row.club_id); return <article className={styles.requestCard} key={row.id}><div className={styles.requestTop}><div><h2>{row.title}</h2><span className={styles.muted}>{club ? `${club.name} · ` : ""}{stamp(row.starts_at)}{row.ends_at ? ` – ${stamp(row.ends_at)}` : ""} · {audienceLabel(row.audience, row.audience_value)}</span></div>{row.club_id && <button type="button" className={styles.secondary} onClick={() => void toggleFollow(row.club_id!)}>{follows.includes(row.club_id) ? "Following" : "Follow"}</button>}</div>{row.place && <p><strong>Place:</strong> {row.place}</p>}<p>{row.body}</p></article>; })}
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}</>;
}
