"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./software.module.css";

type Step = {
  eyebrow: string;
  title: string;
  body: string;
  tab?: string;
  target?: string;
};

const facultySteps: Step[] = [
  {
    eyebrow: "WELCOME",
    title: "Your faculty walkthrough.",
    body: "This short tour covers every main screen once. You can skip anytime. After you finish, it will not show again on this device.",
    tab: "home",
    target: "home",
  },
  {
    eyebrow: "OVERVIEW",
    title: "Start on Overview.",
    body: "Overview is your home. Set how students see you, clear waiting meeting asks, and glance at what is next today.",
    tab: "home",
    target: "home",
  },
  {
    eyebrow: "AVAILABLE",
    title: "What Available means.",
    body: "Available tells students you are open to meet now. They will prefer you when they search for someone free. Change it whenever your day shifts.",
    tab: "home",
    target: "status-available",
  },
  {
    eyebrow: "BUSY",
    title: "What Busy means.",
    body: "Busy means you are not free right now. Students still can ask for a later time. It does not block requests; it only signals that now is a poor moment.",
    tab: "home",
    target: "status-busy",
  },
  {
    eyebrow: "AWAY",
    title: "What Away means.",
    body: "Away means you are not taking campus meetings for a while. Students see that clearly. Use it for travel, leave, or days off campus.",
    tab: "home",
    target: "status-away",
  },
  {
    eyebrow: "WAITING",
    title: "Waiting asks on Overview.",
    body: "When a student sends a meeting request, a short preview appears here. Open inbox to answer with yes, no, or another time.",
    tab: "home",
    target: "faculty-waiting",
  },
  {
    eyebrow: "REQUESTS",
    title: "How you see requests.",
    body: "Requests is your full inbox. Each card shows the student, preferred time, note, and optional voice. Accept, decline, or offer another time. A badge on the sidebar counts what is still waiting.",
    tab: "requests",
    target: "requests",
  },
  {
    eyebrow: "MY DAY",
    title: "Your day checklist.",
    body: "My day gathers accepted meetings, office hours, and follow-ups for today. Check items off as you go so the day stays clear.",
    tab: "day",
    target: "day",
  },
  {
    eyebrow: "AVAILABILITY",
    title: "Hours and planned status.",
    body: "Availability settings let you set a status for a duration, add recurring office hours, and plan a status change for later. Students use hours as guidance when asking to meet.",
    tab: "timing",
    target: "timing",
  },
  {
    eyebrow: "PROFILE",
    title: "Expertise lives in Profile.",
    body: "Tap your name in the top bar to open Profile. Add expertise areas, a short portfolio, and your cabin. Students can search those fields when finding someone to meet.",
    tab: "home",
    target: "profile",
  },
  {
    eyebrow: "NOTICES",
    title: "Campus notices.",
    body: "Notices are official campus posts. Faculty can read them here. Keep an eye on Updates if you prefer a single alert stream.",
    tab: "notices",
    target: "notices",
  },
  {
    eyebrow: "EVENTS",
    title: "Club events.",
    body: "Events lists every club on campus. Follow only the clubs you want phone alerts and Updates from.",
    tab: "events",
    target: "events",
  },
  {
    eyebrow: "UPDATES",
    title: "Replies and alerts.",
    body: "Updates collects meeting replies, notices, and events you follow. Unread items show a count on the sidebar so nothing waits unseen.",
    tab: "updates",
    target: "updates",
  },
  {
    eyebrow: "DONE",
    title: "You are set.",
    body: "Set Available when you can meet, open Requests when students ask, and keep Profile filled so they can find you by expertise. Overview is always one tap away.",
    tab: "home",
    target: "home",
  },
];

const studentSteps: Step[] = [
  {
    eyebrow: "WELCOME",
    title: "Your campus walkthrough.",
    body: "A quick tour of the main screens. Skip anytime. It only shows once on this device after you finish.",
    tab: "day",
    target: "day",
  },
  {
    eyebrow: "MY DAY",
    title: "Start with My day.",
    body: "My day is home. See meetings, follow-ups, and what needs a reply without hunting through every tab.",
    tab: "day",
    target: "day",
  },
  {
    eyebrow: "FIND FACULTY",
    title: "Find someone to meet.",
    body: "Search by name, department, or expertise. Available, Busy, and Away show whether they are free now. Busy still allows a later ask.",
    tab: "home",
    target: "home",
  },
  {
    eyebrow: "REQUESTS",
    title: "Track your asks.",
    body: "My requests holds every meeting you sent. Watch for accept, decline, or another time, then keep notes on My day.",
    tab: "requests",
    target: "requests",
  },
  {
    eyebrow: "UPDATES",
    title: "Alerts in one place.",
    body: "Updates gathers replies, notices, and events from clubs you follow. Open it when the sidebar shows a count.",
    tab: "updates",
    target: "updates",
  },
];

const adminSteps: Step[] = [
  {
    eyebrow: "WELCOME",
    title: "Admin walkthrough.",
    body: "A short pass over the admin tools. Skip anytime. It will not repeat on this device after you finish.",
    tab: "admin",
    target: "admin",
  },
  {
    eyebrow: "CAMPUS ADMIN",
    title: "Start with pilot health.",
    body: "Campus admin opens on overview metrics: faculty, students, pending meetings, inactive accounts, and reply pace for the last week.",
    tab: "admin",
    target: "admin",
  },
  {
    eyebrow: "PEOPLE",
    title: "Invite by email or CSV.",
    body: "Send invites with campus email, name, department, and role. CSV can invite up to 2000 people. Their profile is active as soon as they set a password.",
    tab: "admin",
    target: "admin",
  },
  {
    eyebrow: "NOTICES",
    title: "Assign notice publishers.",
    body: "Authorize multiple people to publish notices. Search them by name or email, then post for the college, a department, or a role.",
    tab: "notices",
    target: "notices",
  },
  {
    eyebrow: "EVENTS",
    title: "Assign club posters.",
    body: "Grant event posting for one club at a time. Those people can post only for that club. Everyone can still browse all events.",
    tab: "events",
    target: "events",
  },
  {
    eyebrow: "DIRECTORY",
    title: "Faculty and students.",
    body: "Directory shows faculty and students. Switch tabs to browse either list. Email is the unique reference.",
    tab: "home",
    target: "home",
  },
];

function stepsFor(role: string) {
  if (role === "faculty") return facultySteps;
  if (role === "admin") return adminSteps;
  return studentSteps;
}

function clearHighlights() {
  document.querySelectorAll("[data-tour-current=true]").forEach(node => node.removeAttribute("data-tour-current"));
}

function highlightTarget(target?: string) {
  clearHighlights();
  if (!target) return null;
  const node = document.querySelector(`[data-tour="${target}"]`);
  if (node instanceof HTMLElement) {
    node.setAttribute("data-tour-current", "true");
    return node;
  }
  return null;
}

function placePopup(anchor: HTMLElement | null) {
  const width = Math.min(320, window.innerWidth - 32);
  const height = 240;
  if (!anchor) return { top: 88, left: 24, width };
  const box = anchor.getBoundingClientRect();
  let top = box.bottom + 12;
  let left = Math.min(Math.max(16, box.left), window.innerWidth - width - 16);
  if (top + height > window.innerHeight - 16) top = Math.max(16, box.top - height - 12);
  if (top < 16) top = 16;
  if (window.innerWidth <= 800) {
    left = Math.max(16, (window.innerWidth - width) / 2);
    top = Math.min(top, window.innerHeight - height - 16);
  }
  return { top, left, width };
}

export function CampusTour({ userId, role, onShow, pause }: { userId: string; role: string; onShow?: (id: string) => void; pause?: boolean }) {
  const key = `campuspulse.tour.v4.${userId}`;
  const steps = stepsFor(role);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState({ top: 88, left: 24, width: 320 });
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const step = steps[index] ?? steps[0];
  const deferred = !!pause;
  const show = open && !deferred;

  useEffect(() => {
    if (deferred) return;
    const timer = window.setTimeout(() => {
      try { if (!localStorage.getItem(key)) setOpen(true); } catch { setOpen(false); }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [key, deferred]);

  useEffect(() => {
    if (!show || !step?.tab) return;
    onShow?.(step.tab);
    // Navigate with each step; parent identity is stable enough for the tour lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, index, step?.tab]);

  useLayoutEffect(() => {
    if (!show) {
      clearHighlights();
      return;
    }
    let alive = true;
    const place = () => {
      if (!alive) return;
      const anchor = highlightTarget(step?.target);
      setPos(placePopup(anchor));
      dialog.current?.querySelector<HTMLButtonElement>("[data-tour-next]")?.focus();
    };
    const frame = window.requestAnimationFrame(place);
    // Tab content mounts after navigation; re-anchor once the target exists.
    const retry = window.setTimeout(place, 120);
    const onResize = () => place();
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retry);
      window.removeEventListener("resize", onResize);
    };
  }, [show, index, step?.target]);

  useEffect(() => {
    if (!show) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        next();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, index]);

  function finish() {
    clearHighlights();
    try { localStorage.setItem(key, "done"); } catch { /* tour may show again next visit */ }
    setOpen(false);
  }

  function next() {
    if (index >= steps.length - 1) finish();
    else setIndex(value => value + 1);
  }

  function back() {
    setIndex(value => Math.max(0, value - 1));
  }

  if (!show || typeof document === "undefined" || !step) return null;
  const last = index >= steps.length - 1;
  return createPortal(
    <>
      <div className={styles.tourScrim} aria-hidden="true" onClick={finish} />
      <div
        ref={dialog}
        className={styles.tour}
        style={{ top: pos.top, left: pos.left, width: pos.width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <p className={styles.eyebrow}>{step.eyebrow}</p>
        <h2 id={titleId}>{step.title}</h2>
        <p>{step.body}</p>
        <p className={styles.tourProgress}>{index + 1} of {steps.length}</p>
        <div className={styles.tourActions}>
          <button type="button" className={styles.link} onClick={finish}>Skip</button>
          <span>
            {index > 0 && <button type="button" className={styles.secondary} onClick={back}>Back</button>}
            <button type="button" data-tour-next className={styles.primary} onClick={next}>{last ? "Done" : "Next"}</button>
          </span>
        </div>
      </div>
    </>,
    document.body,
  );
}
