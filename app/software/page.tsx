"use client";

import { useCallback, useEffect, useMemo, useRef, useState, ViewTransition } from "react";
import { type Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase-client";
import { effectiveStatus, type ScheduledStatus, type MeetingStatus } from "../../lib/availability";
import { isBmsitEmail } from "../../lib/signup-domain";
import styles from "./software.module.css";
import { Workspace, WorkspaceBrand, WorkspaceLoading } from "./workspace";
import { discardVoice, uploadVoice, type VoiceDraft } from "../../lib/voice-notes";
import { campusRefreshPlan, campusViewFrom, type CampusView } from "../../lib/campus-refresh";
import { localMeetingIso, meetingState } from "../../lib/meeting-time";
import { EMPTY_MEETING_TIME, parseMeetingTime, type MeetingTimeDraft } from "../../lib/natural-meeting-time";
import { isSameLocalDay, matchesQuery, startOfLocalDay } from "../../lib/section-browse";
import { CampusNotices, ClubEvents, MyDay } from "./daily";
import { CampusTour } from "./tour";
import { CampusAlerts, FacultySwitch, ReplyLine } from "./light";
import { AdminPilot, type PilotUsage } from "./admin";
import { RequestInbox } from "./requests";
import { FacultyDirectory } from "./faculty-directory";
import { SectionTools } from "./section-tools";
import { campusPresence, directoryFaculty } from "../../lib/availability";

type Profile = { id: string; name: string; role: "student" | "faculty" | "admin"; department: string; office_location: string | null; active: boolean };
type Availability = { faculty_id: string; status: "available" | "busy" | "away"; updated_at: string; expires_at: string };
type Request = { id: string; student_id: string; faculty_id: string; reason: string; preferred_time: string; requested_for: string | null; meeting_at: string | null; purge_after: string | null; status: string; response_note: string | null; request_voice_path: string | null; response_voice_path: string | null; created_at: string };
type Notice = { id: string; message: string; created_at: string; read_at: string | null; kind?: string | null };
type OfficeHour = { id: string; faculty_id: string; weekday: number; start_time: string; end_time: string; timezone: string };
type Usage = PilotUsage;
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const labels = { available: "Available", busy: "Busy", away: "Away" } as const;
const descriptions = { available: "Open to student meetings", busy: "Not accepting meetings now", away: "Away from meetings" } as const;
const signupEnabled = process.env.NEXT_PUBLIC_BMSIT_SIGNUP_ENABLED === "true";
const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const workspaceTabs = new Set(["home", "day", "notices", "events", "requests", "timing", "updates", "admin"]);
const tabStorageKey = (userId: string) => `campuspulse.tab.${userId}`;
function readWorkspaceTab(userId?: string | null) {
  if (typeof window === "undefined") return "day";
  const fromHash = window.location.hash.replace(/^#/, "");
  if (workspaceTabs.has(fromHash)) return fromHash;
  if (!userId) return "day";
  try {
    const saved = sessionStorage.getItem(tabStorageKey(userId));
    if (saved && workspaceTabs.has(saved)) return saved;
  } catch { /* tab simply is not remembered */ }
  return "day";
}
function writeWorkspaceTab(userId: string, id: string) {
  try { sessionStorage.setItem(tabStorageKey(userId), id); } catch { /* tab simply is not remembered */ }
  if (typeof window === "undefined") return;
  const next = `#${id}`;
  if (window.location.hash !== next) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
}

export default function SoftwareHome() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [working, setWorking] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]); const [availability, setAvailability] = useState<Availability[]>([]);
  const [requestRows, setRequests] = useState<Request[]>([]); const [notices, setNotices] = useState<Notice[]>([]);
  const [hours, setHours] = useState<OfficeHour[]>([]); const [hoursReady, setHoursReady] = useState(false);
  const [adminReady, setAdminReady] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledStatus[]>([]); const [scheduleReady, setScheduleReady] = useState(false); const [scheduleReliable, setScheduleReliable] = useState(false);
  const [scheduledChoice, setScheduledChoice] = useState<MeetingStatus>("available"); const [scheduleStart, setScheduleStart] = useState(""); const [scheduleEnd, setScheduleEnd] = useState("");
  const [weekday, setWeekday] = useState(1); const [hourStart, setHourStart] = useState("10:00"); const [hourEnd, setHourEnd] = useState("11:00");
  const [timezone, setTimezone] = useState("UTC");
  const [department, setDepartment] = useState(""); const [statusFilter, setStatusFilter] = useState("all");
  const [listMode, setListMode] = useState<"recent" | "all" | "available">("all");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  const [tab, setTab] = useState(() => readWorkspaceTab(null)); const [search, setSearch] = useState("");
  const [updateSearch, setUpdateSearch] = useState("");
  const [updateDay, setUpdateDay] = useState(() => startOfLocalDay());
  const [updateScope, setUpdateScope] = useState<"day" | "all">("day");
  function goToTab(id: string) {
    setTab(id);
    if (sessionUser.current) writeWorkspaceTab(sessionUser.current, id);
    setTarget("");
    if (!working) changeRequestVoice(null);
    setError("");
    setMessage("");
  }
  const [duration, setDuration] = useState(60); const [target, setTarget] = useState("");
  const [reason, setReason] = useState(""); const [preferred, setPreferred] = useState<MeetingTimeDraft>(EMPTY_MEETING_TIME);
  const [notes, setNotes] = useState<Record<string, string>>({}); const [now, setNow] = useState(0);
  const [alternativeTimes, setAlternativeTimes] = useState<Record<string, MeetingTimeDraft>>({});
  const requests = useMemo(() => requestRows.filter(r => !r.purge_after || Date.parse(r.purge_after) > now).map(r => ({...r,status:meetingState(r.status,r.meeting_at,now)})),[requestRows,now]);
  const [requestVoice, setRequestVoice] = useState<VoiceDraft | null>(null);
  const [replyVoices, setReplyVoices] = useState<Record<string, VoiceDraft | null>>({});
  const [captureId, setCaptureId] = useState<string | null>(null);
  const voiceOperation = useRef<AbortController | null>(null);
  const submission = useRef<{ signature: string; id: string } | null>(null);
  const statusRequest = useRef(0);
  const fullRequest = useRef(0);
  const sessionUser = useRef<string | null>(null);
  const sessionVersion = useRef(0);
  const campusView = useRef<CampusView | null>(null);
  const refreshError = useRef<string | null>(null);
  const composerTarget = useRef(target);
  composerTarget.current = target;
  const noteRefreshError = (message: string) => { refreshError.current = message; setError(message); };
  const settleRefreshError = () => { const stale = refreshError.current; if (!stale) return; refreshError.current = null; setError(previous => previous === stale ? "" : previous); };
  const me = profiles.find(p => p.id === session?.user.id && p.active);
  const load = useCallback(async () => {
    if (!supabase || !sessionUser.current) return;
    const accountVersion = sessionVersion.current;
    const fullVersion = ++fullRequest.current;
    const statusVersion = ++statusRequest.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const readWaiting = async (version: number) => {
      const result = await supabase!.rpc("faculty_waiting_counts");
      if (version !== sessionVersion.current || result.error || !Array.isArray(result.data)) return;
      const next: Record<string, number> = {};
      for (const row of result.data as { faculty_id: string; waiting: number }[]) next[row.faculty_id] = Number(row.waiting);
      setWaiting(next);
    };
    const results = await Promise.all([
      supabase.from("profiles").select("id,name,role,department,office_location,active").abortSignal(controller.signal),
      supabase.from("availability").select("faculty_id,status,updated_at,expires_at").abortSignal(controller.signal),
      supabase.from("meeting_requests").select("id,student_id,faculty_id,reason,preferred_time,status,response_note,request_voice_path,response_voice_path,requested_for,meeting_at,purge_after,created_at").order("created_at", { ascending: false }).abortSignal(controller.signal),
      supabase.from("notifications").select("id,message,created_at,read_at,kind").order("created_at", { ascending: false }).abortSignal(controller.signal).limit(100),
      supabase.from("office_hours").select("id,faculty_id,weekday,start_time,end_time,timezone").order("weekday").order("start_time").abortSignal(controller.signal),
      supabase.rpc("is_institution_admin").abortSignal(controller.signal),
      supabase.from("scheduled_status").select("faculty_id,status,starts_at,expires_at").order("starts_at", {ascending:false}).abortSignal(controller.signal)
    ]).catch(() => null).finally(() => clearTimeout(timeout));
    if (accountVersion !== sessionVersion.current || fullVersion !== fullRequest.current) return;
    if (!results) { setScheduleReliable(false); noteRefreshError("Could not connect. Check your connection and try again."); setProfileLoaded(true); return; }
    const nextProfiles = (results[0].data ?? []) as Profile[];
    const userId = sessionUser.current ?? "";
    const failure = results.slice(1, 4).find(r => r.error)?.error;
    const plan = campusRefreshPlan(campusView.current, nextProfiles, userId, Boolean(results[0].error), Boolean(failure));
    // Revalidate access before keeping any cached campus data visible.
    if (plan === "revoke") {
      campusView.current = null;
      setProfiles([]); setRequests([]); setNotices([]); setHours([]); setAvailability([]); setScheduled([]); setScheduleReliable(false); setWaiting({});
      setUsage(null); setAdminReady(false); setTarget(""); setReason(""); setPreferred(EMPTY_MEETING_TIME); setNotes({});
      voiceOperation.current?.abort(); setRequestVoice(null); setReplyVoices({}); setCaptureId(null); setAlternativeTimes({}); submission.current = null;
      if (results[0].error) noteRefreshError("Could not verify your campus access. Check your connection and try again.");
      else { refreshError.current = null; setError(""); }
      setProfileLoaded(true); return;
    }
    if (plan === "keep") {
      setProfiles(nextProfiles);
      if (results[1].error && statusVersion === statusRequest.current) setScheduleReliable(false);
      noteRefreshError(failure?.message || "Could not refresh your campus workspace. Try again."); setProfileLoaded(true); return;
    }
    if (plan === "replace") {
      const nextView = campusViewFrom(nextProfiles, userId);
      const roleChanged = campusView.current?.role !== nextView?.role;
      const facultyStillVisible = nextProfiles.some(p => p.id === composerTarget.current && p.active && p.role === "faculty");
      campusView.current = nextView;
      setProfiles(nextProfiles);
      setRequests(results[2].error ? [] : (results[2].data ?? []) as Request[]);
      setNotices(results[3].error ? [] : (results[3].data ?? []) as Notice[]);
      setHours(results[4].error ? [] : (results[4].data ?? []) as OfficeHour[]); setHoursReady(!results[4].error);
      setAdminReady(results[5].data === true && !results[5].error); setUsage(null);
      setAvailability([]); setScheduled([]); setScheduleReliable(false);
      if (statusVersion === statusRequest.current) {
        if (!results[1].error) setAvailability((results[1].data ?? []) as Availability[]);
        if (!results[6].error) setScheduled((results[6].data ?? []) as ScheduledStatus[]);
        setScheduleReady(!results[6].error); setScheduleReliable(!results[1].error && !results[6].error);
      }
      if (roleChanged || (composerTarget.current && !facultyStillVisible)) {
        voiceOperation.current?.abort(); setRequestVoice(null); setReplyVoices({}); setCaptureId(null); setAlternativeTimes({});
        submission.current = null; setTarget(""); setReason(""); setPreferred(EMPTY_MEETING_TIME); setNotes({});
      }
      noteRefreshError(failure?.message || "Could not refresh your campus workspace. Try again."); setNow(Date.now()); setProfileLoaded(true); void readWaiting(accountVersion); return;
    }
    campusView.current = campusViewFrom(nextProfiles, userId);
    setProfiles(nextProfiles);
    setRequests((results[2].data ?? []) as Request[]); setNotices((results[3].data ?? []) as Notice[]);
    setHours((results[4].data ?? []) as OfficeHour[]); setHoursReady(!results[4].error); setAdminReady(results[5].data === true && !results[5].error);
    if (statusVersion === statusRequest.current) {
      setAvailability((results[1].data ?? []) as Availability[]);
      setScheduled((results[6].data ?? []) as ScheduledStatus[]); setScheduleReady(!results[6].error);
      const scheduleError = results[6].error;
      setScheduleReliable(!scheduleError);
      if (scheduleError) noteRefreshError("Could not load scheduled availability. Statuses are temporarily unknown.");
      else settleRefreshError();
    } else settleRefreshError();
    setNow(Date.now()); setProfileLoaded(true); void readWaiting(accountVersion);
  }, []);
  const refreshStatuses = useCallback(async () => {
    if (!supabase || !sessionUser.current) return;
    const accountVersion = sessionVersion.current;
    const version = ++statusRequest.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let currentStatuses, futureStatuses;
    try {
      [currentStatuses, futureStatuses] = await Promise.all([
        supabase.from("availability").select("faculty_id,status,updated_at,expires_at").abortSignal(controller.signal),
        supabase.from("scheduled_status").select("faculty_id,status,starts_at,expires_at").order("starts_at", {ascending:false}).abortSignal(controller.signal)
      ]);
    } catch {
      if (version === statusRequest.current && accountVersion === sessionVersion.current) {
        setScheduleReliable(false);
        noteRefreshError("Could not refresh availability. Statuses are temporarily unknown.");
      }
      return;
    } finally { clearTimeout(timeout); }
    if (version !== statusRequest.current || accountVersion !== sessionVersion.current) return;
    if (currentStatuses.error || futureStatuses.error) {
      setScheduleReliable(false);
      noteRefreshError("Could not refresh availability. Statuses are temporarily unknown.");
      return;
    }
    setAvailability((currentStatuses.data ?? []) as Availability[]);
    setScheduled((futureStatuses.data ?? []) as ScheduledStatus[]);
    setScheduleReady(true); setScheduleReliable(true); setNow(Date.now());
    settleRefreshError();
  }, []);
  useEffect(() => { setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"); }, []);
  useEffect(() => {
    if (!me) return;
    const allowed = me.role === "faculty"
      ? ["home", "day", "notices", "events", "requests", "timing", "updates"]
      : me.role === "admin"
        ? ["home", "day", "notices", "events", "admin", "updates"]
        : ["home", "day", "notices", "events", "requests", "updates"];
    const next = allowed.includes(tab) ? tab : "day";
    if (next !== tab) setTab(next);
    writeWorkspaceTab(me.id, next);
  }, [me, tab]);
  useEffect(() => {
    if (tab !== "updates" || !supabase) return;
    let alive = true;
    const stamped = new Date().toISOString();
    setNotices(previous => {
      if (!previous.some(item => !item.read_at)) return previous;
      return previous.map(item => item.read_at ? item : { ...item, read_at: stamped });
    });
    void supabase.rpc("mark_notifications_read").then(({ error }) => {
      if (!alive || !error) return;
      setNotices(previous => previous.map(item => item.read_at === stamped ? { ...item, read_at: null } : item));
    });
    return () => { alive = false; };
  }, [tab]);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    const client = supabase;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, current) => {
      const nextUser = current?.user.id ?? null;
      if (nextUser !== sessionUser.current) {
        const previousUser = sessionUser.current;
        voiceOperation.current?.abort(); setRequestVoice(null); setReplyVoices({}); setCaptureId(null); setAlternativeTimes({}); submission.current = null;
        sessionUser.current = nextUser; sessionVersion.current++; statusRequest.current++; fullRequest.current++; campusView.current = null; refreshError.current = null;
        setProfileLoaded(false); setProfiles([]); setAvailability([]); setHours([]); setHoursReady(false);
        setRequests([]); setNotices([]); setScheduled([]); setScheduleReady(false); setScheduleReliable(false);
        setDepartment(""); setStatusFilter("all"); setListMode("recent"); setRecentIds([]); setWaiting({}); setAdminReady(false); setUsage(null); setSearch("");
        setTarget(""); setReason(""); setPreferred(EMPTY_MEETING_TIME); setNotes({});
        setDuration(60);
        setScheduleStart(""); setScheduleEnd(""); setScheduledChoice("available"); setError(""); setMessage(""); setWorking(false); setEmail(""); setPassword("");
        // Keep the open section across reload; only reset when the signed-in person changes.
        if (previousUser && nextUser && previousUser !== nextUser) setTab("day");
        else if (nextUser) {
          const restored = readWorkspaceTab(nextUser);
          setTab(restored);
          writeWorkspaceTab(nextUser, restored);
        } else setTab("day");
      }
      setSession(current); setLoading(false);
    });
    return () => { sessionVersion.current++; statusRequest.current++; fullRequest.current++; voiceOperation.current?.abort(); subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!session) return;
    void load();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const statusPoll = setInterval(() => { if (document.visibilityState === "visible") void refreshStatuses(); }, 5000);
    const fullPoll = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30000);
    const resume = () => { if (document.visibilityState === "visible") { setNow(Date.now()); void load(); } };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => { clearInterval(clock); clearInterval(statusPoll); clearInterval(fullPoll); document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", resume); statusRequest.current++; };
  }, [session, load, refreshStatuses]);
  useEffect(() => {
    if (me?.role !== "admin" || !adminReady || !supabase) { setUsage(null); return; }
    let active = true;
    const accountVersion = sessionVersion.current;
    supabase.rpc("admin_usage_summary").then(({data, error}) => { if (active && accountVersion === sessionVersion.current) setUsage(error ? null : data as Usage); });
    return () => { active = false; };
  }, [me?.role, adminReady, profiles.length, requests.length, Math.floor(now / 30000)]);
  const faculty = useMemo(() => {
    const statusOf = (id: string) => campusPresence(
      scheduleReliable ? availability.find(item => item.faculty_id === id) : undefined,
      scheduleReliable ? scheduled.find(item => item.faculty_id === id && Date.parse(item.starts_at) <= now) : undefined,
      hoursReady ? hours.filter(item => item.faculty_id === id) : [],
      now,
    );
    const query = search.trim().toLowerCase();
    const matched = profiles.filter(person => person.active && person.role === "faculty" && `${person.name} ${person.department}`.toLowerCase().includes(query));
    if (query) return matched;
    const met = new Set(requests.filter(row => row.student_id === me?.id).map(row => row.faculty_id));
    return directoryFaculty(matched, listMode, new Set(recentIds), met, id => statusOf(id).status === "available", id => waiting[id] ?? 0);
  }, [profiles, search, listMode, recentIds, scheduleReliable, availability, scheduled, now, hours, hoursReady, me, requests, waiting]);
  useEffect(() => {
    if (!me) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`campuspulse.recent.${me.id}`) || "[]");
      setRecentIds(Array.isArray(saved) ? saved.filter((item: unknown) => typeof item === "string") : []);
    } catch { setRecentIds([]); }
  }, [me?.id]);
  useEffect(() => {
    const query = search.trim().toLowerCase();
    if (!me || query.length < 2) return;
    const ids = profiles.filter(person => person.active && person.role === "faculty" && `${person.name} ${person.department}`.toLowerCase().includes(query)).map(person => person.id);
    if (!ids.length) return;
    setRecentIds(previous => {
      const next = [...ids, ...previous].filter((id, index, all) => all.indexOf(id) === index).slice(0, 12);
      try { localStorage.setItem(`campuspulse.recent.${me.id}`, JSON.stringify(next)); } catch { /* the recent list simply is not remembered */ }
      return next.length === previous.length && next.every((id, index) => id === previous[index]) ? previous : next;
    });
  }, [search, profiles, me]);
  const own = availability.find(a => a.faculty_id === me?.id);
  const currentOwn = scheduleReliable ? effectiveStatus(own, scheduled.find(s => s.faculty_id === me?.id && Date.parse(s.starts_at) <= now), now) : null;
  const current = currentOwn?.current ? currentOwn.status : null;
  async function action(fn: () => PromiseLike<{ error: { message: string } | null }>, success: string) {
    const accountVersion = sessionVersion.current;
    setError(""); setMessage(""); setWorking(true);
    try { const result = await fn(); if (accountVersion !== sessionVersion.current) return false; if (result.error) { setError(result.error.message); return false; } setMessage(success); await load(); return accountVersion === sessionVersion.current; }
    catch { if (accountVersion === sessionVersion.current) setError("Could not connect. Check your connection and try again."); return false; }
    finally { if (accountVersion === sessionVersion.current) setWorking(false); }
  }
  function captureBusy(id: string, busy: boolean) { setCaptureId(previous => busy ? id : previous === id ? null : previous); }
  function changeRequestVoice(next: VoiceDraft | null) {
    if (requestVoice && me) void discardVoice(supabase!, me.id, requestVoice);
    setRequestVoice(next);
  }
  function chooseFaculty(id: string) { changeRequestVoice(null); submission.current = null; setTarget(id); setReason(""); setPreferred(EMPTY_MEETING_TIME); }
  async function sendRequest(e: React.FormEvent) {
    e.preventDefault(); if (!supabase || !me || captureId) return;
    if (!reason.trim() && !requestVoice) { setError("Add a brief reason or a voice note."); return; }
    const preferredAt = /^\s*(right\s+)?now\s*$/i.test(preferred.text) ? parseMeetingTime(preferred.text) : preferred;
    let meetingAt: string; try { meetingAt = localMeetingIso(preferredAt.iso || ""); } catch(e) { setError(preferredAt.error || preferred.error || (e as Error).message); return; }
    const version = sessionVersion.current; const user = me.id;
    const signature = JSON.stringify([target, reason, preferred.iso, requestVoice?.id]);
    if (submission.current?.signature !== signature) submission.current = { signature, id: crypto.randomUUID() };
    const id = submission.current.id;
    const abort = new AbortController(); voiceOperation.current = abort;
    const timer = setTimeout(() => abort.abort(), 30000);
    const ok = await action(async () => {
      const path = requestVoice ? await uploadVoice(supabase!, user, requestVoice, abort.signal) : null;
      if (version !== sessionVersion.current || abort.signal.aborted) throw new Error("Account changed");
      return supabase!.rpc("create_timed_meeting_request", { p_faculty: target, p_reason: reason, p_meeting_at: meetingAt, p_voice_path: path, p_submission_id: id }).abortSignal(abort.signal);
    }, "Request sent. You can follow its status in My requests.");
    clearTimeout(timer);
    if (ok) { setRequestVoice(null); setTarget(""); submission.current = null; }
  }
  async function sendResponse(request: string, status: string) {
    if (!supabase || !me || captureId) return;
    const voice = replyVoices[request]; const note = notes[request] || null;
    let alternativeAt: string | null = null;
    if (status === "alternative") { try { alternativeAt = localMeetingIso(alternativeTimes[request]?.iso || ""); } catch { setError(alternativeTimes[request]?.error || "Type a future alternative date and time before suggesting it."); return; } }
    const version = sessionVersion.current; const user = me.id;
    const abort = new AbortController(); voiceOperation.current = abort;
    const timer = setTimeout(() => abort.abort(), 30000);
    const ok = await action(async () => {
      const path = voice ? await uploadVoice(supabase!, user, voice, abort.signal) : null;
      if (version !== sessionVersion.current || abort.signal.aborted) throw new Error("Account changed");
      return supabase!.rpc("respond_to_timed_request", { p_request: request, p_status: status, p_note: note, p_voice_path: path, p_alternative_at: alternativeAt }).abortSignal(abort.signal);
    }, "Response saved.");
    clearTimeout(timer);
    if (ok) { setReplyVoices(previous => ({ ...previous, [request]: null })); setNotes(previous => ({ ...previous, [request]: "" })); setAlternativeTimes(previous => ({ ...previous, [request]: EMPTY_MEETING_TIME })); }
  }
  async function cancelRequest(request: string) {
    if (!supabase || captureId) return;
    await action(() => supabase!.rpc("cancel_meeting_request", { p_request: request }), "Request cancelled.");
  }
  async function signIn(e: React.FormEvent) {
    e.preventDefault(); if (!supabase) return;
    setError(""); setMessage(""); setWorking(true);
    try { const {error: signInError} = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (signInError) setError(signInError.message); }
    catch { setError("Could not connect. Check your connection and try again."); }
    finally { setPassword(""); setWorking(false); }
  }
  async function signUp(e: React.FormEvent) {
    e.preventDefault(); if (!supabase) return;
    if (!isBmsitEmail(email)) { setError("Use your @bmsit.in email address to sign up."); return; }
    setError(""); setMessage(""); setWorking(true);
    try {
      const {error: signupError} = await supabase.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:`${window.location.origin}/software/`}});
      if (signupError) setError(signupError.message);
      else { setPassword(""); setMessage("Check your campus email for a confirmation link. Your administrator must activate your campus profile before you can use the app."); }
    } catch { setError("Could not connect. Check your connection and try again."); }
    finally { setWorking(false); }
  }
  if (!supabase) return <main className={styles.shell}><div className={styles.setup}><span className={styles.eyebrow}>CAMPUSPULSE · BY SYGNETTA</span><h1>Let’s connect your campus.</h1><p>This app needs a Supabase project before sign-in and shared data can work. Follow the setup instructions in the project documentation.</p><p className={styles.muted}>No demo data is presented as real availability.</p></div></main>;
  if (loading || !session) return <ViewTransition enter="campus-arrive" exit="campus-leave" default="none"><main className={styles.loginPage}><section className={styles.loginIntro} aria-labelledby="campus-intro"><p className={styles.eyebrow}>CAMPUSPULSE · BY SYGNETTA</p><h1 id="campus-intro">See your college.</h1><p>Faculty names stay inside your college.</p><ol><li><strong>Sign in.</strong> Your college only.</li><li><strong>Check a status.</strong> Available, busy, or away.</li><li><strong>Request a time.</strong> A note, or a short recording.</li></ol></section><div className={styles.loginCard}><WorkspaceBrand/><h2>{authMode === "login" ? "Sign in" : "Create an account"}</h2><form onSubmit={authMode === "login" ? signIn : signUp}><label>Campus email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" disabled={loading} /></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={authMode === "signup" ? 8 : undefined} autoComplete={authMode === "signup" ? "new-password" : "current-password"} disabled={loading} /></label><button className={styles.primary} disabled={loading || working}>{authMode === "login" ? "Sign in" : "Create account"}</button></form><p><a className={styles.link} href="/software/reset/">Forgot your password?</a></p>{error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}{signupEnabled && <button type="button" className={styles.link} onClick={() => {setAuthMode(authMode === "login" ? "signup" : "login");setError("");setMessage("");setPassword("");}}>{authMode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button>}<p><a className={styles.link} href="/software/install/">Install on your phone</a></p><p><a className={styles.link} href="/software/help/">Help & privacy</a></p><p><small>{signupEnabled ? "Registration requires an @bmsit.in email and administrator activation." : "Accounts are provided by your institution."}</small></p></div></main></ViewTransition>;
  if (!me && !profileLoaded) return <WorkspaceLoading />;
  if (!me) return <main className={styles.shell}><div className={styles.setup}><WorkspaceBrand /><span className={styles.eyebrow}>CAMPUSPULSE · BY SYGNETTA</span><h1>Account not ready</h1><p>{error ? "We couldn’t load your account. Check your connection or contact your administrator." : "Your account does not have an active campus profile. Contact your administrator."}</p>{error && <p role="alert">{error}</p>}<div className={styles.actions}><button onClick={() => {setProfileLoaded(false);void load();}}>Try again</button><button onClick={() => supabase!.auth.signOut({scope:"local"})}>Sign out</button></div></div></main>;
  const tabs = me.role === "faculty" ? [["home", "Overview"], ["day", "My day"], ["notices", "Notices"], ["events", "Events"], ["requests", "Requests"], ["timing", "Availability settings"], ["updates", "Updates"]] : me.role === "admin" ? [["home", "Faculty directory"], ["day", "My day"], ["notices", "Notices"], ["events", "Events"], ["admin", "Manage people"], ["updates", "Updates"]] : [["home", "Find faculty"], ["day", "My day"], ["notices", "Notices"], ["events", "Events"], ["requests", "My requests"], ["updates", "Updates"]];
  const allowedTabs = new Set(tabs.map(([id]) => id));
  const activeTab = allowedTabs.has(tab) ? tab : "day";
  const name = (id: string) => profiles.find(p => p.id === id)?.name ?? "Campus member";
  const latestReply = requestRows.find(row => row.student_id === me.id && ["accepted", "declined", "alternative"].includes(row.status));
  const mine = campusPresence(
    scheduleReliable ? own : undefined,
    scheduleReliable ? scheduled.find(item => item.faculty_id === me.id && Date.parse(item.starts_at) <= now) : undefined,
    hoursReady ? hours.filter(item => item.faculty_id === me.id) : [],
    now,
  );
  const facultyControls = me.role === "faculty" ? <FacultySwitch presence={mine} working={working || !!captureId} onSet={status => void action(() => supabase!.rpc("set_availability", { p_status: status, p_duration_minutes: 480 }), labels[status])} onHours={() => goToTab("timing")} /> : null;
  const replyLine = latestReply && me.role === "student" ? <ReplyLine status={latestReply.status} when={date(latestReply.meeting_at || latestReply.requested_for || latestReply.created_at)} person={name(latestReply.faculty_id)} /> : null;
  return <Workspace name={me.name} role={me.role} detail={me.department} active={activeTab} tabs={tabs.map(([id,title]) => ({id,title,count:id === "requests" && me.role === "faculty" ? requests.filter(r => r.status === "pending").length : id === "updates" ? notices.filter(n => !n.read_at).length : undefined}))} onNavigate={goToTab} onSignOut={() => {void supabase!.auth.signOut({scope:"local"});}}>
    <main className={styles.main} id="workspace-content" tabIndex={-1} key={activeTab}>{error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}
    <CampusAlerts userId={me.id} />
    {activeTab === "day" && <MyDay role={me.role} userId={me.id} meetings={requests} names={name} officeHours={hours.filter(hour => hour.faculty_id === me.id)} lead={<>{replyLine}{facultyControls}</>} />}
    {activeTab === "notices" && <CampusNotices isAdmin={me.role === "admin"} departments={[...new Set(profiles.map(person => person.department))].filter(Boolean).sort()} />}
    {activeTab === "events" && <ClubEvents role={me.role} isAdmin={me.role === "admin"} userId={me.id} people={profiles} departments={[...new Set(profiles.map(person => person.department))].filter(Boolean).sort()} />}
    {activeTab === "home" && me.role === "faculty" && <><div className={styles.pageHead}><div><span className={styles.eyebrow}>OVERVIEW</span><h1>{me.name}.</h1><p>Set status. Answer requests.</p></div></div>{facultyControls}<section className={styles.card}><h2>{requests.filter(r => r.status === "pending").length} waiting</h2><button className={styles.primary} onClick={() => goToTab("requests")}>Open inbox</button></section></>}
    {activeTab === "home" && me.role !== "faculty" && <>
      {replyLine}
      <FacultyDirectory
        role={me.role === "admin" ? "admin" : "student"}
        people={faculty}
        search={search}
        setSearch={setSearch}
        listMode={listMode}
        setListMode={setListMode}
        scheduleReliable={scheduleReliable}
        hoursReady={hoursReady}
        availability={availability}
        scheduled={scheduled}
        hours={hours}
        now={now}
        target={target}
        preferred={preferred}
        setPreferred={setPreferred}
        reason={reason}
        setReason={setReason}
        requestVoice={requestVoice}
        changeRequestVoice={changeRequestVoice}
        captureBusy={captureBusy}
        working={working}
        captureId={captureId}
        userId={me.id}
        onChoose={chooseFaculty}
        onCancel={() => { setTarget(""); changeRequestVoice(null); }}
        onSend={event => void sendRequest(event)}
      />
    </>}
    {activeTab === "timing" && me.role === "faculty" && <><div className={styles.pageHead}><div><span className={styles.eyebrow}>AVAILABILITY</span><h1>Hours.</h1><p>Status and weekly slots.</p></div></div><section className={styles.card}><label>For<select value={duration} onChange={e => setDuration(Number(e.target.value))}><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option><option value={240}>4 hours</option><option value={480}>Rest of day</option></select></label><div className={styles.slotRow}>{(["available", "busy", "away"] as const).map(status => <button type="button" key={status} className={styles.secondary} disabled={working} onClick={() => void action(() => supabase!.rpc("set_availability", { p_status: status, p_duration_minutes: duration }), `Status updated to ${labels[status]}.`)}>{labels[status]}</button>)}</div></section></>}
    {activeTab === "timing" && me.role === "faculty" && <section className={styles.card} style={{marginTop: 18}}><span className={styles.eyebrow}>RECURRING OFFICE HOURS</span><h2>Hours you want to repeat</h2><p>Add as many as you like. Students can still ask for another time.</p>{!hoursReady ? <p className={styles.muted}>Office hours are not configured yet. Ask your administrator to apply the office-hours database update.</p> : <><div>{hours.filter(h => h.faculty_id === me.id).map(h => <div className={styles.hourRow} key={h.id}><span>{weekdays[h.weekday]} · {h.start_time.slice(0,5)}–{h.end_time.slice(0,5)} <small>{h.timezone}</small></span><button type="button" disabled={working} onClick={() => void action(() => supabase!.rpc("remove_office_hour", {p_id: h.id}), "Office hours removed.")}>Remove</button></div>)}{!hours.some(h => h.faculty_id === me.id) && <p className={styles.muted}>No office hours added yet.</p>}</div><form onSubmit={e => {e.preventDefault(); if (hourStart >= hourEnd) {setError("The end time must be after the start time."); return;} void action(() => supabase!.rpc("add_office_hour", {p_weekday: weekday, p_start: hourStart, p_end: hourEnd, p_timezone: timezone}), "Office hours added.");}}><div className={styles.hoursFields}><label>Day<select value={weekday} onChange={e => setWeekday(Number(e.target.value))}>{weekdays.map((day,index) => <option key={day} value={index}>{day}</option>)}</select></label><label>Start<input type="time" required value={hourStart} onChange={e => setHourStart(e.target.value)} /></label><label>End<input type="time" required value={hourEnd} onChange={e => setHourEnd(e.target.value)} /></label><div className={styles.fieldAction}><span aria-hidden="true">Add</span><button className={styles.secondary} disabled={working}>Add office hours</button></div></div><p className={styles.muted}>Time zone: {timezone}. Times are shown to students with this time zone.</p></form></>}</section>}
    {activeTab === "timing" && me.role === "faculty" && <section className={styles.card} style={{marginTop:18}}><span className={styles.eyebrow}>PLAN AHEAD</span><h2>Schedule a status change</h2><p>Changes your status at a set time. A later manual change wins.</p>{!scheduleReady ? <p className={styles.muted}>Scheduled status is not enabled yet. The project administrator must apply the database update.</p> : <>{scheduled.filter(s => s.faculty_id === me.id && Date.parse(s.starts_at) > now).map(s => <div className={styles.hourRow} key={s.starts_at}><span>{labels[s.status]} · {date(s.starts_at)} until {date(s.expires_at)}</span><button disabled={working} type="button" onClick={() => void action(() => supabase!.rpc("cancel_scheduled_status"), "Scheduled status cancelled.")}>Cancel</button></div>)}<form onSubmit={e => {e.preventDefault(); const start = new Date(scheduleStart); const end = new Date(scheduleEnd); if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() <= Date.now() || end.getTime() <= start.getTime() || end.getTime() - start.getTime() > 8 * 60 * 60 * 1000) {setError("Choose a future start time and an end time within eight hours."); return;} void action(() => supabase!.rpc("schedule_status", {p_status:scheduledChoice,p_starts_at:start.toISOString(),p_expires_at:end.toISOString()}), "Status change scheduled.").then(ok => {if(ok){setScheduleStart("");setScheduleEnd("");}});}}><div className={styles.hoursFields}><label>Status<select value={scheduledChoice} onChange={e => setScheduledChoice(e.target.value as MeetingStatus)}><option value="available">Available</option><option value="busy">Busy</option><option value="away">Away</option></select></label><label>Start<input type="datetime-local" required value={scheduleStart} onChange={e => setScheduleStart(e.target.value)} /></label><label>End<input type="datetime-local" required value={scheduleEnd} onChange={e => setScheduleEnd(e.target.value)} /></label><div className={styles.fieldAction}><span aria-hidden="true">Add</span><button disabled={working} className={styles.secondary}>Schedule status</button></div></div><p className={styles.muted}>Times use your device’s local time zone. One upcoming change can be scheduled up to 30 days ahead. After it ends, the status becomes unknown unless you set a new one.</p></form></>}</section>}
        {activeTab === "admin" && me.role === "admin" && <><div className={styles.pageHead}><div><span className={styles.eyebrow}>CAMPUS ADMINISTRATION</span><h1>Manage people.</h1><p>People and pilot health. Alerts stay in the app.</p></div></div>{!adminReady ? <section className={styles.card}>The administrator database update has not been applied yet. Ask the project administrator to apply it before managing profiles.</section> : <AdminPilot meId={me.id} profiles={profiles} usage={usage} working={working} onAction={action} onError={setError} />}</>}
    {activeTab === "requests" && (me.role === "student" || me.role === "faculty") && <RequestInbox role={me.role} userId={me.id} rows={requests} names={name} working={working} captureId={captureId} notes={notes} setNotes={(id, value) => setNotes(previous => ({ ...previous, [id]: value }))} replyVoices={replyVoices} setReplyVoice={(id, value) => setReplyVoices(previous => ({ ...previous, [id]: value }))} onBusy={(id, busy) => captureBusy(id, busy)} alternativeTimes={alternativeTimes} setAlternativeTime={(id, value) => setAlternativeTimes(previous => ({ ...previous, [id]: value }))} onRespond={(id, status) => void sendResponse(id, status)} onCancel={id => void cancelRequest(id)} />}
    {activeTab === "updates" && (() => {
      const kindLabel = (kind?: string | null) => kind === "notice" ? "Notice" : kind === "event" ? "Event" : "Meeting";
      const visible = notices.filter(item => {
        if (updateScope === "day" && !isSameLocalDay(item.created_at, updateDay)) return false;
        return matchesQuery(`${kindLabel(item.kind)} ${item.message}`, updateSearch);
      });
      return <><div className={styles.pageHead}><div><h1>Updates.</h1><p>Replies, notices, and events.</p></div></div>
        <SectionTools search={updateSearch} onSearch={setUpdateSearch} searchPlaceholder="Search updates" chips={[{ id: "day", label: "This day" }, { id: "all", label: "All" }]} chip={updateScope} onChip={id => setUpdateScope(id as "day" | "all")} day={updateScope === "day" ? updateDay : undefined} onDayChange={updateScope === "day" ? setUpdateDay : undefined} />
        {visible.length ? visible.map(n => <article className={styles.requestCard} key={n.id}><strong>{kindLabel(n.kind)}</strong><p>{n.message}</p><p className={styles.muted}>{date(n.created_at)}</p></article>) : <div className={styles.card}>{notices.length ? (updateSearch.trim() ? "No matching updates." : "No updates on this day.") : "No updates yet."}</div>}
      </>;
    })()}
    </main><CampusTour userId={me.id} role={me.role} onShow={goToTab} /></Workspace>;
}
