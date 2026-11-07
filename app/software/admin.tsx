"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "../../lib/supabase-client";
import { parseProfileCsv, type ImportedProfile } from "../../lib/profile-csv";
import styles from "./software.module.css";

export type AdminProfile = {
  id: string;
  name: string;
  role: "student" | "faculty" | "admin";
  department: string;
  active: boolean;
};

export type PilotUsage = {
  active_students: number;
  active_faculty: number;
  inactive_profiles?: number;
  requests_last_7_days: number;
  pending_requests: number;
  accepted_last_7_days?: number;
  declined_last_7_days?: number;
  alternative_last_7_days?: number;
  median_response_hours?: number | null;
};

type AuditRow = {
  id: number;
  action: string;
  actor_id: string | null;
  target_id: string;
  created_at: string;
};

const stamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const actionLabel: Record<string, string> = {
  profile_created: "Profile created",
  profile_updated: "Profile updated",
  request_created: "Meeting request created",
  request_status_changed: "Meeting request updated",
};

function Metric({ value, label }: { value: ReactNode; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

export function AdminPilot({
  meId,
  profiles,
  usage,
  working,
  onAction,
  onError,
}: {
  meId: string;
  profiles: AdminProfile[];
  usage: PilotUsage | null;
  working: boolean;
  onAction: (run: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [editProfile, setEditProfile] = useState<AdminProfile | null>(null);
  const [newUserId, setNewUserId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [newRole, setNewRole] = useState<AdminProfile["role"]>("student");
  const [importRows, setImportRows] = useState<ImportedProfile[]>([]);
  const [importName, setImportName] = useState("");
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditReady, setAuditReady] = useState(false);

  const names = (id: string | null) => {
    if (!id) return "System";
    return profiles.find(person => person.id === id)?.name ?? "Campus member";
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

  return <>
    {usage ? <div className={styles.metrics}>
      <Metric value={usage.active_faculty} label="Faculty" />
      <Metric value={usage.active_students} label="Students" />
      <Metric value={usage.pending_requests} label="Pending" />
      <Metric value={usage.median_response_hours == null ? "—" : `${usage.median_response_hours}h`} label="Median reply" />
    </div> : null}
    {usage && <div className={styles.metrics}>
      <Metric value={usage.requests_last_7_days} label="Requests · 7d" />
      <Metric value={usage.accepted_last_7_days ?? "—"} label="Accepted · 7d" />
      <Metric value={usage.declined_last_7_days ?? "—"} label="Declined · 7d" />
      <Metric value={usage.alternative_last_7_days ?? "—"} label="Another time · 7d" />
    </div>}

    <section className={styles.card} style={{ margin: "18px 0" }}>
      <h2>Audit</h2>
      {!auditReady ? <p className={styles.muted}>Unavailable.</p> : audit.length === 0 ? <p className={styles.muted}>No events yet.</p> : (
        <ul className={styles.auditList}>
          {audit.map(row => <li key={row.id}><strong>{actionLabel[row.action] ?? row.action}</strong><span>{names(row.actor_id)} → {names(row.target_id)}</span><small>{stamp(row.created_at)}</small></li>)}
        </ul>
      )}
    </section>

    {usage && <>
      <section className={styles.card} style={{ margin: "18px 0" }}>
        <h2>Import CSV</h2>
        <p className={styles.muted}>auth_user_id, name, department, role · student or faculty · max 100</p>
        <label>CSV file<input type="file" accept=".csv,text/csv" onChange={async event => {
          const file = event.target.files?.[0];
          setImportRows([]);
          setImportName("");
          onError("");
          if (!file) return;
          if (file.size > 131072) { onError("The CSV file must be smaller than 128 KB."); return; }
          try {
            const rows = parseProfileCsv(await file.text());
            setImportRows(rows);
            setImportName(file.name);
          } catch (err) {
            onError(err instanceof Error ? err.message : "Could not read the CSV file.");
          }
        }} /></label>
        {importRows.length > 0 && <>
          <p>{importName}: {importRows.length} valid profiles ready to import.</p>
          <button type="button" disabled={working} className={styles.secondary} onClick={() => void onAction(() => supabase!.rpc("admin_import_profiles", { p_users: importRows }), "Profiles imported.").then(ok => { if (ok) { setImportRows([]); setImportName(""); } })}>Import profiles</button>
        </>}
      </section>

      <form className={styles.card} style={{ margin: "18px 0" }} onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onAction(() => supabase!.rpc("admin_create_profile", { p_user: newUserId, p_name: newName, p_department: newDepartment, p_role: newRole }), "Profile created.").then(ok => {
          if (ok) { setNewUserId(""); setNewName(""); setNewDepartment(""); }
        });
      }}>
        <h2>Add account</h2>
        <p className={styles.muted}>Auth user must already exist in Supabase.</p>
        <label>Auth user ID<input required value={newUserId} onChange={event => setNewUserId(event.target.value)} placeholder="User UUID from Supabase" /></label>
        <label>Name<input required maxLength={120} value={newName} onChange={event => setNewName(event.target.value)} /></label>
        <label>Department<input maxLength={120} value={newDepartment} onChange={event => setNewDepartment(event.target.value)} /></label>
        <label>Role<select value={newRole} onChange={event => setNewRole(event.target.value as AdminProfile["role"])}><option value="student">Student</option><option value="faculty">Faculty</option><option value="admin">Administrator</option></select></label>
        <button className={styles.secondary} disabled={working}>Add profile</button>
      </form>
    </>}

    <p className={styles.muted}>No meeting emails. People use Updates and app alerts.</p>

    {profiles.map(person => <article className={styles.requestCard} key={person.id}>
      <div className={styles.requestTop}>
        <div><h2>{person.name}</h2><span className={styles.muted}>{person.department || "No department"} · {person.role}</span></div>
        <span className={styles.badge}>{person.active ? "Active" : "Disabled"}</span>
      </div>
      <div className={styles.actions}><button type="button" onClick={() => setEditProfile({ ...person })}>Edit profile</button></div>
    </article>)}

    {editProfile && <form className={styles.card} onSubmit={event => {
      event.preventDefault();
      void onAction(() => supabase!.rpc("admin_update_profile", {
        p_user: editProfile.id,
        p_name: editProfile.name,
        p_department: editProfile.department,
        p_role: editProfile.role,
        p_active: editProfile.active,
      }), "Profile updated.").then(ok => { if (ok) setEditProfile(null); });
    }}>
      <h2>Edit {editProfile.name}</h2>
      <label>Name<input required maxLength={120} value={editProfile.name} onChange={event => setEditProfile({ ...editProfile, name: event.target.value })} /></label>
      <label>Department<input maxLength={120} value={editProfile.department} onChange={event => setEditProfile({ ...editProfile, department: event.target.value })} /></label>
      <label>Role<select disabled={editProfile.id === meId} value={editProfile.role} onChange={event => setEditProfile({ ...editProfile, role: event.target.value as AdminProfile["role"] })}><option value="student">Student</option><option value="faculty">Faculty</option><option value="admin">Administrator</option></select></label>
      <label>Account access<select disabled={editProfile.id === meId} value={editProfile.active ? "active" : "disabled"} onChange={event => setEditProfile({ ...editProfile, active: event.target.value === "active" })}><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
      <p className={styles.muted}>Disabling blocks access. You cannot remove your own admin role.</p>
      <div className={styles.actions}>
        <button className={styles.primary} disabled={working}>Save profile</button>
        <button type="button" onClick={() => setEditProfile(null)}>Cancel</button>
      </div>
    </form>}
  </>;
}
