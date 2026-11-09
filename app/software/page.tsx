"use client";

import { useCallback, useEffect, useMemo, useRef, useState, ViewTransition } from "react";
import { type Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase-client";
import { effectiveStatus, type ScheduledStatus, type MeetingStatus } from "../../lib/availability";
import { isValidEmail } from "../../lib/signup-domain";
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
import { AdminPilot, type AdminPrivacyRow, type AdminProfile, type BulkProfilePatch, type PeopleQuery, type PilotUsage } from "./admin";
import { AskPatternCard } from "./ask-pattern";
import { RequestInbox } from "./requests";
import { FacultyDirectory } from "./faculty-directory";
import { FacultyHome } from "./faculty-home";
import { FacultyInboxPrefs, type FacultyLeaveDay } from "./faculty-inbox-settings";
import { PrivacyRequestCard } from "./privacy-request";
import { AdminStudentDirectory } from "./admin-directory";
import { SectionTools } from "./section-tools";
import { FacultyStatusNudge, type OpenStatusNudge } from "./status-nudge";
import { campusPresence, directoryFaculty, nextOfficeSlots } from "../../lib/availability";
import {
  readFavoriteFaculty,
  rememberFacultyReason,
  readStatusCache,
  toggleFavoriteFaculty,
  writeStatusCache,
  type CachedPresence,
} from "../../lib/campus-prefs";
import type { WaitingPlace } from "./faculty-directory";

type Profile = { id: string; name: string; role: "student" | "faculty" | "admin"; department: string; office_location: string | null; expertise: string; portfolio: string; active: boolean; pause_requests?: boolean; quiet_start?: string | null; quiet_end?: string | null; reply_snippets?: string[]; auto_busy_outside_hours?: boolean };
type Availability = { faculty_id: string; status: "available" | "busy" | "away"; updated_at: string; expires_at: string; walk_in_note?: string | null };
type Request = { id: string; student_id: string; faculty_id: string; reason: string; preferred_time: string; requested_for: string | null; meeting_at: string | null; purge_after: string | null; status: string; response_note: string | null; request_voice_path: string | null; response_voice_path: string | null; created_at: string; updated_at?: string };
type Notice = { id: string; message: string; created_at: string; read_at: string | null; kind?: string | null };
type OfficeHour = { id: string; faculty_id: string; weekday: number; start_time: string; end_time: string; timezone: string };
type Usage = PilotUsage;
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const labels = { available: "Available", busy: "Busy", away: "Away" } as const;
const descriptions = { available: "Open to meet now", busy: "Busy now; students can still ask for later", away: "Away from campus meetings" } as const;
const signupEnabled = process.env.NEXT_PUBLIC_BMSIT_SIGNUP_ENABLED === "true";
const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const workspaceTabs = new Set(["home", "day", "notices", "events", "requests", "timing", "updates", "admin"]);
const tabStorageKey = (userId: string) => `campuspulse.tab.${userId}`;
function readWorkspaceTab(userId?: string | null, fallback = "day") {
  if (typeof window === "undefined") return fallback;
  const fromHash = window.location.hash.replace(/^#/, "");
  if (workspaceTabs.has(fromHash)) return fromHash;
  if (!userId) return fallback;
  try {
    const saved = sessionStorage.getItem(tabStorageKey(userId));
    if (saved && workspaceTabs.has(saved)) return saved;
  } catch { /* tab simply is not remembered */ }
  return fallback;
}
function roleHomeTab(role?: string | null) {
  if (role === "faculty" || role === "admin") return "home";
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
  const [requestRows, setRequests] = useState<Request[]>([]); const [requestsLoadError, setRequestsLoadError] = useState<string | null>(null); const [notices, setNotices] = useState<Notice[]>([]);
  const [hours, setHours] = useState<OfficeHour[]>([]); const [hoursReady, setHoursReady] = useState(false);
  const [adminReady, setAdminReady] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledStatus[]>([]); const [scheduleReady, setScheduleReady] = useState(false); const [scheduleReliable, setScheduleReliable] = useState(false);
  const [scheduledChoice, setScheduledChoice] = useState<MeetingStatus>("available"); const [scheduleStart, setScheduleStart] = useState(""); const [scheduleEnd, setScheduleEnd] = useState("");
  const [weekday, setWeekday] = useState(1); const [hourStart, setHourStart] = useState("10:00"); const [hourEnd, setHourEnd] = useState("11:00");
  const [timezone, setTimezone] = useState("UTC");
  const [department, setDepartment] = useState(""); const [statusFilter, setStatusFilter] = useState("all");
  const [listMode, setListMode] = useState<"recent" | "all" | "available" | "pinned">("all");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [waitingPlaces, setWaitingPlaces] = useState<Record<string, WaitingPlace>>({});
  const [openFollowups, setOpenFollowups] = useState<{ student_id: string; title: string; due_at: string }[]>([]);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [cachedPresence, setCachedPresence] = useState<Record<string, CachedPresence>>({});
  const [directoryScope, setDirectoryScope] = useState<"faculty" | "students">("faculty");
  const [emailById, setEmailById] = useState<Record<string, string>>({});
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  const [leaveDays, setLeaveDays] = useState<FacultyLeaveDay[]>([]);
  const [leaveTick, setLeaveTick] = useState(0);
  const [walkInDraft, setWalkInDraft] = useState("");
  const [waitingCap, setWaitingCap] = useState<number | null>(5);
  const [retentionDays, setRetentionDays] = useState<number | null>(45);
  const [privacyRows, setPrivacyRows] = useState<AdminPrivacyRow[]>([]);
  const [adminPeopleRows, setAdminPeopleRows] = useState<AdminProfile[]>([]);
  const [adminPeopleTotal, setAdminPeopleTotal] = useState(0);
  const [adminPeopleLoading, setAdminPeopleLoading] = useState(false);
  const [askWeekdaySummary, setAskWeekdaySummary] = useState<{ label: string; count: number }[] | null>(null);
  const [openStatusNudges, setOpenStatusNudges] = useState<{ id: string; faculty_id: string; student_id: string; expires_at: string }[]>([]);
  const [tab, setTab] = useState(() => readWorkspaceTab(null)); const [search, setSearch] = useState("");
  const [updateSearch, setUpdateSearch] = useState("");
  const [updateDay, setUpdateDay] = useState(() => startOfLocalDay());
  const [updateScope, setUpdateScope] = useState<"day" | "all">("all");
  const [updateKind, setUpdateKind] = useState<"notice" | "all" | "meeting" | "event">("notice");
  function goToTab(id: string) {
    setTab(id);
    if (sessionUser.current) writeWorkspaceTab(sessionUser.current, id);
    setTarget("");
    if (!working) changeRequestVoice(null);
    setError("");
    setMessage("");
  }
  const [duration, setDuration] = useState(480); const [target, setTarget] = useState("");
  const [expertiseDraft, setExpertiseDraft] = useState("");
  const [portfolioDraft, setPortfolioDraft] = useState("");
  const [officeDraft, setOfficeDraft] = useState("");
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
      supabase.from("profiles").select("id,name,role,department,office_location,expertise,portfolio,active,pause_requests,quiet_start,quiet_end,reply_snippets,auto_busy_outside_hours").abortSignal(controller.signal),
      supabase.from("availability").select("faculty_id,status,updated_at,expires_at,walk_in_note").abortSignal(controller.signal),
      supabase.from("meeting_requests").select("id,student_id,faculty_id,reason,preferred_time,status,response_note,request_voice_path,response_voice_path,requested_for,meeting_at,purge_after,created_at,updated_at").order("created_at", { ascending: false }).abortSignal(controller.signal),
      supabase.from("notifications").select("id,message,created_at,read_at,kind").order("created_at", { ascending: false }).abortSignal(controller.signal).limit(100),
      supabase.from("office_hours").select("id,faculty_id,weekday,start_time,end_time,timezone").order("weekday").order("start_time").abortSignal(controller.signal),
      supabase.rpc("is_institution_admin").abortSignal(controller.signal),
      supabase.from("scheduled_status").select("faculty_id,status,starts_at,expires_at").order("starts_at", {ascending:false}).abortSignal(controller.signal)
    ]).catch(() => null).finally(() => clearTimeout(timeout));
    if (accountVersion !== sessionVersion.current || fullVersion !== fullRequest.current) return;
    if (!results) { setScheduleReliable(false); noteRefreshError("Could not connect. Check your connection and try again."); setProfileLoaded(true); return; }
    const nextProfiles = ((results[0].data ?? []) as Profile[]).map(person => ({
      ...person,
      expertise: person.expertise ?? "",
      portfolio: person.portfolio ?? "",
      pause_requests: !!person.pause_requests,
      quiet_start: person.quiet_start ?? null,
      quiet_end: person.quiet_end ?? null,
      reply_snippets: Array.isArray(person.reply_snippets) ? person.reply_snippets : [],
      auto_busy_outside_hours: !!person.auto_busy_outside_hours,
    }));
    const userId = sessionUser.current ?? "";
    const failure = results.slice(1, 4).find(r => r.error)?.error;
    const plan = campusRefreshPlan(campusView.current, nextProfiles, userId, Boolean(results[0].error), Boolean(failure));
    // Revalidate access before keeping any cached campus data visible.
    if (plan === "revoke") {
      campusView.current = null;
      setProfiles([]); setRequests([]); setRequestsLoadError(null); setNotices([]); setHours([]); setAvailability([]); setScheduled([]); setScheduleReliable(false); setWaiting({});
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
      setRequestsLoadError(results[2].error ? (results[2].error.message || "Could not load meeting requests.") : null);
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
    setRequests(results[2].error ? [] : (results[2].data ?? []) as Request[]);
    setRequestsLoadError(results[2].error ? (results[2].error.message || "Could not load meeting requests.") : null);
    setNotices(results[3].error ? [] : (results[3].data ?? []) as Notice[]);
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
        supabase.from("availability").select("faculty_id,status,updated_at,expires_at,walk_in_note").abortSignal(controller.signal),
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
    if (!me || me.role !== "faculty") return;
    setExpertiseDraft(me.expertise || "");
    setPortfolioDraft(me.portfolio || "");
    setOfficeDraft(me.office_location || "");
  }, [me?.id, me?.role, me?.expertise, me?.portfolio, me?.office_location]);
  useEffect(() => {
    if (!me || me.role !== "faculty") { setWalkInDraft(""); return; }
    const row = availability.find(item => item.faculty_id === me.id);
    const live = row && Date.parse(row.expires_at) > Date.now() && row.status === "available";
    setWalkInDraft(live ? (row.walk_in_note || "").trim() : "");
  }, [me?.id, me?.role, availability]);
  useEffect(() => {
    if (!supabase || !me || me.role !== "faculty") return;
    const client = supabase;
    const userId = me.id;
    const applyFromNotification = async (status: "available" | "busy" | "away", nudgeId: string | null) => {
      const run = nudgeId
        ? () => client.rpc("respond_status_nudge", { p_nudge: nudgeId, p_status: status })
        : () => client.rpc("set_availability", { p_status: status, p_duration_minutes: 480 });
      const ok = await action(run, `Status updated to ${labels[status]}.`);
      if (!ok) return;
      setOpenStatusNudges(previous => nudgeId
        ? previous.filter(row => row.id !== nudgeId)
        : previous.filter(row => row.faculty_id !== userId));
      await refreshStatuses();
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; status?: string; nudgeId?: string | null } | null;
      if (!data || !["STATUS_APPLIED", "APPLY_STATUS_ACTION"].includes(data.type || "")) return;
      if (!data.status || !["available", "busy", "away"].includes(data.status)) return;
      if (data.type === "STATUS_APPLIED") {
        setOpenStatusNudges(previous => data.nudgeId
          ? previous.filter(row => row.id !== data.nudgeId)
          : previous.filter(row => row.faculty_id !== userId));
        setMessage(`Status updated to ${labels[data.status as "available" | "busy" | "away"]}.`);
        void refreshStatuses();
        return;
      }
      void applyFromNotification(data.status as "available" | "busy" | "away", data.nudgeId ?? null);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    try {
      const params = new URLSearchParams(window.location.search);
      const statusAction = params.get("statusAction");
      const nudge = params.get("nudge");
      if (statusAction && ["available", "busy", "away"].includes(statusAction)) {
        params.delete("statusAction");
        params.delete("nudge");
        const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
        window.history.replaceState({}, "", next);
        void applyFromNotification(statusAction as "available" | "busy" | "away", nudge);
      }
    } catch { /* Deep-link apply is optional. */ }
    return () => { navigator.serviceWorker?.removeEventListener("message", onMessage); };
    // action / refreshStatuses are stable enough for this session-scoped listener.
  }, [me?.id, me?.role]);
  useEffect(() => {
    if (!me) return;
    const allowed = me.role === "faculty"
      ? ["home", "day", "notices", "events", "requests", "timing", "updates"]
      : me.role === "admin"
        ? ["home", "notices", "events", "admin", "updates"]
        : ["home", "day", "notices", "events", "requests", "updates"];
    const next = allowed.includes(tab) ? tab : roleHomeTab(me.role);
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
        setRequests([]); setRequestsLoadError(null); setNotices([]); setScheduled([]); setScheduleReady(false); setScheduleReliable(false);
        setDepartment(""); setStatusFilter("all"); setListMode("recent"); setRecentIds([]); setWaiting({}); setAdminReady(false); setUsage(null); setSearch("");
        setTarget(""); setReason(""); setPreferred(EMPTY_MEETING_TIME); setNotes({});
        setDuration(480); setExpertiseDraft(""); setPortfolioDraft(""); setOfficeDraft("");
        setScheduleStart(""); setScheduleEnd(""); setScheduledChoice("available"); setError(""); setMessage(""); setWorking(false); setEmail(""); setPassword("");
        // Keep the open section across reload; only reset when the signed-in person changes.
        if (previousUser && nextUser && previousUser !== nextUser) setTab("");
        else if (nextUser) {
          const restored = readWorkspaceTab(nextUser, "");
          setTab(restored);
          if (restored) writeWorkspaceTab(nextUser, restored);
        } else setTab("");
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
  useEffect(() => {
    if (!me || !supabase) { setLeaveDays([]); return; }
    if (me.role !== "faculty") { setLeaveDays([]); return; }
    const accountVersion = sessionVersion.current;
    let active = true;
    void supabase.from("faculty_leave_days").select("id,leave_on,note").eq("faculty_id", me.id).order("leave_on").then(({ data, error }) => {
      if (!active || accountVersion !== sessionVersion.current || error) return;
      setLeaveDays((data ?? []).map(row => ({ id: String(row.id), leave_on: String(row.leave_on), note: String(row.note ?? "") })));
    });
    return () => { active = false; };
  }, [me?.id, me?.role, leaveTick, Math.floor(now / 60000)]);
  useEffect(() => {
    if (me?.role !== "admin" || !adminReady || !supabase) { setWaitingCap(5); setPrivacyRows([]); return; }
    const accountVersion = sessionVersion.current;
    let active = true;
    void supabase.rpc("get_institution_settings").then(({ data, error }) => {
      if (!active || accountVersion !== sessionVersion.current || error) return;
      const row = Array.isArray(data) ? data[0] as { waiting_cap?: number; retention_days?: number } | undefined : data as { waiting_cap?: number; retention_days?: number } | null;
      if (row?.waiting_cap) setWaitingCap(Number(row.waiting_cap));
      if (row?.retention_days) setRetentionDays(Number(row.retention_days));
    });
    void supabase.from("privacy_requests").select("id,user_id,kind,note,created_at,status").eq("status", "open").order("created_at", { ascending: false }).then(({ data, error }) => {
      if (!active || accountVersion !== sessionVersion.current || error || !Array.isArray(data)) return;
      setPrivacyRows(data.map(row => ({
        id: String(row.id),
        user_id: String(row.user_id),
        kind: row.kind as "export" | "delete",
        note: String(row.note ?? ""),
        created_at: String(row.created_at),
        requester_name: profiles.find(person => person.id === row.user_id)?.name,
      })));
    });
    return () => { active = false; };
  }, [me?.role, adminReady, profiles.length, Math.floor(now / 60000)]);
  useEffect(() => {
    if (me?.role !== "admin" || !adminReady || !supabase) { setEmailById({}); return; }
    const accountVersion = sessionVersion.current;
    let active = true;
    void supabase.rpc("admin_people_directory").then(({ data, error }) => {
      if (!active || accountVersion !== sessionVersion.current || error || !Array.isArray(data)) return;
      const next: Record<string, string> = {};
      for (const row of data as { id: string; email: string }[]) {
        if (row.id && row.email) next[row.id] = row.email;
      }
      setEmailById(next);
    });
    return () => { active = false; };
  }, [me?.role, adminReady, profiles.length]);
  const queryAdminPeople = useCallback((query: PeopleQuery) => {
    if (!supabase || me?.role !== "admin" || !adminReady) return;
    const accountVersion = sessionVersion.current;
    setAdminPeopleLoading(true);
    const p_role = query.role === "all" ? null : query.role;
    const p_active = query.status === "all" ? null : query.status === "active";
    void supabase.rpc("admin_people_search", {
      p_query: query.search,
      p_role,
      p_active,
      p_limit: 50,
      p_offset: query.page * 50,
    }).then(({ data, error }) => {
      if (accountVersion !== sessionVersion.current) return;
      setAdminPeopleLoading(false);
      if (error || !Array.isArray(data)) {
        setAdminPeopleRows([]);
        setAdminPeopleTotal(0);
        return;
      }
      type SearchPerson = { id: string; name: string; role: string; department: string; email: string; active: boolean; total_count: number };
      const rows = (data as SearchPerson[]).map(row => ({
        id: String(row.id),
        name: String(row.name),
        role: row.role as AdminProfile["role"],
        department: String(row.department ?? ""),
        email: String(row.email ?? ""),
        active: !!row.active,
      }));
      setAdminPeopleRows(rows);
      setAdminPeopleTotal(data.length ? Number((data[0] as SearchPerson).total_count ?? 0) : 0);
      setEmailById(previous => {
        const next = { ...previous };
        for (const row of data as SearchPerson[]) if (row.id && row.email) next[row.id] = row.email;
        return next;
      });
    });
  }, [me?.role, adminReady]);
  useEffect(() => {
    if (!supabase || me?.role !== "faculty" || tab !== "timing") return;
    const accountVersion = sessionVersion.current;
    let active = true;
    void supabase.rpc("faculty_ask_weekday_summary").then(({ data, error }) => {
      if (!active || accountVersion !== sessionVersion.current || error) return;
      setAskWeekdaySummary(Array.isArray(data) ? data as { label: string; count: number }[] : []);
    });
    return () => { active = false; };
  }, [me?.role, tab, Math.floor(now / 300000)]);
  useEffect(() => {
    if (!supabase || !me || (me.role !== "faculty" && me.role !== "student")) {
      setOpenStatusNudges([]);
      return;
    }
    const accountVersion = sessionVersion.current;
    let active = true;
    void supabase.from("status_nudges")
      .select("id,faculty_id,student_id,expires_at")
      .eq("status", "open")
      .gt("expires_at", new Date(now || Date.now()).toISOString())
      .then(({ data, error }) => {
        if (!active || accountVersion !== sessionVersion.current || error || !Array.isArray(data)) return;
        setOpenStatusNudges(data.map(row => ({
          id: String(row.id),
          faculty_id: String(row.faculty_id),
          student_id: String(row.student_id),
          expires_at: String(row.expires_at),
        })));
      });
    return () => { active = false; };
  }, [me?.id, me?.role, Math.floor(now / 30000), notices.length, availability.length]);
  useEffect(() => {
    if (!supabase || me?.role !== "student") { setWaitingPlaces({}); return; }
    const accountVersion = sessionVersion.current;
    let active = true;
    void supabase.rpc("student_waiting_places").then(({ data, error }) => {
      if (!active || accountVersion !== sessionVersion.current || error || !Array.isArray(data)) return;
      const next: Record<string, WaitingPlace> = {};
      for (const row of data as { faculty_id: string; waiting: number; my_place: number | null; cap: number }[]) {
        next[String(row.faculty_id)] = {
          waiting: Number(row.waiting) || 0,
          myPlace: row.my_place == null ? null : Number(row.my_place),
          cap: Number(row.cap) || waitingCap || 5,
        };
      }
      setWaitingPlaces(next);
    });
    return () => { active = false; };
  }, [me?.id, me?.role, Math.floor(now / 30000), waiting, waitingCap]);
  useEffect(() => {
    if (!supabase || me?.role !== "faculty") { setOpenFollowups([]); return; }
    const accountVersion = sessionVersion.current;
    let active = true;
    void supabase.rpc("faculty_open_followups").then(({ data, error }) => {
      if (!active || accountVersion !== sessionVersion.current || error || !Array.isArray(data)) return;
      setOpenFollowups(data.map(row => ({
        student_id: String((row as { student_id: string }).student_id),
        title: String((row as { title: string }).title),
        due_at: String((row as { due_at: string }).due_at),
      })));
    });
    return () => { active = false; };
  }, [me?.id, me?.role, Math.floor(now / 60000), requests.length]);
  useEffect(() => {
    if (!me || !scheduleReliable || !availability.length) return;
    const byFaculty: Record<string, CachedPresence> = {};
    for (const person of profiles.filter(p => p.role === "faculty" && p.active)) {
      const presence = campusPresence(
        availability.find(item => item.faculty_id === person.id),
        scheduled.find(item => item.faculty_id === person.id && Date.parse(item.starts_at) <= now),
        hoursReady ? hours.filter(item => item.faculty_id === person.id) : [],
        now,
        !!person.auto_busy_outside_hours,
      );
      byFaculty[person.id] = { status: presence.status, updatedAt: new Date(now).toISOString() };
    }
    setCachedPresence(byFaculty);
    writeStatusCache(me.id, byFaculty);
  }, [me?.id, scheduleReliable, availability, scheduled, hours, hoursReady, profiles, now]);
  const facultySuggestPool = useMemo(
    () => profiles.filter(person => person.active && person.role === "faculty"),
    [profiles],
  );
  const statusStale = !networkOnline || !scheduleReliable;
  const directoryAvailability = useMemo(() => {
    if (!statusStale || !Object.keys(cachedPresence).length) return availability;
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return Object.entries(cachedPresence)
      .filter(([, value]) => value.status)
      .map(([faculty_id, value]) => ({
        faculty_id,
        status: value.status as "available" | "busy" | "away",
        updated_at: value.updatedAt,
        expires_at: expires,
        walk_in_note: availability.find(row => row.faculty_id === faculty_id)?.walk_in_note || "",
      }));
  }, [statusStale, cachedPresence, availability]);
  const faculty = useMemo(() => {
    const autoBusy = (id: string) => !!profiles.find(person => person.id === id)?.auto_busy_outside_hours;
    const statusOf = (id: string) => campusPresence(
      scheduleReliable ? availability.find(item => item.faculty_id === id) : undefined,
      scheduleReliable ? scheduled.find(item => item.faculty_id === id && Date.parse(item.starts_at) <= now) : undefined,
      hoursReady ? hours.filter(item => item.faculty_id === id) : [],
      now,
      autoBusy(id),
    );
    const query = search.trim().toLowerCase();
    const byDepartment = profiles.filter(person => {
      if (!person.active || person.role !== "faculty") return false;
      if (department && person.department !== department) return false;
      return true;
    });
    const matched = byDepartment.filter(person => `${person.name} ${person.department} ${person.expertise || ""} ${person.portfolio || ""} ${emailById[person.id] || ""}`.toLowerCase().includes(query));
    if (query) return matched;
    if (listMode === "pinned") {
      const pinned = favoriteIds
        .map(id => matched.find(person => person.id === id) || facultySuggestPool.find(person => person.id === id))
        .filter((person): person is Profile => !!person);
      return pinned;
    }
    const met = new Set(requests.filter(row => row.student_id === me?.id).map(row => row.faculty_id));
    return directoryFaculty(matched, listMode, new Set(recentIds), met, id => statusOf(id).status === "available", id => waiting[id] ?? 0);
  }, [profiles, search, department, listMode, recentIds, favoriteIds, facultySuggestPool, scheduleReliable, availability, scheduled, now, hours, hoursReady, me, requests, waiting, emailById]);
  const lastReplyById = useMemo(() => {
    const next: Record<string, string> = {};
    for (const row of requestRows) {
      if (!["accepted", "alternative"].includes(row.status)) continue;
      const stamp = row.updated_at || row.created_at;
      const previous = next[row.faculty_id];
      if (!previous || Date.parse(stamp) > Date.parse(previous)) next[row.faculty_id] = stamp;
    }
    return next;
  }, [requestRows]);
  const departmentOptions = useMemo(
    () => [...new Set(profiles.filter(person => person.role === "faculty").map(person => person.department).filter(Boolean))].sort(),
    [profiles],
  );
  useEffect(() => {
    if (!me) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`campuspulse.recent.${me.id}`) || "[]");
      setRecentIds(Array.isArray(saved) ? saved.filter((item: unknown) => typeof item === "string") : []);
    } catch { setRecentIds([]); }
    setFavoriteIds(readFavoriteFaculty(me.id));
    const cache = readStatusCache(me.id);
    if (cache?.byFaculty) setCachedPresence(cache.byFaculty);
  }, [me?.id]);
  useEffect(() => {
    const sync = () => setNetworkOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  useEffect(() => {
    const query = search.trim().toLowerCase();
    if (!me || query.length < 2) return;
    const ids = profiles.filter(person => person.active && person.role === "faculty" && `${person.name} ${person.department} ${person.expertise || ""} ${person.portfolio || ""}`.toLowerCase().includes(query)).map(person => person.id);
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
  async function action(fn: () => PromiseLike<{ error: { message: string } | null }>, success: string | (() => string)) {
    const accountVersion = sessionVersion.current;
    setError(""); setMessage(""); setWorking(true);
    try { const result = await fn(); if (accountVersion !== sessionVersion.current) return false; if (result.error) { setError(result.error.message); return false; } setMessage(typeof success === "function" ? success() : success); await load(); return accountVersion === sessionVersion.current; }
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
    if (reason.trim()) rememberFacultyReason(me.id, target, reason);
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
  async function sendResponse(request: string, status: string, noteOverride?: string) {
    if (!supabase || !me || captureId) return;
    const voice = replyVoices[request]; const note = noteOverride !== undefined ? (noteOverride || null) : (notes[request] || null);
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
  async function batchAlternative(ids: string[]) {
    if (!supabase || !me || captureId) return;
    const draft = ids.map(id => alternativeTimes[id]).find(item => item?.iso) ?? EMPTY_MEETING_TIME;
    if (!draft.iso) {
      setError("Pick an alternative time on one selected request before suggesting another time for all.");
      return;
    }
    let alternativeAt: string;
    try { alternativeAt = localMeetingIso(draft.iso); } catch {
      setError(draft.error || "Type a future alternative date and time before suggesting it.");
      return;
    }
    for (const id of ids) {
      const voice = replyVoices[id];
      const note = notes[id] || null;
      const version = sessionVersion.current;
      const user = me.id;
      const abort = new AbortController();
      voiceOperation.current = abort;
      const timer = setTimeout(() => abort.abort(), 30000);
      const ok = await action(async () => {
        const path = voice ? await uploadVoice(supabase!, user, voice, abort.signal) : null;
        if (version !== sessionVersion.current || abort.signal.aborted) throw new Error("Account changed");
        return supabase!.rpc("respond_to_timed_request", {
          p_request: id,
          p_status: "alternative",
          p_note: note,
          p_voice_path: path,
          p_alternative_at: alternativeAt,
        }).abortSignal(abort.signal);
      }, "Responses saved.");
      clearTimeout(timer);
      if (ok) {
        setReplyVoices(previous => ({ ...previous, [id]: null }));
        setNotes(previous => ({ ...previous, [id]: "" }));
        setAlternativeTimes(previous => ({ ...previous, [id]: EMPTY_MEETING_TIME }));
      }
    }
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
    if (!isValidEmail(email)) { setError("Enter a valid email address."); return; }
    setError(""); setMessage(""); setWorking(true);
    try {
      const {error: signupError} = await supabase.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:`${window.location.origin}/software/`}});
      if (signupError) setError(signupError.message);
      else { setPassword(""); setMessage("Check your campus email for a confirmation link. Prefer an admin invite when available so your campus profile is ready when you sign in."); }
    } catch { setError("Could not connect. Check your connection and try again."); }
    finally { setWorking(false); }
  }
  if (!supabase) return <main className={styles.shell}><div className={styles.setup}><span className={styles.eyebrow}>CAMPUSPULSE · BY SYGNETTA</span><h1>Let’s connect your campus.</h1><p>This app needs a Supabase project before sign-in and shared data can work. Follow the setup instructions in the project documentation.</p><p className={styles.muted}>No demo data is presented as real availability.</p></div></main>;
  if (loading || !session) return <ViewTransition enter="campus-arrive" exit="campus-leave" default="none"><main className={styles.loginPage}><section className={styles.loginIntro} aria-labelledby="campus-intro"><p className={styles.eyebrow}>CAMPUSPULSE · BY SYGNETTA</p><h1 id="campus-intro">See your college.</h1><p>Faculty names stay inside your college.</p><ol><li><strong>Sign in.</strong> Your college only.</li><li><strong>Check a status.</strong> Available, busy, or away.</li><li><strong>Request a time.</strong> A note, or a short recording.</li></ol></section><div className={styles.loginCard}><WorkspaceBrand/><h2>{authMode === "login" ? "Sign in" : "Create an account"}</h2><form onSubmit={authMode === "login" ? signIn : signUp}><label>Campus email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" disabled={loading} /></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={authMode === "signup" ? 8 : undefined} autoComplete={authMode === "signup" ? "new-password" : "current-password"} disabled={loading} /></label><button className={styles.primary} disabled={loading || working}>{authMode === "login" ? "Sign in" : "Create account"}</button></form><p><a className={styles.link} href="/software/reset/">Forgot your password?</a></p>{error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}{signupEnabled && <button type="button" className={styles.link} onClick={() => {setAuthMode(authMode === "login" ? "signup" : "login");setError("");setMessage("");setPassword("");}}>{authMode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button>}<p><a className={styles.link} href="/software/install/">Install on your phone</a></p><p><a className={styles.link} href="/software/help/">Help & privacy</a></p><p><small>Ask your admin for an invite. Open the email, set a password, then sign in. Self-signup is closed for campus safety.</small></p></div></main></ViewTransition>;
  if (!me && !profileLoaded) return <WorkspaceLoading />;
  if (!me) return <main className={styles.shell}><div className={styles.setup}><WorkspaceBrand /><span className={styles.eyebrow}>CAMPUSPULSE · BY SYGNETTA</span><h1>Account not ready</h1><p>{error ? "We couldn’t load your account. Check your connection or contact your administrator." : "Your account does not have an active campus profile. Contact your administrator."}</p>{error && <p role="alert">{error}</p>}<div className={styles.actions}><button onClick={() => {setProfileLoaded(false);void load();}}>Try again</button><button onClick={() => supabase!.auth.signOut({scope:"local"})}>Sign out</button></div></div></main>;
  const tabs = me.role === "faculty" ? [["home", "Overview"], ["day", "My day"], ["notices", "Notices"], ["events", "Events"], ["requests", "Requests"], ["timing", "Availability settings"], ["updates", "Updates"]] : me.role === "admin" ? [["home", "Directory"], ["notices", "Notices"], ["events", "Events"], ["admin", "Manage people"], ["updates", "Updates"]] : [["home", "Find faculty"], ["day", "My day"], ["notices", "Notices"], ["events", "Events"], ["requests", "My requests"], ["updates", "Updates"]];
  const allowedTabs = new Set(tabs.map(([id]) => id));
  const activeTab = allowedTabs.has(tab) ? tab : roleHomeTab(me.role);
  const name = (id: string) => profiles.find(p => p.id === id)?.name ?? "Campus member";
  const latestReply = requestRows.find(row => row.student_id === me.id && ["accepted", "declined", "alternative"].includes(row.status));
  const mine = campusPresence(
    scheduleReliable ? own : undefined,
    scheduleReliable ? scheduled.find(item => item.faculty_id === me.id && Date.parse(item.starts_at) <= now) : undefined,
    hoursReady ? hours.filter(item => item.faculty_id === me.id) : [],
    now,
    !!me.auto_busy_outside_hours,
  );
  const facultyOpenNudge = me.role === "faculty"
    ? openStatusNudges.find(row => row.faculty_id === me.id && Date.parse(row.expires_at) > now)
    : undefined;
  const facultyNudgeCard: OpenStatusNudge | null = facultyOpenNudge
    ? {
        id: facultyOpenNudge.id,
        student_id: facultyOpenNudge.student_id,
        studentName: name(facultyOpenNudge.student_id),
        expires_at: facultyOpenNudge.expires_at,
      }
    : null;
  const askedNudgeFaculty: Record<string, true> = {};
  const blockedNudgeFaculty: Record<string, true> = {};
  if (me.role === "student") {
    for (const row of openStatusNudges) {
      if (Date.parse(row.expires_at) <= now) continue;
      if (row.student_id === me.id) askedNudgeFaculty[row.faculty_id] = true;
      else blockedNudgeFaculty[row.faculty_id] = true;
    }
  }
  const myHours = hoursReady ? hours.filter(item => item.faculty_id === me.id) : [];
  const nextOffice = myHours.length ? nextOfficeSlots(myHours, now || Date.now(), 1)[0] : undefined;
  const leaveToday = leaveDays.some(day => {
    const leaveOn = day.leave_on.slice(0, 10);
    const today = new Date(now || Date.now());
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return leaveOn === stamp;
  });
  const minutesUntil = (iso: string) => Math.max(15, Math.ceil((Date.parse(iso) - (now || Date.now())) / 60000));
  const statusPresets = me.role === "faculty" ? [
    {
      label: nextOffice ? `Busy until ${nextOffice.label}` : "Busy until next office hour",
      disabled: !nextOffice,
      onApply: () => {
        if (!nextOffice) return;
        const keepNote = walkInDraft.trim().slice(0, 120);
        void action(
          () => supabase!.rpc("set_availability", { p_status: "busy", p_duration_minutes: minutesUntil(nextOffice.at), p_walk_in_note: keepNote }),
          keepNote ? `Busy until ${nextOffice.label} · note kept.` : `Busy until ${nextOffice.label}.`,
        ).then(ok => { if (ok) setOpenStatusNudges(previous => previous.filter(row => row.faculty_id !== me.id)); });
      },
    },
    {
      label: leaveToday ? "Away for leave day" : "Away for rest of day",
      onApply: () => {
        void action(
          () => supabase!.rpc("set_availability", { p_status: "away", p_duration_minutes: 480, p_walk_in_note: "" }),
          leaveToday ? "Away for leave day." : "Away for the rest of the day.",
        ).then(ok => { if (ok) { setWalkInDraft(""); setOpenStatusNudges(previous => previous.filter(row => row.faculty_id !== me.id)); } });
      },
    },
  ] : undefined;
  const setFacultyStatus = (status: MeetingStatus, note?: string) => {
    const walkNote = status === "away" ? "" : (note ?? walkInDraft).trim().slice(0, 120);
    void action(
      () => supabase!.rpc("set_availability", { p_status: status, p_duration_minutes: 480, p_walk_in_note: walkNote }),
      walkNote && status !== "away" ? `${labels[status]} · note saved.` : labels[status],
    ).then(ok => {
      if (!ok) return;
      setWalkInDraft(walkNote);
      setOpenStatusNudges(previous => previous.filter(row => row.faculty_id !== me.id));
    });
  };
  const facultyControls = me.role === "faculty" ? <FacultySwitch
    presence={mine}
    working={working || !!captureId}
    walkInNote={walkInDraft}
    onWalkInNote={setWalkInDraft}
    onSet={setFacultyStatus}
    onHours={() => goToTab("timing")}
    presets={statusPresets}
  /> : null;
  const replyLine = latestReply && me.role === "student" ? <ReplyLine status={latestReply.status} when={date(latestReply.meeting_at || latestReply.requested_for || latestReply.created_at)} person={name(latestReply.faculty_id)} /> : null;
  const facultyPending = me.role === "faculty"
    ? requests.filter(row => row.faculty_id === me.id && row.status === "pending")
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map(row => ({
        id: row.id,
        studentName: name(row.student_id),
        when: date(row.meeting_at || row.requested_for || row.created_at),
        reason: row.reason,
      }))
    : [];
  const hourLocal = new Date(now || Date.now()).getHours();
  const dayWrap = me.role === "faculty" && hourLocal >= 16
    ? { pending: facultyPending.length, nudges: openStatusNudges.filter(row => row.faculty_id === me.id && Date.parse(row.expires_at) > now).length }
    : null;
  const studentContextById: Record<string, { lastLine?: string; followups?: string[]; meetingToday?: boolean }> = (() => {
    if (me.role !== "faculty") return {};
    const day = startOfLocalDay();
    const next: Record<string, { lastLine?: string; followups?: string[]; meetingToday?: boolean }> = {};
    for (const row of requests) {
      if (row.faculty_id !== me.id) continue;
      const prior = row.status !== "pending";
      if (prior) {
        const stamp = date(row.meeting_at || row.updated_at || row.created_at);
        const label = row.status === "accepted" ? "Last meeting accepted" : row.status === "declined" ? "Last ask declined" : row.status === "alternative" ? "Last ask: another time" : "Prior request";
        if (!next[row.student_id]?.lastLine) next[row.student_id] = { ...next[row.student_id], lastLine: `${label} · ${stamp}` };
      }
      if (["accepted", "alternative"].includes(row.status) && row.meeting_at && isSameLocalDay(row.meeting_at, day)) {
        next[row.student_id] = { ...next[row.student_id], meetingToday: true };
      }
    }
    for (const item of openFollowups) {
      const bucket = next[item.student_id] || {};
      const list = bucket.followups ? [...bucket.followups, item.title] : [item.title];
      next[item.student_id] = { ...bucket, followups: list.slice(0, 3) };
    }
    return next;
  })();
  const facultyToday = (() => {
    if (me.role !== "faculty") return [];
    const day = startOfLocalDay();
    const items: { key: string; kind: string; title: string; when: string; at: number }[] = [];
    requests.forEach(meeting => {
      if (meeting.faculty_id !== me.id || !meeting.meeting_at || !isSameLocalDay(meeting.meeting_at, day)) return;
      if (meeting.status === "pending") items.push({ key: `wait-${meeting.id}`, kind: "Waiting", title: `Waiting on ${name(meeting.student_id)}`, when: date(meeting.meeting_at), at: Date.parse(meeting.meeting_at) });
      else if (["accepted", "alternative", "expired"].includes(meeting.status)) items.push({ key: `meet-${meeting.id}`, kind: meeting.status === "alternative" ? "Another time" : "Meeting", title: `Meet ${name(meeting.student_id)}`, when: date(meeting.meeting_at), at: Date.parse(meeting.meeting_at) });
    });
    hours.filter(hour => hour.faculty_id === me.id && hour.weekday === day.getDay()).forEach(hour => {
      const [hh, mm] = hour.start_time.split(":");
      const at = new Date(day);
      at.setHours(Number(hh), Number(mm), 0, 0);
      items.push({ key: `hours-${hour.id}`, kind: "Hours", title: "Office hours", when: `${hour.start_time.slice(0, 5)}-${hour.end_time.slice(0, 5)}`, at: at.getTime() });
    });
    return items.sort((a, b) => a.at - b.at).slice(0, 2).map(({ key, kind, title, when }) => ({ key, kind, title, when }));
  })();
  return <Workspace name={me.name} role={me.role} detail={me.department} active={activeTab} tabs={tabs.map(([id,title]) => ({id,title,count:id === "requests" && me.role === "faculty" ? requests.filter(r => r.status === "pending").length : id === "updates" ? notices.filter(n => !n.read_at).length : undefined}))} onNavigate={goToTab} onSignOut={() => { void supabase!.auth.signOut({ scope: "local" }); }} profile={({ close }) => me.role === "faculty" ? (
      <form className={styles.profileEdit} onSubmit={e => {
        e.preventDefault();
        void action(
          () => supabase!.rpc("update_faculty_profile", { p_expertise: expertiseDraft, p_portfolio: portfolioDraft, p_office: officeDraft }),
          "Profile updated.",
        ).then(ok => { if (ok) { close(); void load(); } });
      }}>
        <p className={styles.muted}>Students search these fields when finding someone to meet.</p>
        <label>Expertise areas<input value={expertiseDraft} maxLength={400} onChange={e => setExpertiseDraft(e.target.value)} placeholder="For example: machine learning, databases, computer networks" /></label>
        <label>Short portfolio<textarea value={portfolioDraft} maxLength={800} onChange={e => setPortfolioDraft(e.target.value)} placeholder="A short note about your work, courses, or research." /></label>
        <label>Cabin / office<input value={officeDraft} maxLength={120} onChange={e => setOfficeDraft(e.target.value)} placeholder="Optional cabin or office" /></label>
        <div className={styles.actions}><button className={styles.primary} disabled={working} type="submit">Save profile</button></div>
      </form>
    ) : <p className={styles.muted}>Your campus role and department are managed by your administrator.</p>}>
    <main className={styles.main} id="workspace-content" tabIndex={-1} key={activeTab}>{error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}
    <CampusAlerts userId={me.id} />
    {activeTab === "day" && me.role !== "admin" && <MyDay role={me.role} userId={me.id} meetings={requests} names={name} officeHours={hours.filter(hour => hour.faculty_id === me.id)} lead={replyLine} />}
    {activeTab === "notices" && <CampusNotices isAdmin={me.role === "admin"} userId={me.id} people={profiles.map(person => ({ ...person, email: emailById[person.id] }))} departments={[...new Set(profiles.map(person => person.department))].filter(Boolean).sort()} homeDepartment={me.department || ""} />}
    {activeTab === "events" && <ClubEvents role={me.role} isAdmin={me.role === "admin"} userId={me.id} people={profiles.map(person => ({ ...person, email: emailById[person.id] }))} departments={[...new Set(profiles.map(person => person.department))].filter(Boolean).sort()} />}
    {activeTab === "home" && me.role === "faculty" && <FacultyHome
      name={me.name}
      statusNudge={facultyNudgeCard ? (
        <FacultyStatusNudge
          nudge={facultyNudgeCard}
          working={working}
          onRespond={status => void action(
            () => supabase!.rpc("respond_status_nudge", { p_nudge: facultyNudgeCard.id, p_status: status }),
            `Status updated to ${labels[status]}.`,
          ).then(ok => { if (ok) { setOpenStatusNudges(previous => previous.filter(row => row.id !== facultyNudgeCard.id)); void refreshStatuses(); } })}
          onDismiss={() => void action(
            () => supabase!.rpc("dismiss_status_nudge", { p_nudge: facultyNudgeCard.id }),
            "Kept your current status.",
          ).then(ok => { if (ok) setOpenStatusNudges(previous => previous.filter(row => row.id !== facultyNudgeCard.id)); })}
        />
      ) : null}
      statusControls={facultyControls}
      pending={facultyPending}
      today={facultyToday}
      dayWrap={dayWrap}
      onOpenInbox={() => goToTab("requests")}
      onOpenDay={() => goToTab("day")}
    />}
    {activeTab === "home" && me.role !== "faculty" && <>
      {me.role !== "admin" && replyLine}
      {me.role === "admin" && <div className={styles.filters} role="tablist" aria-label="Directory">
        <button type="button" aria-pressed={directoryScope === "faculty"} onClick={() => setDirectoryScope("faculty")}>Faculty</button>
        <button type="button" aria-pressed={directoryScope === "students"} onClick={() => setDirectoryScope("students")}>Students</button>
      </div>}
      {me.role === "admin" && directoryScope === "students" ? (
        <AdminStudentDirectory
          people={profiles.filter(person => person.role === "student").map(person => ({ ...person, email: emailById[person.id] || "" }))}
          search={search}
          setSearch={setSearch}
        />
      ) : (
        <FacultyDirectory
          role={me.role === "admin" ? "admin" : "student"}
          people={faculty.map(person => ({ ...person, email: emailById[person.id], pause_requests: person.pause_requests, quiet_start: person.quiet_start, quiet_end: person.quiet_end, auto_busy_outside_hours: person.auto_busy_outside_hours }))}
          waitingCap={waitingCap ?? 5}
          favoriteIds={favoriteIds}
          onToggleFavorite={me.role === "student" ? id => setFavoriteIds(toggleFavoriteFaculty(me.id, id)) : undefined}
          waitingPlaces={waitingPlaces}
          statusStale={statusStale && me.role === "student"}
          suggestPool={facultySuggestPool}
          search={search}
          setSearch={setSearch}
          listMode={listMode}
          setListMode={setListMode}
          scheduleReliable={statusStale ? Object.keys(cachedPresence).length > 0 : scheduleReliable}
          hoursReady={hoursReady}
          availability={directoryAvailability}
          scheduled={statusStale ? [] : scheduled}
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
          waitingById={waiting}
          lastReplyById={lastReplyById}
          departments={departmentOptions}
          departmentFilter={department}
          setDepartmentFilter={setDepartment}
          onChoose={chooseFaculty}
          onCancel={() => { setTarget(""); changeRequestVoice(null); }}
          onSend={event => void sendRequest(event)}
          askedNudgeFaculty={askedNudgeFaculty}
          blockedNudgeFaculty={blockedNudgeFaculty}
          onRequestStatusNudge={me.role === "student" ? facultyId => void action(
            () => supabase!.rpc("request_status_nudge", { p_faculty: facultyId }),
            "Asked them to update status.",
          ).then(async ok => {
            if (!ok || !me || !supabase) return;
            const { data } = await supabase.from("status_nudges")
              .select("id,faculty_id,student_id,expires_at")
              .eq("status", "open")
              .gt("expires_at", new Date().toISOString());
            if (Array.isArray(data)) {
              setOpenStatusNudges(data.map(row => ({
                id: String(row.id),
                faculty_id: String(row.faculty_id),
                student_id: String(row.student_id),
                expires_at: String(row.expires_at),
              })));
            }
          }) : undefined}
        />
      )}
    </>}
    {activeTab === "timing" && me.role === "faculty" && <>
      <div className={styles.pageHead}><div><h1>Availability.</h1><p>Status, weekly hours, inbox preferences, and ask patterns.</p></div></div>
      <div className={styles.sectionStack}>
      <section className={`${styles.card} ${styles.facultyDashCard}`}>
        <div className={styles.sectionHead}><div><h2>Set status now</h2><p>Quick status for the day. Duration applies here.</p></div></div>
        <label className={styles.durationLabel}>For<select value={duration} onChange={e => setDuration(Number(e.target.value))}><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option><option value={240}>4 hours</option><option value={480}>Rest of day</option></select></label>
        <div className={styles.slotRow}>{(["available", "busy", "away"] as const).map(status => <button type="button" key={status} className={mine.status === status ? styles.primary : styles.secondary} aria-pressed={mine.status === status} disabled={working} onClick={() => { const keep = status === "away" ? "" : walkInDraft.trim().slice(0, 120); void action(() => supabase!.rpc("set_availability", { p_status: status, p_duration_minutes: duration, p_walk_in_note: keep }), `Status updated to ${labels[status]}.`).then(ok => { if (ok) setWalkInDraft(keep); }); }}>{labels[status]}</button>)}</div>
        {(mine.status === "available" || mine.status === "busy") && <div className={styles.walkInEditor}>
          <p className={styles.muted}>Note for students while Available or Busy (optional).</p>
          <label className={styles.walkInField}>Note<input value={walkInDraft} maxLength={120} disabled={working} placeholder="e.g. Knock for signatures" onChange={e => setWalkInDraft(e.target.value)} onBlur={() => void action(() => supabase!.rpc("set_availability", { p_status: mine.status!, p_duration_minutes: duration, p_walk_in_note: walkInDraft.trim().slice(0, 120) }), walkInDraft.trim() ? "Note saved." : "Note cleared.")} /></label>
        </div>}
      </section>
      <section className={`${styles.card} ${styles.facultyDashCard}`}>
        <div className={styles.sectionHead}><div><h2>Office hours</h2><p>Recurring slots students can aim for. They can still ask for another time.</p></div></div>
        {!hoursReady ? <p className={styles.muted}>Office hours are not available yet. Ask your administrator to finish the campus database setup.</p> : <>
          <div>{hours.filter(h => h.faculty_id === me.id).map(h => <div className={styles.hourRow} key={h.id}><span>{weekdays[h.weekday]} · {h.start_time.slice(0, 5)}-{h.end_time.slice(0, 5)} <small>{h.timezone}</small></span><button type="button" disabled={working} onClick={() => void action(() => supabase!.rpc("remove_office_hour", { p_id: h.id }), "Office hours removed.")}>Remove</button></div>)}
            {!hours.some(h => h.faculty_id === me.id) && <p className={styles.muted}>No office hours added yet.</p>}
          </div>
          <form onSubmit={e => { e.preventDefault(); if (hourStart >= hourEnd) { setError("The end time must be after the start time."); return; } void action(() => supabase!.rpc("add_office_hour", { p_weekday: weekday, p_start: hourStart, p_end: hourEnd, p_timezone: timezone }), "Office hours added."); }}>
            <div className={styles.hoursFields}>
              <label>Day<select value={weekday} onChange={e => setWeekday(Number(e.target.value))}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
              <label>Start<input type="time" required value={hourStart} onChange={e => setHourStart(e.target.value)} /></label>
              <label>End<input type="time" required value={hourEnd} onChange={e => setHourEnd(e.target.value)} /></label>
              <div className={styles.fieldAction}><span aria-hidden="true">Add</span><button className={styles.secondary} disabled={working}>Add office hours</button></div>
            </div>
            <p className={styles.muted}>Time zone: {timezone}. Students see these times in this zone.</p>
          </form>
        </>}
      </section>
      <section className={`${styles.card} ${styles.facultyDashCard}`}>
        <div className={styles.sectionHead}><div><h2>Plan ahead</h2><p>Change status at a set time. A later manual change wins.</p></div></div>
        {!scheduleReady ? <p className={styles.muted}>Scheduled status is not available yet. Ask your administrator to finish the campus database setup.</p> : <>
          {scheduled.filter(s => s.faculty_id === me.id && Date.parse(s.starts_at) > now).map(s => <div className={styles.hourRow} key={s.starts_at}><span>{labels[s.status]} · {date(s.starts_at)} until {date(s.expires_at)}</span><button disabled={working} type="button" onClick={() => void action(() => supabase!.rpc("cancel_scheduled_status"), "Scheduled status cancelled.")}>Cancel</button></div>)}
          <form onSubmit={e => { e.preventDefault(); const start = new Date(scheduleStart); const end = new Date(scheduleEnd); if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() <= Date.now() || end.getTime() <= start.getTime() || end.getTime() - start.getTime() > 8 * 60 * 60 * 1000) { setError("Choose a future start time and an end time within eight hours."); return; } void action(() => supabase!.rpc("schedule_status", { p_status: scheduledChoice, p_starts_at: start.toISOString(), p_expires_at: end.toISOString() }), "Status change scheduled.").then(ok => { if (ok) { setScheduleStart(""); setScheduleEnd(""); } }); }}>
            <div className={styles.hoursFields}>
              <label>Status<select value={scheduledChoice} onChange={e => setScheduledChoice(e.target.value as MeetingStatus)}><option value="available">Available</option><option value="busy">Busy</option><option value="away">Away</option></select></label>
              <label>Start<input type="datetime-local" required value={scheduleStart} onChange={e => setScheduleStart(e.target.value)} /></label>
              <label>End<input type="datetime-local" required value={scheduleEnd} onChange={e => setScheduleEnd(e.target.value)} /></label>
              <div className={styles.fieldAction}><span aria-hidden="true">Add</span><button disabled={working} className={styles.secondary}>Schedule status</button></div>
            </div>
            <p className={styles.muted}>Local device time. One upcoming change, up to 30 days ahead. After it ends, status is unknown until you set another.</p>
          </form>
        </>}
      </section>
        <FacultyInboxPrefs
          working={working}
          values={{
            pauseRequests: !!me.pause_requests,
            quietStart: (me.quiet_start || "").slice(0, 5),
            quietEnd: (me.quiet_end || "").slice(0, 5),
            autoBusyOutsideHours: !!me.auto_busy_outside_hours,
            snippets: me.reply_snippets || [],
            leaveDays,
          }}
          onSavePrefs={next => void action(() => supabase!.rpc("set_faculty_inbox_prefs", {
            p_pause: next.pauseRequests,
            p_quiet_start: next.quietStart || null,
            p_quiet_end: next.quietEnd || null,
            p_snippets: next.snippets,
            p_auto_busy: next.autoBusyOutsideHours,
          }), "Inbox preferences saved.")}
          onAddLeaveDay={(leaveOn, note) => void action(() => supabase!.rpc("set_faculty_leave_day", { p_leave_on: leaveOn, p_note: note }), "Leave day saved.").then(ok => { if (ok) setLeaveTick(t => t + 1); })}
          onRemoveLeaveDay={id => void action(() => supabase!.rpc("remove_faculty_leave_day", { p_id: id }), "Leave day removed.").then(ok => { if (ok) setLeaveTick(t => t + 1); })}
        />
      <AskPatternCard summary={askWeekdaySummary} />
      </div>
    </>}
    {activeTab === "admin" && me.role === "admin" && <>
      <div className={styles.pageHead}><div><span className={styles.eyebrow}>CAMPUS ADMINISTRATION</span><h1>Campus admin.</h1><p>Pilot health, invites, and people. Alerts stay in the app.</p></div></div>
      {!adminReady ? <section className={styles.card}>The administrator database update has not been applied yet. Ask the project administrator to apply it before managing profiles.</section> : (
        <AdminPilot
          meId={me.id}
          profiles={profiles.map(person => ({ ...person, email: emailById[person.id] || "" }))}
          usage={usage}
          working={working}
          onAction={action}
          onError={setError}
          waitingCap={waitingCap}
          retentionDays={retentionDays}
          privacyRows={privacyRows}
          peopleRows={adminPeopleRows}
          peopleTotal={adminPeopleTotal}
          peopleLoading={adminPeopleLoading}
          onPeopleQuery={queryAdminPeople}
          onBulkUpdate={(ids, patch) => void action(() => supabase!.rpc("admin_bulk_update_profiles", { p_users: ids, p_department: patch.department ?? null, p_role: patch.role ?? null, p_active: patch.active ?? null }), "People updated.")}
          onSaveInstitutionPolicy={(cap, retention) => void action(
            () => supabase!.rpc("admin_update_institution_settings", { p_waiting_cap: cap, p_retention_days: retention }),
            "Institution policy saved.",
          ).then(ok => { if (ok) { setWaitingCap(cap); setRetentionDays(retention); } })}
          onSaveRetentionDays={retention => void action(
            () => supabase!.rpc("admin_update_institution_settings", { p_waiting_cap: waitingCap ?? 5, p_retention_days: retention }),
            "Retention saved.",
          ).then(ok => { if (ok) setRetentionDays(retention); })}
          onResolve={(id, status) => void action(() => supabase!.rpc("admin_resolve_privacy_request", { p_id: id, p_status: status }), "Privacy request updated.").then(ok => { if (ok) setPrivacyRows(previous => previous.filter(row => row.id !== id)); })}
        />
      )}
    </>}
    {activeTab === "requests" && (me.role === "student" || me.role === "faculty") && (
      <RequestInbox
        role={me.role}
        userId={me.id}
        rows={requests}
        names={name}
        working={working}
        captureId={captureId}
        notes={notes}
        setNotes={(id, value) => setNotes(previous => ({ ...previous, [id]: value }))}
        replyVoices={replyVoices}
        setReplyVoice={(id, value) => setReplyVoices(previous => ({ ...previous, [id]: value }))}
        onBusy={(id, busy) => captureBusy(id, busy)}
        alternativeTimes={alternativeTimes}
        setAlternativeTime={(id, value) => setAlternativeTimes(previous => ({ ...previous, [id]: value }))}
        onRespond={(id, status, note) => void sendResponse(id, status, note)}
        onCancel={id => void cancelRequest(id)}
        onOpenOverview={me.role === "faculty" ? () => goToTab("home") : undefined}
        snippets={me.role === "faculty" ? (me.reply_snippets || []) : undefined}
        pauseActive={me.role === "faculty" ? !!me.pause_requests : false}
        loadError={requestsLoadError}
        onRetryLoad={() => { void load(); }}
        studentContext={me.role === "faculty" ? studentContextById : undefined}
        onBatchAccept={me.role === "faculty" ? ids => { void (async () => { for (const id of ids) await sendResponse(id, "accepted"); })(); } : undefined}
        onBatchAlternative={me.role === "faculty" ? batchAlternative : undefined}
        onAssignFollowup={me.role === "faculty" ? (studentId, title, dueIso) => {
          let meetingAt: string;
          try { meetingAt = localMeetingIso(dueIso); } catch (e) { setError((e as Error).message); return; }
          void action(() => supabase!.rpc("assign_student_followup", { p_student: studentId, p_title: title, p_due: meetingAt }), "Follow-up assigned.");
        } : undefined}
        onAcceptAlternative={me.role === "student" ? id => void action(() => supabase!.rpc("accept_meeting_alternative", { p_request: id }), "Suggested time accepted.") : undefined}
      />
    )}
    {activeTab === "updates" && (() => {
      const kindLabel = (kind?: string | null) => kind === "notice" ? "Notice" : kind === "event" ? "Event" : "Meeting";
      const normalized = (kind?: string | null) => kind === "notice" || kind === "event" ? kind : "meeting";
      const visible = notices.filter(item => {
        if (updateScope === "day" && !isSameLocalDay(item.created_at, updateDay)) return false;
        if (updateKind !== "all" && normalized(item.kind) !== updateKind) return false;
        return matchesQuery(`${kindLabel(item.kind)} ${item.message}`, updateSearch);
      });
      return <><div className={styles.pageHead}><div><h1>Updates.</h1><p>{me.department ? `Campus board first for ${me.department}. Switch filters anytime.` : "Replies, notices, and events."}</p></div></div>
        <div className={styles.filters} role="group" aria-label="Update type">
          {([["notice", "Notices"], ["meeting", "Meetings"], ["event", "Events"], ["all", "All types"]] as const).map(([id, label]) => (
            <button type="button" key={id} aria-pressed={updateKind === id} onClick={() => setUpdateKind(id)}>{label}</button>
          ))}
        </div>
        <SectionTools search={updateSearch} onSearch={setUpdateSearch} searchPlaceholder="Search updates" chips={[{ id: "all", label: "All days" }, { id: "day", label: "This day" }]} chip={updateScope} onChip={id => setUpdateScope(id as "day" | "all")} day={updateScope === "day" ? updateDay : undefined} onDayChange={updateScope === "day" ? setUpdateDay : undefined} />
        {visible.length ? visible.map(n => <article className={`${styles.requestCard}${n.read_at ? "" : ` ${styles.updateUnread}`}`} key={n.id}><div className={styles.requestTop}><strong>{kindLabel(n.kind)}</strong>{!n.read_at && <span className={`${styles.badge} ${styles.busy}`}>New</span>}</div><p>{n.message}</p><p className={styles.muted}>{date(n.created_at)}</p></article>) : <div className={styles.card}>{notices.length ? (updateSearch.trim() ? "No matching updates." : updateKind === "notice" ? "No notice updates yet. Campus notices land here." : "No updates for this filter.") : <><p>No updates yet.</p><p className={styles.muted}>Replies to your requests, campus notices, and events will show here.</p></>}</div>}
        <div className={styles.cardFollow}>
          <PrivacyRequestCard working={working} onSubmit={(kind, note) => action(() => supabase!.rpc("submit_privacy_request", { p_kind: kind, p_note: note }), "Privacy request submitted to your administrator.")} />
        </div>
      </>;
    })()}
    </main><CampusTour userId={me.id} role={me.role} onShow={goToTab} pause={!!facultyNudgeCard} /></Workspace>;
}
