"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "../../lib/supabase-client";
import { parseProfileCsv, type ImportedProfile } from "../../lib/profile-csv";
import styles from "./software.module.css";

export type AdminProfile = {
  id: string;
  name: string;
  role: "student" | "faculty" | "admin";
  department: string;
  active: boolean;
  email?: string;
};

export type BulkProfilePatch = {
  department?: string;
  role?: "student" | "faculty";
  active?: boolean;
};

export type AdminPrivacyRow = {
  id: string;
  user_id: string;
  kind: "export" | "delete";
  note: string;
  created_at: string;
  requester_name?: string;
};

type RoleFilter = "all" | "faculty" | "student" | "admin";
type StatusFilter = "all" | "active" | "disabled";

export type PeopleQuery = { search: string; role: RoleFilter; status: StatusFilter; page: number };

export type PilotUsage = {
  active_students: number;
  active_faculty: number;
  inactive_profiles?: number;
  requests_last_7_days: number;
  requests_last_24_hours?: number;
  pending_requests: number;
  accepted_last_7_days?: number;
  declined_last_7_days?: number;
  alternative_last_7_days?: number;
  median_response_hours?: number | null;
  students_with_many_pending?: number;
  faculty_paused?: number;
  open_privacy_requests?: number;
};

type AuditRow = {
  id: number;
  action: string;
  actor_id: string | null;
  target_id: string;
  created_at: string;
};

type SortKey = "name" | "role" | "status";
const PEOPLE_PAGE_SIZE = 50;

const stamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const roleWord = { student: "Student", faculty: "Faculty", admin: "Administrator" } as const;

const actionLabel: Record<string, string> = {
  profile_created: "Profile created",
  profile_updated: "Profile updated",
  request_created: "Meeting request created",
  request_status_changed: "Meeting request updated",
};

const privacyKindLabel = { export: "Export records", delete: "Delete records" } as const;

function Metric({ value, label }: { value: ReactNode; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function updateProfile(person: AdminProfile, patch: Partial<AdminProfile>) {
  return () => supabase!.rpc("admin_update_profile", {
    p_user: person.id,
    p_name: patch.name ?? person.name,
    p_department: patch.department ?? person.department,
    p_role: patch.role ?? person.role,
    p_active: patch.active ?? person.active,
  });
}

type InvitePerson = { email: string; name: string; department: string; role: "student" | "faculty" };

async function sendCampusInvites(rows: InvitePerson[]) {
  if (!supabase) return { ok: false as const, message: "Campus connection is not ready." };
  const redirect_to = `${window.location.origin}/software/`;
  const invited: string[] = [];
  const failed: { email: string; message: string }[] = [];
  for (let offset = 0; offset < rows.length; offset += 50) {
    const chunk = rows.slice(offset, offset + 50);
    const { data, error } = await supabase.functions.invoke("invite-campus-member", {
      body: { invites: chunk, redirect_to },
    });
    const body = (data ?? {}) as {
      ok?: boolean;
      message?: string;
      invited?: string[];
      failed?: { email: string; message: string }[];
    };
    if (error) {
      failed.push(...chunk.map(row => ({ email: row.email, message: error.message || body.message || "Invite request failed." })));
      continue;
    }
    if (Array.isArray(body.invited)) invited.push(...body.invited);
    if (Array.isArray(body.failed)) failed.push(...body.failed);
    if (!body.ok && !body.invited?.length) {
      failed.push(...chunk.map(row => ({ email: row.email, message: body.message || "Invite request failed." })));
    }
  }
  if (!invited.length) {
    return { ok: false as const, message: failed[0]?.message || "No invites were sent." };
  }
  const message = failed.length
    ? `Invited ${invited.length}. ${failed.length} could not be invited${failed[0] ? `: ${failed[0].message}` : "."}`
    : invited.length === 1
      ? "Invite sent. They can set a password from the email and sign in."
      : `Invited ${invited.length} people.`;
  return { ok: true as const, message };
}

export function AdminPilot({
  meId,
  profiles,
  usage,
  working,
  waitingCap,
  retentionDays,
  privacyRows = [],
  peopleRows,
  peopleTotal,
  peopleLoading,
  onPeopleQuery,
  onAction,
  onError,
  onBulkUpdate,
  onSaveWaitingCap,
  onSaveRetentionDays,
  onSaveInstitutionPolicy,
  onResolve,
}: {
  meId: string;
  profiles: AdminProfile[];
  usage: PilotUsage | null;
  working: boolean;
  waitingCap?: number | null;
  retentionDays?: number | null;
  privacyRows?: AdminPrivacyRow[];
  peopleRows?: AdminProfile[];
  peopleTotal?: number;
  peopleLoading?: boolean;
  onPeopleQuery?: (query: PeopleQuery) => void;
  onAction: (run: () => PromiseLike<{ error: { message: string } | null }>, ok: string | (() => string)) => Promise<boolean>;
  onError: (message: string) => void;
  onBulkUpdate?: (ids: string[], patch: BulkProfilePatch) => void | Promise<void>;
  onSaveWaitingCap?: (n: number) => void | Promise<void>;
  onSaveRetentionDays?: (n: number) => void | Promise<void>;
  onSaveInstitutionPolicy?: (waitingCap: number, retentionDays: number) => void | Promise<void>;
  onResolve?: (id: string, status: "done" | "dismissed") => void | Promise<void>;
}) {
  const [editProfile, setEditProfile] = useState<AdminProfile | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [newRole, setNewRole] = useState<"student" | "faculty">("student");
  const [importRows, setImportRows] = useState<ImportedProfile[]>([]);
  const [importName, setImportName] = useState("");
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditReady, setAuditReady] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const peoplePrefsKey = `campuspulse-admin-people:${meId}`;
  const readPeoplePrefs = () => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(peoplePrefsKey);
      return raw ? JSON.parse(raw) as { search?: string; role?: string; status?: string; sort?: string } : null;
    } catch { return null; }
  };
  const [search, setSearch] = useState(() => String(readPeoplePrefs()?.search || ""));
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(() => {
    const value = readPeoplePrefs()?.role;
    return value === "student" || value === "faculty" || value === "admin" ? value : "all";
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const value = readPeoplePrefs()?.status;
    return value === "active" || value === "disabled" ? value : "all";
  });
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const value = readPeoplePrefs()?.sort;
    return value === "role" || value === "status" ? value : "name";
  });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkDepartment, setBulkDepartment] = useState("");
  const [bulkRole, setBulkRole] = useState<"" | "student" | "faculty">("");
  const [bulkAccess, setBulkAccess] = useState<"" | "active" | "disabled">("");
  const [capDraft, setCapDraft] = useState(() => String(waitingCap ?? 5));
  const [retentionDraft, setRetentionDraft] = useState(() => String(retentionDays ?? 45));
  const [peoplePage, setPeoplePage] = useState(0);
  const serverPeople = onPeopleQuery != null;

  const peopleRef = useRef<HTMLElement>(null);
  const provisionRef = useRef<HTMLElement>(null);
  const auditRef = useRef<HTMLElement>(null);
  const editTitleId = useId();
  const editDialog = useRef<HTMLDialogElement>(null);

  const inactiveCount = usage?.inactive_profiles ?? profiles.filter(person => !person.active).length;
  const pendingCount = usage?.pending_requests ?? 0;
  const needsActivation = useMemo(
    () => profiles.filter(person => !person.active).sort((a, b) => a.name.localeCompare(b.name)),
    [profiles],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const source = serverPeople ? (peopleRows ?? []) : profiles;
    const filtered = source.filter(person => {
      if (!serverPeople) {
        if (roleFilter !== "all" && person.role !== roleFilter) return false;
        if (statusFilter === "active" && !person.active) return false;
        if (statusFilter === "disabled" && person.active) return false;
        if (!query) return true;
        return `${person.name} ${person.department} ${person.role} ${person.email || ""}`.toLowerCase().includes(query);
      }
      return true;
    });
    const rank = { admin: 0, faculty: 1, student: 2 } as const;
    return filtered.sort((a, b) => {
      if (sortKey === "role") {
        const byRole = rank[a.role] - rank[b.role];
        return byRole || a.name.localeCompare(b.name);
      }
      if (sortKey === "status") {
        const byStatus = Number(b.active) - Number(a.active);
        return byStatus || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, [profiles, peopleRows, serverPeople, search, roleFilter, statusFilter, sortKey]);

  const totalPeople = serverPeople ? (peopleTotal ?? 0) : visible.length;
  const pageCount = Math.max(1, Math.ceil(totalPeople / PEOPLE_PAGE_SIZE));
  const safePage = Math.min(peoplePage, pageCount - 1);
  const pageStart = safePage * PEOPLE_PAGE_SIZE;
  const pageRows = useMemo(
    () => serverPeople ? visible : visible.slice(pageStart, pageStart + PEOPLE_PAGE_SIZE),
    [visible, pageStart, serverPeople],
  );

  useEffect(() => {
    setPeoplePage(0);
  }, [search, roleFilter, statusFilter, sortKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(peoplePrefsKey, JSON.stringify({ search, role: roleFilter, status: statusFilter, sort: sortKey }));
    } catch { /* ignore quota / private mode */ }
  }, [peoplePrefsKey, search, roleFilter, statusFilter, sortKey]);

  useEffect(() => {
    if (peoplePage > pageCount - 1) setPeoplePage(Math.max(0, pageCount - 1));
  }, [peoplePage, pageCount]);

  useEffect(() => {
    if (!onPeopleQuery) return;
    const timer = window.setTimeout(() => {
      onPeopleQuery({ search: search.trim(), role: roleFilter, status: statusFilter, page: peoplePage });
    }, search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [onPeopleQuery, search, roleFilter, statusFilter, peoplePage]);

  const names = (id: string | null) => {
    if (!id) return "System";
    return profiles.find(person => person.id === id)?.name
      ?? peopleRows?.find(person => person.id === id)?.name
      ?? "Campus member";
  };

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase
      .from("audit_events")
      .select("id,action,actor_id,target_id,created_at")
      .order("created_at", { ascending: false })
      .limit(40)
      .then(result => {
        if (!active) return;
        if (result.error) {
          setAudit([]);
          setAuditReady(false);
          return;
        }
        setAudit((result.data ?? []) as AuditRow[]);
        setAuditReady(true);
      });
    return () => { active = false; };
  }, [profiles.length, usage?.pending_requests, usage?.requests_last_7_days]);

  useEffect(() => {
    const panel = editDialog.current;
    if (!panel) return;
    if (editProfile) {
      if (!panel.open) panel.showModal();
    } else if (panel.open) {
      panel.close();
    }
  }, [editProfile]);

  useEffect(() => {
    setCapDraft(String(waitingCap ?? 5));
  }, [waitingCap]);

  useEffect(() => {
    setRetentionDraft(String(retentionDays ?? 45));
  }, [retentionDays]);

  useEffect(() => {
    setSelected(prev => {
      const visibleIds = new Set(visible.map(person => person.id));
      const next = new Set<string>();
      prev.forEach(id => { if (visibleIds.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  useEffect(() => {
    if (!focusId || serverPeople) return;
    const index = visible.findIndex(person => person.id === focusId);
    if (index >= 0) setPeoplePage(Math.floor(index / PEOPLE_PAGE_SIZE));
  }, [focusId, visible, serverPeople]);

  useEffect(() => {
    if (!focusId || !peopleRef.current) return;
    const row = peopleRef.current.querySelector(`[data-person="${focusId}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = window.setTimeout(() => setFocusId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [focusId, pageRows]);

  function showDisabledPeople() {
    setRoleFilter("all");
    setStatusFilter("disabled");
    setSearch("");
    setPeoplePage(0);
    window.requestAnimationFrame(() => peopleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function showAudit() {
    setAuditOpen(true);
    window.requestAnimationFrame(() => auditRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function resetPeopleFilters() {
    setSearch("");
    setRoleFilter("all");
    setStatusFilter("all");
    setSortKey("name");
    setPeoplePage(0);
  }

  function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editProfile) return;
    void onAction(updateProfile(editProfile, editProfile), "Profile updated.").then(ok => {
      if (ok) setEditProfile(null);
    });
  }

  function setActive(person: AdminProfile, active: boolean) {
    void onAction(updateProfile(person, { active }), active ? "Account activated." : "Account disabled.");
  }

  const selectablePage = useMemo(() => pageRows.filter(person => person.id !== meId), [pageRows, meId]);
  const allPageSelected = selectablePage.length > 0 && selectablePage.every(person => selected.has(person.id));
  const bulkPatch = useMemo((): BulkProfilePatch | null => {
    const patch: BulkProfilePatch = {};
    const department = bulkDepartment.trim();
    if (department) patch.department = department;
    if (bulkRole) patch.role = bulkRole;
    if (bulkAccess === "active") patch.active = true;
    if (bulkAccess === "disabled") patch.active = false;
    return Object.keys(patch).length ? patch : null;
  }, [bulkDepartment, bulkRole, bulkAccess]);

  function togglePerson(id: string, on: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(on: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (on) selectablePage.forEach(person => next.add(person.id));
      else selectablePage.forEach(person => next.delete(person.id));
      return next;
    });
  }

  function applyBulk() {
    if (!onBulkUpdate || !bulkPatch || selected.size === 0) return;
    const ids = [...selected];
    void onBulkUpdate(ids, bulkPatch);
    setSelected(new Set());
    setBulkDepartment("");
    setBulkRole("");
    setBulkAccess("");
  }

  function saveInstitutionPolicy(event: FormEvent) {
    event.preventDefault();
    const cap = Number(capDraft);
    const retention = Number(retentionDraft);
    if (!Number.isFinite(cap) || cap < 1 || cap > 50) {
      onError("Waiting cap must be between 1 and 50.");
      return;
    }
    if (!Number.isFinite(retention) || retention < 7 || retention > 365) {
      onError("Retention must be between 7 and 365 days.");
      return;
    }
    if (onSaveInstitutionPolicy) void onSaveInstitutionPolicy(cap, retention);
    else {
      if (onSaveWaitingCap) void onSaveWaitingCap(cap);
      if (onSaveRetentionDays) void onSaveRetentionDays(retention);
    }
  }

  const abuseSignals = usage ? [
    { label: "Requests · 24h", value: usage.requests_last_24_hours ?? 0 },
    { label: "Students · 4+ pending", value: usage.students_with_many_pending ?? 0 },
    { label: "Faculty paused", value: usage.faculty_paused ?? 0 },
    { label: "Open privacy asks", value: usage.open_privacy_requests ?? 0 },
  ].filter(item => {
    if (item.label === "Requests · 24h") return item.value >= 40;
    return item.value > 0;
  }) : [];

  const recentAudit = audit.slice(0, 8);
  const extraAudit = audit.slice(8);

  return <div className={styles.adminStack} data-tour="admin">
    {usage ? (
      <section className={`${styles.card} ${styles.facultyDashCard} ${styles.adminMetricsCard}`}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Pilot health</h2>
            <p>Campus counts and meeting reply pace. Alerts stay in the app.</p>
          </div>
        </div>
        <div className={styles.adminMetrics}>
          <Metric value={usage.active_faculty} label="Faculty" />
          <Metric value={usage.active_students} label="Students" />
          <Metric value={pendingCount} label="Pending meetings" />
          <Metric value={inactiveCount} label="Inactive accounts" />
          <Metric value={usage.median_response_hours == null ? "n/a" : `${usage.median_response_hours}h`} label="Median reply" />
          <Metric value={usage.requests_last_7_days} label="Requests · 7d" />
          <Metric value={usage.accepted_last_7_days ?? "n/a"} label="Accepted · 7d" />
          <Metric value={usage.declined_last_7_days ?? "n/a"} label="Declined · 7d" />
          <Metric value={usage.alternative_last_7_days ?? "n/a"} label="Another time · 7d" />
        </div>
        {abuseSignals.length > 0 && <div className={styles.attentionMetrics} role="status" aria-label="Abuse signals">
          {abuseSignals.map(item => <Metric key={item.label} value={item.value} label={item.label} />)}
        </div>}
      </section>
    ) : (
      <section className={`${styles.card} ${styles.facultyDashCard}`}>
        <h2>Pilot health</h2>
        <p className={styles.muted}>Usage summary is still loading.</p>
      </section>
    )}

    <section className={`${styles.card} ${styles.facultyDashCard} ${styles.adminAttention}`}>
      <div className={styles.sectionHead}>
        <div>
          <h2>Needs attention</h2>
          <p>
            {inactiveCount || pendingCount
              ? `${inactiveCount ? `${inactiveCount} inactive account${inactiveCount === 1 ? "" : "s"}` : ""}${inactiveCount && pendingCount ? " · " : ""}${pendingCount ? `${pendingCount} pending meeting${pendingCount === 1 ? "" : "s"}` : ""}.`
              : "Nothing waiting. People and meetings look clear."}
          </p>
        </div>
      </div>
      <div className={styles.adminAttentionActions}>
        {inactiveCount > 0 && <button type="button" className={styles.primary} onClick={showDisabledPeople}>Review inactive</button>}
        {needsActivation.length > 0 && <button type="button" className={styles.secondary} onClick={() => provisionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>Activate accounts</button>}
        <button type="button" className={styles.secondary} onClick={showAudit}>Open audit</button>
      </div>
    </section>

    {(onSaveInstitutionPolicy || onSaveWaitingCap || onSaveRetentionDays) && (
      <section className={`${styles.card} ${styles.facultyDashCard}`}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Institution policy</h2>
            <p>Waiting cap and how long meeting records stay before purge.</p>
          </div>
        </div>
        <form className={`${styles.adminProvisionBlock} ${styles.adminProvisionFlush}`} onSubmit={saveInstitutionPolicy}>
          <div className={styles.hoursFields}>
            <label>
              Waiting request cap
              <input
                type="number"
                min={1}
                max={50}
                required
                value={capDraft}
                onChange={event => setCapDraft(event.target.value)}
              />
            </label>
            <label>
              Retention (days)
              <input
                type="number"
                min={7}
                max={365}
                required
                value={retentionDraft}
                onChange={event => setRetentionDraft(event.target.value)}
              />
            </label>
          </div>
          <p className={styles.muted}>Cap between 1 and 50. Retention between 7 and 365 days.</p>
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={working}>Save policy</button>
          </div>
        </form>
      </section>
    )}

    {onResolve && (
      <section className={`${styles.card} ${styles.facultyDashCard}`}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Privacy requests</h2>
            <p>Open export and deletion asks from campus members.</p>
          </div>
        </div>
        {!privacyRows.length ? (
          <p className={styles.muted}>No open requests.</p>
        ) : (
          <ul className={styles.adminSimpleList}>
            {privacyRows.map(row => (
              <li key={row.id}>
                <div className={styles.adminPersonMain}>
                  <strong>{privacyKindLabel[row.kind]}</strong>
                  <span className={styles.muted}>
                    {row.requester_name || names(row.user_id)} · {stamp(row.created_at)}
                    {row.note ? ` · ${row.note}` : ""}
                  </span>
                </div>
                <div className={styles.adminPersonActions}>
                  <button type="button" className={`${styles.primary} ${styles.adminRowAction}`} disabled={working} onClick={() => void onResolve(row.id, "done")}>Mark done</button>
                  <button type="button" className={`${styles.secondary} ${styles.adminRowAction}`} disabled={working} onClick={() => void onResolve(row.id, "dismissed")}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    )}

    <section ref={auditRef} className={`${styles.card} ${styles.facultyDashCard}`}>
      <div className={styles.sectionHead}>
        <div>
          <h2>Recent audit</h2>
          <p>Profile and meeting changes across campus.</p>
        </div>
      </div>
      {!auditReady ? <p className={styles.muted}>Unavailable.</p> : audit.length === 0 ? <p className={styles.muted}>No events yet.</p> : (
        <>
          <ul className={styles.auditList}>
            {recentAudit.map(row => (
              <li key={row.id}>
                <strong>{actionLabel[row.action] ?? row.action}</strong>
                <span>{names(row.actor_id)} → {names(row.target_id)}</span>
                <small>{stamp(row.created_at)}</small>
              </li>
            ))}
          </ul>
          {extraAudit.length > 0 && (
            <details className={styles.adminAuditMore} open={auditOpen} onToggle={event => setAuditOpen((event.target as HTMLDetailsElement).open)}>
              <summary>Show {extraAudit.length} more</summary>
              <ul className={styles.auditList}>
                {extraAudit.map(row => (
                  <li key={row.id}>
                    <strong>{actionLabel[row.action] ?? row.action}</strong>
                    <span>{names(row.actor_id)} → {names(row.target_id)}</span>
                    <small>{stamp(row.created_at)}</small>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>

    <section ref={peopleRef} className={`${styles.card} ${styles.facultyDashCard}`}>
      <div className={styles.sectionHead}>
        <div>
          <h2>People</h2>
          <p>Search first. Results show {PEOPLE_PAGE_SIZE} at a time.</p>
        </div>
      </div>
      <div className={styles.adminPeopleTools}>
        <label className={styles.adminSearch}>Search people
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email, or department" />
        </label>
        <label className={styles.adminSort}>Sort by
          <select value={sortKey} onChange={event => setSortKey(event.target.value as SortKey)}>
            <option value="name">Name</option>
            <option value="role">Role</option>
            <option value="status">Status</option>
          </select>
        </label>
      </div>
      <div className={styles.filters} role="toolbar" aria-label="Filter people">
        {([
          ["all", "All roles"],
          ["faculty", "Faculty"],
          ["student", "Students"],
          ["admin", "Admins"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={roleFilter === id} onClick={() => setRoleFilter(id)}>{label}</button>
        ))}
      </div>
      <div className={styles.filters} role="toolbar" aria-label="Filter status">
        {([
          ["all", "All status"],
          ["active", "Active"],
          ["disabled", "Disabled"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={statusFilter === id} onClick={() => setStatusFilter(id)}>{label}</button>
        ))}
      </div>
      <div className={styles.adminPeopleMeta}>
        <p className={styles.resultCount} role="status">
          {peopleLoading ? "Loading people…" : totalPeople
            ? `Showing ${pageStart + 1}–${Math.min(pageStart + PEOPLE_PAGE_SIZE, totalPeople)} of ${totalPeople}`
            : serverPeople ? "0 people" : `0 of ${profiles.length}`}
          {!serverPeople && visible.length !== profiles.length ? ` · filtered from ${profiles.length}` : ""}
        </p>
        {onBulkUpdate && !!pageRows.length && (
          <label className={styles.adminPersonPick}>
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={event => toggleAllVisible(event.target.checked)}
              aria-label="Select all people on this page"
            />
            <span className={styles.muted}>
              Select this page ({selectablePage.length}{pageRows.some(person => person.id === meId) ? ", you excluded" : ""})
            </span>
          </label>
        )}
      </div>
      {onBulkUpdate && selected.size > 0 && (
        <div className={styles.adminBulkBar} role="region" aria-label="Bulk update">
          <p className={styles.muted}>{selected.size} selected</p>
          <div className={styles.adminBulkBarFields}>
            <label>
              Department
              <input value={bulkDepartment} maxLength={120} placeholder="Leave blank to keep" onChange={event => setBulkDepartment(event.target.value)} />
            </label>
            <label>
              Role
              <select value={bulkRole} onChange={event => setBulkRole(event.target.value as "" | "student" | "faculty")}>
                <option value="">Keep role</option>
                <option value="student">Student</option>
                <option value="faculty">Faculty</option>
              </select>
            </label>
            <label>
              Access
              <select value={bulkAccess} onChange={event => setBulkAccess(event.target.value as "" | "active" | "disabled")}>
                <option value="">Keep access</option>
                <option value="active">Activate</option>
                <option value="disabled">Disable</option>
              </select>
            </label>
          </div>
          <div className={styles.adminInlineActions}>
            <button type="button" className={styles.primary} disabled={working || !bulkPatch} onClick={applyBulk}>Apply</button>
            <button type="button" className={styles.secondary} onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}
      {!visible.length && !peopleLoading ? (
        <div className={styles.adminEmpty}>
          <p>{(serverPeople ? totalPeople : profiles.length) ? "No matching people." : "No profiles yet."}</p>
          {(serverPeople ? totalPeople : profiles.length) > 0 && <button type="button" className={styles.secondary} onClick={resetPeopleFilters}>Clear filters</button>}
        </div>
      ) : (
        <>
          <ul className={styles.adminPeopleList}>
            {pageRows.map(person => {
              const self = person.id === meId;
              return <li key={person.id} data-person={person.id} className={focusId === person.id ? styles.adminPersonFlash : undefined}>
                {onBulkUpdate ? (
                  <input
                    type="checkbox"
                    className={styles.adminRowCheck}
                    checked={!self && selected.has(person.id)}
                    disabled={self}
                    onChange={event => togglePerson(person.id, event.target.checked)}
                    aria-label={self ? `${person.name} (you)` : `Select ${person.name}`}
                  />
                ) : <span className={styles.adminRowCheckSpacer} aria-hidden="true" />}
                <div className={styles.adminPersonMain}>
                  <strong>{person.name}</strong>
                  <span className={styles.muted}>{person.email || "No email"} · {person.department || "No department"} · {roleWord[person.role]}</span>
                </div>
                <span className={`${styles.badge} ${person.active ? styles.good : ""}`}>{person.active ? "Active" : "Disabled"}</span>
                <div className={styles.adminPersonActions}>
                  <button type="button" className={`${styles.secondary} ${styles.adminRowAction}`} onClick={() => setEditProfile({ ...person })}>Edit</button>
                  {!self && person.active && <button type="button" className={styles.adminRowAction} disabled={working} onClick={() => setActive(person, false)}>Disable</button>}
                  {!self && !person.active && <button type="button" className={`${styles.primary} ${styles.adminRowAction}`} disabled={working} onClick={() => setActive(person, true)}>Activate</button>}
                </div>
              </li>;
            })}
          </ul>
          {pageCount > 1 && (
            <div className={styles.adminPager} role="navigation" aria-label="People pages">
              <button type="button" className={styles.secondary} disabled={safePage <= 0} onClick={() => setPeoplePage(page => Math.max(0, page - 1))}>Previous</button>
              <span className={styles.muted}>Page {safePage + 1} of {pageCount}</span>
              <button type="button" className={styles.secondary} disabled={safePage >= pageCount - 1} onClick={() => setPeoplePage(page => Math.min(pageCount - 1, page + 1))}>Next</button>
            </div>
          )}
        </>
      )}
    </section>

    <section ref={provisionRef} className={`${styles.card} ${styles.facultyDashCard}`}>
      <div className={styles.sectionHead}>
        <div>
          <h2>Invite people</h2>
          <p>Send a campus invite by email. They set a password from the link and sign in with an active profile already waiting.</p>
        </div>
      </div>

      {needsActivation.length > 0 && (
        <div className={styles.adminProvisionBlock}>
          <div className={styles.adminCompactNotice}>
            <div>
              <h3>Needs activation</h3>
              <p className={styles.muted}>{needsActivation.length} disabled {needsActivation.length === 1 ? "profile" : "profiles"}. Open them in People to activate.</p>
            </div>
            <button type="button" className={styles.secondary} onClick={showDisabledPeople}>Review in People</button>
          </div>
        </div>
      )}

      <form className={styles.adminProvisionBlock} onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const invite = {
          email: newEmail.trim().toLowerCase(),
          name: newName.trim(),
          department: newDepartment.trim(),
          role: newRole,
        };
        let success = "Invite sent. They can set a password from the email and sign in.";
        void onAction(async () => {
          const result = await sendCampusInvites([invite]);
          if (!result.ok) return { error: { message: result.message } };
          success = result.message;
          return { error: null };
        }, () => success).then(ok => {
          if (!ok) return;
          setNewEmail("");
          setNewName("");
          setNewDepartment("");
          setRoleFilter("all");
          setStatusFilter("all");
          setSearch(invite.email);
          window.requestAnimationFrame(() => peopleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        });
      }}>
        <h3>Invite one person</h3>
        <p className={styles.muted}>Any email works. They receive an invite link and join your college; no prior signup needed. If they already have an Auth account, ask them to sign in or use Reset password — re-inviting the same email will not send a second invite.</p>
        <label>Email<input type="email" required value={newEmail} onChange={event => setNewEmail(event.target.value)} placeholder="name@gmail.com" /></label>
        <label>Name<input required maxLength={120} value={newName} onChange={event => setNewName(event.target.value)} /></label>
        <label>Department<input maxLength={120} value={newDepartment} onChange={event => setNewDepartment(event.target.value)} /></label>
        <label>Role<select value={newRole} onChange={event => setNewRole(event.target.value as "student" | "faculty")}><option value="student">Student</option><option value="faculty">Faculty</option></select></label>
        <p className={styles.muted}>Invites are student or faculty only. Promote an administrator later under Edit, carefully.</p>
        <div className={styles.actions}><button className={styles.primary} disabled={working}>Send invite</button></div>
      </form>

      <div className={styles.adminProvisionBlock}>
        <h3>Invite from CSV</h3>
        <p className={styles.muted}>Columns: email, name, department, role · student or faculty · max 2000 rows · under 2 MB. Sends invites in batches of 50. Duplicate emails in the file are rejected; emails that already signed up are listed in the failure summary so you can activate them under People instead.</p>
        <label>CSV file<input type="file" accept=".csv,text/csv" onChange={async event => {
          const file = event.target.files?.[0];
          setImportRows([]);
          setImportName("");
          onError("");
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) { onError("The CSV file must be smaller than 2 MB."); return; }
          try {
            const rows = parseProfileCsv(await file.text());
            setImportRows(rows);
            setImportName(file.name);
          } catch (err) {
            onError(err instanceof Error ? err.message : "Could not read the CSV file.");
          }
        }} /></label>
        {importRows.length > 0 && <>
          <p>{importName}: {importRows.length} people ready to invite.</p>
          <div className={styles.adminCsvPreviewWrap}>
            <table className={styles.adminCsvPreview}>
              <thead>
                <tr><th>Email</th><th>Name</th><th>Department</th><th>Role</th></tr>
              </thead>
              <tbody>
                {importRows.slice(0, 12).map(row => (
                  <tr key={row.email}>
                    <td><code>{row.email}</code></td>
                    <td>{row.name}</td>
                    <td>{row.department || "None"}</td>
                    <td>{row.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {importRows.length > 12 && <p className={styles.muted}>Showing first 12 of {importRows.length}.</p>}
          </div>
          <div className={styles.actions}>
            <button type="button" disabled={working} className={styles.primary} onClick={() => {
              let success = "Invites sent. They can set a password from email and sign in.";
              void onAction(async () => {
                const result = await sendCampusInvites(importRows);
                if (!result.ok) return { error: { message: result.message } };
                success = result.message;
                return { error: null };
              }, () => success).then(ok => {
                if (ok) { setImportRows([]); setImportName(""); }
              });
            }}>Send invites</button>
            <button type="button" className={styles.secondary} onClick={() => { setImportRows([]); setImportName(""); }}>Clear preview</button>
          </div>
        </>}
      </div>
    </section>

    <dialog
      ref={editDialog}
      className={styles.profileDialog}
      aria-labelledby={editTitleId}
      onClose={() => setEditProfile(null)}
    >
      {editProfile && <form className={styles.profileDialogBody} onSubmit={saveEdit}>
        <div className={styles.requestDialogHead}>
          <button type="button" className={styles.requestBack} onClick={() => setEditProfile(null)}>Close</button>
          <span className={styles.eyebrow}>EDIT PROFILE</span>
        </div>
        <h2 id={editTitleId}>{editProfile.name}</h2>
        <label>Name<input required maxLength={120} value={editProfile.name} onChange={event => setEditProfile({ ...editProfile, name: event.target.value })} /></label>
        <label>Department<input maxLength={120} value={editProfile.department} onChange={event => setEditProfile({ ...editProfile, department: event.target.value })} /></label>
        <label>Role<select disabled={editProfile.id === meId} value={editProfile.role} onChange={event => setEditProfile({ ...editProfile, role: event.target.value as AdminProfile["role"] })}><option value="student">Student</option><option value="faculty">Faculty</option><option value="admin">Administrator</option></select></label>
        <p className={styles.muted}>Administrator is campus root access. Keep that role rare.</p>
        <label>Account access<select disabled={editProfile.id === meId} value={editProfile.active ? "active" : "disabled"} onChange={event => setEditProfile({ ...editProfile, active: event.target.value === "active" })}><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
        <p className={styles.muted}>Disabling blocks access. You cannot remove your own admin role.</p>
        <div className={styles.actions}>
          <button className={styles.primary} disabled={working}>Save profile</button>
          <button type="button" onClick={() => setEditProfile(null)}>Cancel</button>
        </div>
      </form>}
    </dialog>
  </div>;
}
