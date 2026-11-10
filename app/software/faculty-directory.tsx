"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import styles from "./software.module.css";
import { campusPresence, nextOfficeSlots, suggestFacultyForTopic, type Presence } from "../../lib/availability";
import { NaturalTimeInput } from "./natural-time-input";
import { RequestChips } from "./requests";
import { VoiceNoteInput } from "./voice-note";
import { StudentStatusNudgeButton } from "./status-nudge";
import type { MeetingTimeDraft } from "../../lib/natural-meeting-time";
import type { VoiceDraft } from "../../lib/voice-notes";
import { readFacultyReasons } from "../../lib/campus-prefs";
import { publicProfilePhotoUrl } from "../../lib/profile-photos";

export type WaitingPlace = { waiting: number; myPlace: number | null; cap: number };

function waitingLineCopy(waiting: number, place: number | null | undefined, cap: number) {
  const spots = Math.max(0, cap - waiting);
  if (place != null && place > 0) return `You’re #${place} of ${waiting} waiting`;
  if (waiting >= cap) return `Inbox full (${waiting}/${cap})`;
  if (waiting > 0 && spots <= 2) return `${waiting} waiting · ${spots === 1 ? "1 spot" : `${spots} spots`} left before the cap`;
  if (waiting > 0) return `${waiting} waiting · campus allows up to ${cap}`;
  return null;
}

type Faculty = {
  id: string;
  name: string;
  department: string;
  office_location: string | null;
  expertise?: string;
  portfolio?: string;
  photo_path?: string | null;
  email?: string;
  pause_requests?: boolean;
  quiet_start?: string | null;
  quiet_end?: string | null;
  auto_busy_outside_hours?: boolean;
};

function statusChipClass(status: "available" | "busy" | "away" | null | undefined, statusStale: boolean) {
  if (status === "available") return styles.cardChipAvailable;
  if (status === "busy") return styles.cardChipBusy;
  if (status === "away") return styles.cardChipAway;
  return statusStale ? styles.cardChipMuted : styles.cardChipMuted;
}

type Availability = { faculty_id: string; status: "available" | "busy" | "away"; updated_at: string; expires_at: string; walk_in_note?: string | null };
type Scheduled = { faculty_id: string; status: "available" | "busy" | "away"; starts_at: string; expires_at: string };
type OfficeHour = { id: string; faculty_id: string; weekday: number; start_time: string; end_time: string; timezone: string };

const labels = { available: "Available", busy: "Busy", away: "Away" } as const;
const stamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function presenceCopy(presence: Presence) {
  if (presence.source === "hours") return "From weekly hours";
  if (presence.expiresAt) return `Until ${stamp(presence.expiresAt)}`;
  return "No current status";
}

export function FacultyDirectory({
  role,
  people,
  search,
  setSearch,
  listMode,
  setListMode,
  scheduleReliable,
  hoursReady,
  availability,
  scheduled,
  hours,
  now,
  target,
  preferred,
  setPreferred,
  reason,
  setReason,
  requestVoice,
  changeRequestVoice,
  captureBusy,
  working,
  captureId,
  userId,
  onChoose,
  onCancel,
  onSend,
  waitingById = {},
  lastReplyById = {},
  departments = [],
  departmentFilter = "",
  setDepartmentFilter = () => {},
  suggestPool = [],
  askedNudgeFaculty = {},
  blockedNudgeFaculty = {},
  onRequestStatusNudge,
  waitingCap = 5,
  favoriteIds = [],
  onToggleFavorite,
  waitingPlaces = {},
  statusStale = false,
}: {
  role: "student" | "admin";
  people: Faculty[];
  search: string;
  setSearch: (value: string) => void;
  listMode: "recent" | "all" | "available" | "pinned";
  setListMode: (value: "recent" | "all" | "available" | "pinned") => void;
  scheduleReliable: boolean;
  hoursReady: boolean;
  availability: Availability[];
  scheduled: Scheduled[];
  hours: OfficeHour[];
  now: number;
  target: string;
  preferred: MeetingTimeDraft;
  setPreferred: (value: MeetingTimeDraft) => void;
  reason: string;
  setReason: (value: string) => void;
  requestVoice: VoiceDraft | null;
  changeRequestVoice: (value: VoiceDraft | null) => void;
  captureBusy: (id: string, busy: boolean) => void;
  working: boolean;
  captureId: string | null;
  userId: string;
  onChoose: (id: string) => void;
  onCancel: () => void;
  onSend: (event: FormEvent) => void;
  waitingById?: Record<string, number>;
  lastReplyById?: Record<string, string>;
  departments?: string[];
  departmentFilter?: string;
  setDepartmentFilter?: (value: string) => void;
  suggestPool?: Faculty[];
  askedNudgeFaculty?: Record<string, true>;
  blockedNudgeFaculty?: Record<string, true>;
  onRequestStatusNudge?: (facultyId: string) => void;
  waitingCap?: number;
  favoriteIds?: string[];
  onToggleFavorite?: (facultyId: string) => void;
  waitingPlaces?: Record<string, WaitingPlace>;
  statusStale?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const savedScroll = useRef(0);
  const openId = useRef("");
  const [anchorId, setAnchorId] = useState("");
  const [activeTopic, setActiveTopic] = useState("");
  const [stickyReasons, setStickyReasons] = useState<string[]>([]);
  const [photoPreview, setPhotoPreview] = useState<{ name: string; url: string | null; initial: string } | null>(null);
  const photoDialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const pinnedPeople = useMemo(
    () => favoriteIds.map(id => people.find(person => person.id === id) || (suggestPool.find(person => person.id === id) as Faculty | undefined)).filter(Boolean) as Faculty[],
    [favoriteIds, people, suggestPool],
  );
  const visiblePeople = useMemo(() => {
    if (role !== "student" || listMode !== "pinned") return people;
    return pinnedPeople;
  }, [role, listMode, people, pinnedPeople]);
  const suggested = useMemo(() => {
    if (role !== "student" || activeTopic.trim().length < 3) return [];
    return suggestFacultyForTopic(suggestPool.length ? suggestPool : people, activeTopic.trim(), 3);
  }, [role, activeTopic, suggestPool, people]);
  const chosen = (listMode === "pinned" ? pinnedPeople : people).find(person => person.id === target)
    ?? people.find(person => person.id === target)
    ?? pinnedPeople.find(person => person.id === target)
    ?? null;
  const presenceFor = (person: Faculty) => campusPresence(
    scheduleReliable ? availability.find(item => item.faculty_id === person.id) : undefined,
    scheduleReliable ? scheduled.find(item => item.faculty_id === person.id && Date.parse(item.starts_at) <= now) : undefined,
    hoursReady ? hours.filter(item => item.faculty_id === person.id) : [],
    now,
    !!person.auto_busy_outside_hours,
  );
  const chosenPresence = chosen ? presenceFor(chosen) : null;

  useEffect(() => {
    if (!target || role !== "student") { setStickyReasons([]); return; }
    const saved = readFacultyReasons(userId, target);
    setStickyReasons(saved);
    if (saved[0] && !reason.trim()) setReason(saved[0]);
  }, [target, userId, role]);

  useEffect(() => {
    const panel = photoDialog.current;
    if (!panel) return;
    if (photoPreview) {
      if (!panel.open) panel.showModal();
      return;
    }
    if (panel.open) panel.close();
  }, [photoPreview]);

  useEffect(() => {
    const panel = dialog.current;
    if (!panel || role !== "student") return;

    if (target) {
      if (!openId.current) savedScroll.current = window.scrollY;
      openId.current = target;
      setAnchorId(target);
      const top = savedScroll.current;
      const pinScroll = () => window.scrollTo(0, top);
      if (!panel.open) panel.showModal();
      // showModal focuses the dialog node in-document (after the card grid) and can
      // scroll the page there — pin scroll so the list does not jump to the last card.
      pinScroll();
      requestAnimationFrame(() => {
        pinScroll();
        requestAnimationFrame(pinScroll);
      });
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.setTimeout(() => {
        pinScroll();
        form.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      }, reduce ? 0 : 30);
      return;
    }

    if (!openId.current) return;
    const restore = openId.current;
    openId.current = "";
    if (panel.open) panel.close();
    const top = savedScroll.current;
    requestAnimationFrame(() => {
      window.scrollTo(0, top);
      cards.current.get(restore)?.focus({ preventScroll: true });
    });
  }, [target, role]);

  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    const onClose = () => { if (openId.current) onCancel(); };
    const onCancelEvent = (event: Event) => { if (working || captureId) event.preventDefault(); };
    panel.addEventListener("close", onClose);
    panel.addEventListener("cancel", onCancelEvent);
    return () => {
      panel.removeEventListener("close", onClose);
      panel.removeEventListener("cancel", onCancelEvent);
    };
  }, [onCancel, working, captureId]);

  return <>
    <div className={styles.pageHead}>
      <div>
        <h1>{role === "admin" ? "Faculty." : "Find a time."}</h1>
        <p>{role === "student" ? "Choose someone to request a meeting." : "Who is free across campus. Email identifies each person."}</p>
      </div>
    </div>
    <div className={styles.directoryTools}>
      <label className={styles.searchLabel}>Search faculty
        <input
          value={search}
          onChange={event => {
            const next = event.target.value;
            setSearch(next);
            if (next.trim().length < 3) setActiveTopic("");
          }}
          placeholder={role === "admin" ? "Name, department, expertise, or email" : "Name, department, or topic"}
        />
      </label>
      {role === "student" && (
        <div className={styles.searchSuggestActions}>
          <button
            type="button"
            className={styles.secondary}
            disabled={search.trim().length < 3}
            onClick={() => setActiveTopic(search.trim())}
          >Suggest 3 for this topic</button>
        </div>
      )}
    </div>
    {departments.length > 0 && <div className={styles.chipRow} role="group" aria-label="Filter by department">
      <button type="button" className={!departmentFilter ? styles.chipActive : styles.chip} aria-pressed={!departmentFilter} onClick={() => setDepartmentFilter("")}>All departments</button>
      {departments.map(dept => (
        <button type="button" key={dept} className={departmentFilter === dept ? styles.chipActive : styles.chip} aria-pressed={departmentFilter === dept} onClick={() => setDepartmentFilter(dept)}>{dept}</button>
      ))}
    </div>}
    <div className={styles.filters} role="group" aria-label="Filter faculty">
      {([
        ["all", "All faculty"],
        ["available", "Available now"],
        ["recent", "Recent"],
        ...(role === "student" ? [["pinned", "Pinned"] as const] : []),
      ] as Array<["all" | "available" | "recent" | "pinned", string]>).map(([id, label]) => (
        <button type="button" key={id} aria-pressed={listMode === id && !search.trim()} onClick={() => { setListMode(id); setSearch(""); setActiveTopic(""); }}>{label}</button>
      ))}
    </div>
    {statusStale && <p className={styles.muted} role="status">Showing last-known status. Reconnect for live availability.</p>}
    {role === "student" && pinnedPeople.length > 0 && listMode !== "pinned" && <section className={styles.suggestStrip} aria-label="Pinned faculty">
      <h2 className={styles.suggestStripTitle}>Pinned</h2>
      <div className={styles.suggestStripRow}>
        {pinnedPeople.slice(0, 6).map(person => {
          const presence = presenceFor(person);
          const status = presence.status;
          return <button type="button" key={person.id} className={styles.suggestStripCard} onClick={() => onChoose(person.id)}>
            <strong>{person.name}</strong>
            <span className={styles.muted}>{person.department || "Not listed"}</span>
            <span className={`${styles.badge} ${status === "available" ? styles.good : status ? styles[status] : ""}`}>
              {status ? labels[status] : statusStale ? "Last known" : "Status unknown"}
            </span>
          </button>;
        })}
      </div>
    </section>}
    <p className={styles.resultCount} role="status">{visiblePeople.length ? `${visiblePeople.length} faculty` : "No faculty"}</p>
    {role === "student" && suggested.length > 0 && <section className={styles.suggestStrip} aria-label={`Suggested for ${activeTopic}`}>
      <h2 className={styles.suggestStripTitle}>Suggested for {activeTopic}</h2>
      <div className={styles.suggestStripRow}>
        {suggested.map(person => {
          const presence = presenceFor(person);
          const status = presence.status;
          return <button
            type="button"
            key={person.id}
            className={styles.suggestStripCard}
            onClick={() => onChoose(person.id)}
          >
            <strong>{person.name}</strong>
            <span className={styles.muted}>{person.department || "Not listed"}</span>
            <span className={`${styles.badge} ${status === "available" ? styles.good : status ? styles[status] : ""}`}>
              {status ? labels[status] : "Status unknown"}
            </span>
          </button>;
        })}
      </div>
    </section>}
    <div className={styles.facultyGrid}>
      {visiblePeople.map(person => {
        const presence = presenceFor(person);
        const selected = anchorId === person.id;
        const status = presence.status;
        const cabin = person.office_location || "Not listed";
        const placeInfo = waitingPlaces[person.id];
        const waiting = placeInfo?.waiting ?? waitingById[person.id] ?? 0;
        const cap = placeInfo?.cap ?? waitingCap;
        const line = waitingLineCopy(waiting, placeInfo?.myPlace, cap);
        const lastReply = lastReplyById[person.id];
        const personHours = hoursReady ? hours.filter(item => item.faculty_id === person.id) : [];
        const nextSlot = status !== "available" && personHours.length ? nextOfficeSlots(personHours, now, 1)[0] : undefined;
        const pinned = favoriteSet.has(person.id);
        const photoUrl = publicProfilePhotoUrl(person.photo_path);
        const open = () => { if (role === "student") onChoose(person.id); };
        return <article
          key={person.id}
          tabIndex={-1}
          ref={node => {
            if (node) cards.current.set(person.id, node);
            else cards.current.delete(person.id);
          }}
          className={`${styles.card} ${styles.facultyPick}${selected ? ` ${styles.facultyPickSelected}` : ""}`}
        >
          <div className={styles.facultyPickTop}>
            <button
              type="button"
              className={styles.facultyAvatarButton}
              aria-label={`View photo of ${person.name}`}
              onClick={() => setPhotoPreview({
                name: person.name,
                url: photoUrl,
                initial: person.name.charAt(0),
              })}
            >
              {photoUrl ? (
                <img className={styles.facultyAvatarImage} src={photoUrl} alt="" />
              ) : (
                <span className={styles.facultyAvatarFallback} aria-hidden="true">{person.name.charAt(0)}</span>
              )}
            </button>
            <h2 className={styles.facultyPickName}>{person.name}</h2>
            <div className={styles.facultyPickMeta}>
              <span className={`${styles.cardChip} ${statusChipClass(status, statusStale)}`}>
                {status ? labels[status] : statusStale ? "Last known" : "Status unknown"}
              </span>
              {person.pause_requests && <span className={`${styles.cardChip} ${styles.cardChipAway}`}>Paused</span>}
              {role === "student" && onToggleFavorite ? (
                <button
                  type="button"
                  className={`${styles.cardChip} ${styles.pinToggle}${pinned ? ` ${styles.pinToggleOn}` : ""}`}
                  disabled={working}
                  aria-pressed={pinned}
                  aria-label={pinned ? `Unpin ${person.name}` : `Pin ${person.name}`}
                  onClick={() => onToggleFavorite(person.id)}
                >{pinned ? "Pinned" : "Pin"}</button>
              ) : null}
            </div>
          </div>
          <dl className={styles.facultyMeta}>
            <div><dt>Department</dt><dd>{person.department || "Not listed"}</dd></div>
            {role === "admin" && <div><dt>Email</dt><dd>{person.email || "Not listed"}</dd></div>}
            <div><dt>Cabin</dt><dd>{cabin}</dd></div>
            {person.expertise?.trim() && <div><dt>Expertise</dt><dd>{person.expertise.trim()}</dd></div>}
          </dl>
          {person.portfolio?.trim() && <p className={styles.facultyPortfolio}>{person.portfolio.trim()}</p>}
          <p className={styles.muted}>{statusStale ? "Last known on this device" : presenceCopy(presence)}</p>
          {(status === "available" || status === "busy") && (() => {
            const note = (availability.find(item => item.faculty_id === person.id)?.walk_in_note || "").trim();
            return note ? <p className={`${styles.walkInBanner} ${status === "busy" ? styles.walkInBannerBusy : ""}`} role="status">{note}</p> : null;
          })()}
          {nextSlot && <p className={styles.muted}>Next office hours · {nextSlot.label}</p>}
          {line && <p className={styles.muted} role="status">{line}</p>}
          {lastReply && <p className={styles.muted}>Last reply · {stamp(lastReply)}</p>}
          {role === "student" && (
            <div className={styles.facultyCardActions}>
              {status === "available" && onRequestStatusNudge && (
                <StudentStatusNudgeButton
                  canAsk
                  asked={!!askedNudgeFaculty[person.id]}
                  blocked={!!blockedNudgeFaculty[person.id]}
                  working={working}
                  onAsk={() => onRequestStatusNudge(person.id)}
                />
              )}
              <button
                type="button"
                className={styles.facultyHintButton}
                aria-haspopup="dialog"
                aria-expanded={target === person.id}
                disabled={working}
                onClick={open}
              >
                Request a meeting
              </button>
            </div>
          )}
        </article>;
      })}
    </div>
    {!visiblePeople.length && <div className={styles.card}><p>{listMode === "pinned" ? "No pinned faculty yet." : "No one here."}</p><button className={styles.secondary} type="button" onClick={() => { setSearch(""); setActiveTopic(""); setListMode("all"); setDepartmentFilter(""); }}>Show all faculty</button></div>}

    <dialog
      ref={photoDialog}
      className={styles.photoDialog}
      aria-label={photoPreview ? `Photo of ${photoPreview.name}` : "Faculty photo"}
      onClose={() => setPhotoPreview(null)}
      onClick={event => { if (event.target === photoDialog.current) setPhotoPreview(null); }}
    >
      {photoPreview && (
        <div className={styles.photoDialogBody}>
          <button type="button" className={styles.requestBack} onClick={() => setPhotoPreview(null)}>Close</button>
          <h2 className={styles.photoDialogTitle}>{photoPreview.name}</h2>
          {photoPreview.url ? (
            <img className={styles.photoDialogImage} src={photoPreview.url} alt={photoPreview.name} />
          ) : (
            <div className={styles.photoDialogFallback} aria-hidden="true">{photoPreview.initial}</div>
          )}
        </div>
      )}
    </dialog>

    {role === "student" && <dialog ref={dialog} className={styles.requestDialog} aria-labelledby={titleId}>
      {chosen && <form ref={form} className={styles.requestDialogBody} onSubmit={onSend}>
        <div className={styles.requestDialogHead}>
          <button type="button" className={styles.requestBack} disabled={working || !!captureId} onClick={onCancel}>Back</button>
          <span className={styles.eyebrow}>MEETING REQUEST</span>
        </div>
        <h2 id={titleId}>{chosen.name}</h2>
        <dl className={styles.facultyMeta}>
          <div><dt>Department</dt><dd>{chosen.department || "Not listed"}</dd></div>
          <div><dt>Cabin</dt><dd>{chosen.office_location || "Not listed"}</dd></div>
          {chosen.expertise?.trim() && <div><dt>Expertise</dt><dd>{chosen.expertise.trim()}</dd></div>}
          <div><dt>Status</dt><dd>{chosenPresence?.status ? labels[chosenPresence.status] : "Status unknown"}</dd></div>
        </dl>
        {chosen.portfolio?.trim() && <p className={styles.facultyPortfolio}>{chosen.portfolio.trim()}</p>}
        {chosen.pause_requests && <p className={styles.muted} role="status">Requests paused — they are not taking new asks right now. You can still check status or ask them to update it.</p>}
        {(() => {
          const placeInfo = waitingPlaces[chosen.id];
          const waiting = placeInfo?.waiting ?? waitingById[chosen.id] ?? 0;
          const cap = placeInfo?.cap ?? waitingCap;
          const line = waitingLineCopy(waiting, placeInfo?.myPlace, cap);
          return line ? <p className={styles.muted} role="status">{line}</p> : null;
        })()}
        {(chosenPresence?.status === "available" || chosenPresence?.status === "busy") && (availability.find(item => item.faculty_id === chosen.id)?.walk_in_note || "").trim() && (
          <p className={`${styles.walkInBanner} ${chosenPresence.status === "busy" ? styles.walkInBannerBusy : ""}`} role="status">{(availability.find(item => item.faculty_id === chosen.id)?.walk_in_note || "").trim()}</p>
        )}
        {chosen.quiet_start && chosen.quiet_end && <p className={styles.muted} role="status">Quiet hours {String(chosen.quiet_start).slice(0, 5)}–{String(chosen.quiet_end).slice(0, 5)}. They may reply after quiet ends.</p>}
        {lastReplyById[chosen.id] && <p className={styles.muted}>Last reply · {stamp(lastReplyById[chosen.id])}</p>}
        {onToggleFavorite && (
          <button type="button" className={styles.link} disabled={working} onClick={() => onToggleFavorite(chosen.id)}>
            {favoriteSet.has(chosen.id) ? "Unpin from Find faculty" : "Pin for one-tap access"}
          </button>
        )}
        {chosenPresence?.status === "available" && onRequestStatusNudge && (
          <div className={styles.statusNudgeActions}>
            <StudentStatusNudgeButton
              canAsk
              asked={!!askedNudgeFaculty[chosen.id]}
              blocked={!!blockedNudgeFaculty[chosen.id]}
              working={working}
              onAsk={() => onRequestStatusNudge(chosen.id)}
            />
          </div>
        )}
        {chosen.pause_requests || (waitingPlaces[chosen.id]?.waiting ?? waitingById[chosen.id] ?? 0) >= (waitingPlaces[chosen.id]?.cap ?? waitingCap) ? (
          <div className={styles.actions}>
            <button type="button" disabled={working || !!captureId} onClick={onCancel}>Close</button>
          </div>
        ) : <>
          <p className={styles.muted}>Send a time and a short message.</p>
          <NaturalTimeInput label="When" value={preferred} onChange={setPreferred} required />
          {stickyReasons.length > 0 && <div className={styles.chipRow} role="group" aria-label="Your recent reasons">
            {stickyReasons.map(chip => (
              <button type="button" key={chip} className={reason === chip ? styles.chipActive : styles.chip} onClick={() => setReason(chip)}>{chip}</button>
            ))}
          </div>}
          <RequestChips value={reason} onPick={setReason} />
          <label>Message<textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="What do you need to discuss?" /></label>
          <VoiceNoteInput key={`${userId}-${chosen.id}`} value={requestVoice} onChange={changeRequestVoice} onBusyChange={busy => captureBusy("request", busy)} disabled={working} label="Voice note" />
          <div className={styles.actions}>
            <button className={styles.primary} disabled={working || !!captureId}>Send request</button>
            <button type="button" disabled={working || !!captureId} onClick={onCancel}>Cancel</button>
          </div>
        </>}
      </form>}
    </dialog>}
  </>;
}
