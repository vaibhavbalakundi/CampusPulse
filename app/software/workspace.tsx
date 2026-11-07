"use client";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./software.module.css";

export function WorkspaceIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    home: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    requests: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/></>,
    timing: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h3"/></>,
    updates: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    day: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16"/></>,
    notices: <><path d="M6 4h9l3 3v13H6z"/><path d="M15 4v3h3M8 12h8M8 16h6"/></>,
    events: <><path d="M5 8h14v11H5z"/><path d="M8 8V5h8v3M8 13h8M8 16h5"/></>,
    admin: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m3 11v-3a6 6 0 0 0-2-4"/></>,
    pulse: <path d="M2 12h5l3-8 4 16 3-8h5"/>,
  };
  const icon = name === "Requests" ? "requests" : name === "Availability settings" ? "timing" : name;
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[icon] ?? paths.home}</svg>;
}

export function WorkspaceBrand() {
  return <a className={styles.brand} href="/software/"><span className={styles.mark}><WorkspaceIcon name="pulse"/></span><span><strong>Campus<span>Pulse</span></strong><small>SYGNETTA</small></span></a>;
}

export function WorkspaceLoading() {
  return <div className={`${styles.app} ${styles.workspaceLoading}`} aria-busy="true" aria-live="polite">
    <header className={styles.topBar}><WorkspaceBrand/><div className={styles.loadIdentity} aria-hidden="true"><span /><span /></div></header>
    <aside className={styles.sidebar} aria-hidden="true">
      <span className={styles.workspaceLabel}>CAMPUS WORKSPACE</span>
      <div className={styles.loadNav}>{[0, 1, 2, 3, 4].map(item => <span key={item} />)}</div>
    </aside>
    <div className={styles.workspace}>
      <main className={styles.main}>
        <div className={styles.loadPanel}>
          <span className={styles.loadMark} aria-hidden="true"><WorkspaceIcon name="pulse" /></span>
          <p className={styles.eyebrow}>CAMPUSPULSE</p>
          <h1>Opening your day.</h1>
          <p>Gathering meetings, notices, and who’s free.</p>
          <div className={styles.loadBars} aria-hidden="true"><span /><span /><span /></div>
        </div>
      </main>
    </div>
  </div>;
}

type Tab = { id: string; title: string; count?: number };
export function Workspace({ name, role, detail = "", tabs, active, onNavigate, onSignOut, children }: {
  name: string; role: string; detail?: string; tabs: Tab[]; active: string; onNavigate: (id: string) => void; onSignOut?: () => void; children: ReactNode;
}) {
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    const current = nav?.querySelector<HTMLButtonElement>("[aria-current='page']");
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const left = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
  }, [active]);
  const who = `${role}${detail ? ` · ${detail}` : ""}`;
  return <div className={styles.app}>
    <a className={styles.skipLink} href="#workspace-content">Skip to content</a>
    <header className={styles.topBar}>
      <WorkspaceBrand/>
      <div className={styles.identity}><span className={styles.accountAvatar}>{name.charAt(0)}</span><span><strong>{name}</strong><small>{who}</small></span>{onSignOut && <button type="button" onClick={onSignOut}>Sign out</button>}</div>
    </header>
    <aside className={styles.sidebar}>
      <span className={styles.workspaceLabel}>CAMPUS WORKSPACE</span>
      <nav ref={navigation} className={styles.nav} aria-label="Main navigation">{tabs.map(t => <button key={t.id} type="button" data-tour={t.id} className={active === t.id ? styles.activeNav : ""} aria-current={active === t.id ? "page" : undefined} onClick={() => onNavigate(t.id)}><WorkspaceIcon name={t.id}/><span>{t.title}</span>{!!t.count && <b>{t.count}<span className={styles.visuallyHidden}>{t.id === "updates" ? " unread" : " pending"}</span></b>}</button>)}</nav>
      <div className={styles.sidebarNote}><WorkspaceIcon name="pulse"/><h2>A little clarity.<br/>A better conversation.</h2><p>Your campus connections, all in one place.</p></div>
    </aside>
    <div className={styles.workspace}>{children}<footer className={styles.workspaceFooter}><a className={styles.installLink} href="/software/install/">Install phone app</a><a className={styles.demoLink} href="/software/help/">Help & privacy</a></footer></div>
  </div>;
}
