"use client";

import { useEffect, useRef, useState } from "react";
import { createDemo, deviceState, heartbeat, OFFLINE_MS, relativeTime, selectStatus, statuses, statusLabel, type Faculty, type Status } from "../lib/demo";

function normalizeDeviceUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    offline: <><path d="m3 3 18 18M8.5 8.5A8 8 0 0 1 20 9M4 9a12 12 0 0 1 1.5-1.4M7 13a7 7 0 0 1 4-1.9M11 17h2"/><circle cx="12" cy="20" r=".4"/></>,
    book: <><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    reset: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></>,
    device: <><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="8" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="16" cy="12" r="1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.info}</svg>;
}

// Preserved local prototype. It is not a public route and is not included in the deployed site.
export default function HardwareDemo() {
  const [faculty, setFaculty] = useState<Faculty[]>([]);
  const [now, setNow] = useState(0);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("All departments");
  const [filter, setFilter] = useState("All faculty");
  const [sort, setSort] = useState("Name A-Z");
  const [selectedId, setSelectedId] = useState("demo-01");
  const [paused, setPaused] = useState<string[]>(["demo-07"]);
  const [browserOffline, setBrowserOffline] = useState(false);
  const [message, setMessage] = useState("");
  const [deviceUrl, setDeviceUrl] = useState("");
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [pollDevice, setPollDevice] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const controls = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const hadLiveDevice = useRef(false);

  useEffect(() => {
    const time = Date.now(); setNow(time); setFaculty(createDemo(time));
    setBrowserOffline(!navigator.onLine);
    const online = () => setBrowserOffline(!navigator.onLine);
    window.addEventListener("online", online); window.addEventListener("offline", online);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); window.removeEventListener("online", online); window.removeEventListener("offline", online); };
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem("campuspulse-device-url");
    if (saved) { setDeviceUrl(saved); setPollDevice(true); }
  }, []);
  useEffect(() => {
    const base = normalizeDeviceUrl(deviceUrl);
    if (!pollDevice || !base) {
      setDeviceConnected(false);
      hadLiveDevice.current = false;
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`${base}/api/state?t=${Date.now()}`);
        if (!response.ok) throw new Error("Device request failed");
        const data = await response.json() as { status: Status; uptime?: number };
        if (!statuses.includes(data.status)) throw new Error("Invalid device status");
        if (!active) return;
        const time = Date.now();
        setNow(time);
        setDeviceConnected(true);
        hadLiveDevice.current = true;
        setPaused(ids => ids.filter(id => id !== selectedId));
        setFaculty(rows => rows.map(row => {
          if (row.id !== selectedId) return row;
          return row.status === data.status ? heartbeat(row, time) : selectStatus(row, data.status, time);
        }));
      } catch {
        if (!active) return;
        setDeviceConnected(false);
        if (hadLiveDevice.current) {
          hadLiveDevice.current = false;
          setPaused(ids => ids.includes(selectedId) ? ids : [...ids, selectedId]);
          const offlineAt = Date.now();
          setFaculty(rows => rows.map(row => row.id === selectedId
            ? { ...row, lastSeenAt: offlineAt - OFFLINE_MS }
            : row));
        }
      }
    };
    poll();
    const timer = window.setInterval(poll, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [deviceUrl, selectedId, pollDevice]);
  useEffect(() => {
    const timer = setInterval(() => {
      const time = Date.now();
      setFaculty(rows => rows.map(row => paused.includes(row.id) ? row : heartbeat(row, time)));
    }, 15000);
    return () => clearInterval(timer);
  }, [paused]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const selected = faculty.find(row => row.id === selectedId);
  const departments = [...new Set(faculty.map(row => row.department))].sort();
  const available = faculty.filter(row => row.status === "AVAILABLE" && deviceState(row, now).current).length;
  const visible = faculty.filter(row => {
    const matchesText = `${row.name} ${row.department} ${row.room}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesDepartment = department === "All departments" || row.department === department;
    const state = deviceState(row, now);
    const matchesStatus = filter === "All faculty" || (filter === "Needs update" ? !state.current : statusLabel[row.status] === filter && state.current);
    return matchesText && matchesDepartment && matchesStatus;
  }).sort((a, b) => sort === "Recently updated" ? b.updatedAt - a.updatedAt : a.name.localeCompare(b.name));

  function updateStatus(status: Status) {
    if (!selected || paused.includes(selected.id)) return;
    const time = Date.now(); setNow(time);
    setFaculty(rows => rows.map(row => row.id === selectedId ? selectStatus(row, status, time) : row));
    setMessage(`${selected.name} is now ${statusLabel[status].toLowerCase()}. Directory updated.`);
  }
  function toggleConnection() {
    if (!selected) return;
    const wasPaused = paused.includes(selectedId);
    const time = Date.now(); setNow(time);
    setPaused(ids => wasPaused ? ids.filter(id => id !== selectedId) : [...ids, selectedId]);
    // Reconnecting is a heartbeat, not a fresh faculty declaration.
    setFaculty(rows => rows.map(row => row.id === selectedId ? { ...row, lastSeenAt: wasPaused ? time : time - 120001 } : row));
    setMessage(wasPaused ? "Device reconnected. The declaration time is unchanged." : "Device disconnected. Last known status is retained.");
  }
  function reset() {
    const time = Date.now(); setNow(time); setFaculty(createDemo(time)); setPaused(["demo-07"]);
    setSelectedId("demo-01"); setQuery(""); setDepartment("All departments"); setFilter("All faculty"); setSort("Name A-Z");
    setMessage("Demo reset to the starting examples.");
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#directory" aria-label="CampusPulse home"><span className="brand-icon"><Icon name="pulse" size={26}/></span><span>Campus<span className="brand-light">Pulse</span><small>A LITTLE MORE CONNECTED.</small></span></a>
      <div className="workspace-label">CAMPUS WORKSPACE</div>
      <nav aria-label="Main navigation">
        <a className="nav-item active" href="#directory"><Icon name="grid"/>Faculty directory<span className="nav-dot"/></a>
        <button className="nav-item" onClick={() => dialog.current?.showModal()}><Icon name="book"/>How it works<Icon name="chevron" size={15}/></button>
        <a className="nav-item" href="/software/"><Icon name="pulse"/>Campus app<Icon name="chevron" size={15}/></a>
      </nav>
      <div className="sidebar-note"><span className="note-illustration"><Icon name="pulse" size={36}/></span><h3>A better time to connect.</h3><p>A quick status check can save a trip across campus.</p><button onClick={() => dialog.current?.showModal()}>Meet CampusPulse <Icon name="arrow" size={16}/></button></div>
      <div className="sidebar-bottom"><span className="demo-avatar">CP</span><div>CampusPulse prototype<small>Student experience · Demo</small></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Campus workspace <span>/</span> <strong>Faculty directory</strong></div><div className="topbar-right"><span className="demo-badge"><span/>Demo mode</span><span className="student-avatar" aria-label="Student view">S</span></div></header>
      <main id="directory">
        <section className="hero">
          <div className="eyebrow"><span/> LESS GUESSWORK. MORE CONNECTION.</div>
          <div className="hero-row"><div><h1>Good conversations start<br/>with <span>good timing.</span></h1><p>Find your faculty. Check their availability.<br className="mobile-break"/> Make the trip count.</p></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="art-card"><div className="art-avatar">AS</div><div className="art-lines"><span/><span/></div><span className="art-status"/><div className="art-pulse"><Icon name="pulse" size={68}/></div></div><span className="floating-tag"><span/>Available to connect</span><span className="art-spark">✦</span></div></div>
        </section>

        <section className="summary-row" aria-label="Directory overview">
          <div className="summary-item"><span className="summary-icon purple"><Icon name="grid"/></span><div><strong>{faculty.length || "0"}</strong><span>Faculty in directory</span></div></div>
          <div className="summary-item"><span className="summary-icon green"><Icon name="check"/></span><div><strong>{now ? available : "0"}<span className="small-unit">faculty</span></strong><span>Available · current declarations</span></div></div>
          <div className="summary-item"><span className="summary-icon cream"><Icon name="book"/></span><div><strong>{departments.length || "0"}</strong><span>Departments, one place</span></div></div>
          <div className="summary-caption"><span className="live-dot"/> Interactive demo<small>Fictional faculty. Simulated devices.</small></div>
        </section>

        {browserOffline && <div role="status" className="warning-banner"><Icon name="offline"/>You’re offline. This local demo still works; no campus data is being received.</div>}

        <div className="content-layout">
          <section className="directory-section" aria-labelledby="directory-title">
            <div className="section-heading"><div><h2 id="directory-title">Faculty directory</h2><p>Your next conversation is a search away.</p></div><span className="count-label">{faculty.length} faculty</span></div>
            <div className="search-row"><div className="search-field"><Icon name="search"/><input ref={search} aria-label="Search faculty" placeholder="Search by name, department or room…" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button className="clear-search" aria-label="Clear search" onClick={() => { setQuery(""); search.current?.focus(); }}><Icon name="close" size={15}/></button>}</div><select aria-label="Filter by department" value={department} onChange={event => setDepartment(event.target.value)}><option>All departments</option>{departments.map(value => <option key={value}>{value}</option>)}</select></div>
            <div className="filter-row"><div className="status-filters" role="group" aria-label="Filter by availability">{["All faculty", "Available", "Busy", "Away", "Needs update"].map(value => <button key={value} className={filter === value ? "selected" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value !== "All faculty" && <span className={`filter-dot ${value.toLowerCase().replace(" ", "-")}`}/>}<span>{value}</span></button>)}</div></div>
            <div className="results-toolbar"><span role="status">Showing <strong>{visible.length}</strong> of {faculty.length} faculty</span><label>Sort by <select aria-label="Sort faculty" value={sort} onChange={event => setSort(event.target.value)}><option>Name A-Z</option><option>Recently updated</option></select></label></div>
            {!now ? <div className="empty-state" role="status">Loading demo faculty…</div> : visible.length === 0 ? <div className="empty-state"><span className="empty-icon"><Icon name="search" size={28}/></span><h3>No faculty found</h3><p>Try another name or adjust your filters.</p><button className="primary-button" onClick={() => { setQuery(""); setDepartment("All departments"); setFilter("All faculty"); }}>Clear all filters</button></div> : <div className="faculty-grid">{visible.map(row => {
              const state = deviceState(row, now);
              return <article className={`faculty-card ${state.current ? "" : "has-warning"}`} key={row.id}>
                <div className="card-top"><span className={`faculty-avatar ${row.color}`}>{row.name.replace(/^(Dr\.|Prof\.) /, "").split(" ").map(part => part[0]).slice(0, 2).join("")}</span><span className={`status-badge ${state.current ? row.status.toLowerCase() : "unknown"}`}><span/>{statusLabel[row.status]}{!state.current && <span className="sr-only"> (last known)</span>}</span></div>
                <h3>{row.name}</h3><p className="faculty-title">{row.title}</p><span className="department-tag">{row.department}</span>
                <div className="card-room"><Icon name="pin" size={16}/>{row.room}</div>
                <div className="card-footer"><span title={new Date(row.updatedAt).toLocaleString()}><Icon name="clock" size={14}/>Updated {relativeTime(row.updatedAt, now)}</span><button aria-label={`Try desk controls for ${row.name}`} title="Try this faculty member’s demo device" onClick={() => { setSelectedId(row.id); controls.current?.scrollIntoView({ behavior: "smooth", block: "center" }); document.getElementById("demo-faculty")?.focus({ preventScroll: true }); }}><Icon name="arrow" size={17}/></button></div>
                {!state.current && <div className="card-warning"><Icon name={state.offline ? "offline" : "clock"} size={13}/>{state.offline ? `Last reported ${statusLabel[row.status]} · updated ${relativeTime(row.updatedAt, now)}` : `Status not current · last reported ${statusLabel[row.status]} · ${relativeTime(row.updatedAt, now)}`}</div>}
              </article>;
            })}</div>}
            <div className="directory-footnote"><Icon name="info" size={16}/><p>Availability is shared by faculty, not detected. A status is an invitation to check in, not a guarantee of presence.</p></div>
          </section>

          <aside className="demo-panel" ref={controls} aria-labelledby="demo-title">
            <div className="panel-kicker"><Icon name="device" size={17}/> THE INTERACTIVE PART</div><h2 id="demo-title">Try the desk device.</h2><p className="panel-intro">One button on a faculty desk.<br/>An update for everyone.</p>
            <label className="field-label" htmlFor="demo-faculty">FACULTY FOR THIS DEVICE</label><select id="demo-faculty" value={selectedId} onChange={event => setSelectedId(event.target.value)}>{faculty.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
            <label className="field-label device-url-label" htmlFor="device-url">NODEMCU ADDRESS (SAME WI-FI)</label>
            <div className="device-url-row">
              <input id="device-url" className="device-url-field" value={deviceUrl} onChange={event => { setDeviceUrl(event.target.value); localStorage.setItem("campuspulse-device-url", event.target.value.trim()); }} placeholder="http://192.168.1.50" autoComplete="off" spellCheck={false} />
              <button type="button" className="device-connect-button" onClick={() => {
                const next = normalizeDeviceUrl(deviceUrl);
                if (!next) { setPollDevice(false); return; }
                setDeviceUrl(next);
                localStorage.setItem("campuspulse-device-url", next);
                hadLiveDevice.current = false;
                setPollDevice(true);
              }}>{deviceConnected ? "Reconnect" : "Connect"}</button>
            </div>
            <div className="device-model"><div className="device-header"><span className="device-wordmark"><Icon name="pulse" size={15}/>CampusPulse</span><span className="device-serial">{deviceConnected ? "LIVE NODEMCU" : "DESK UNIT / DEMO"}</span></div><div className="led-row"><span className={`led ${selected?.status === "AVAILABLE" ? "green on" : ""}`} aria-label={`Green LED ${selected?.status === "AVAILABLE" ? "on" : "off"}`}/><span className={`led ${selected?.status === "BUSY" ? "yellow on" : ""}`} aria-label={`Yellow LED ${selected?.status === "BUSY" ? "on" : "off"}`}/></div><div className="device-buttons">{statuses.map(status => <button key={status} className={`device-button ${status.toLowerCase()} ${selected?.status === status ? "pressed" : ""}`} aria-label={`Set ${statusLabel[status]} status`} aria-pressed={selected?.status === status} disabled={!selected || paused.includes(selectedId) || deviceConnected} onClick={() => updateStatus(status)}><span className="button-cap"><Icon name={status === "AVAILABLE" ? "check" : status === "BUSY" ? "clock" : "arrow"} size={19}/></span><span>{statusLabel[status]}</span></button>)}</div><div className="device-bottom"><span className={`connection-dot ${deviceConnected ? "" : paused.includes(selectedId) || (pollDevice && deviceUrl) ? "disconnected" : ""}`}/>{deviceConnected ? "Live device connected" : pollDevice && deviceUrl ? "Device unavailable · faculty card shows last report" : "Simulated device connected"}</div></div>
            <div className="demo-hint"><span className="hint-step">↗</span><p>Press a button and watch the faculty card update instantly.</p></div>
            <button className="connection-button" onClick={toggleConnection}><Icon name="offline" size={16}/>{paused.includes(selectedId) ? "Reconnect demo device" : "Simulate device going offline"}</button>
            <div className="panel-divider"/><div className="how-mini"><span className="mini-info"><Icon name="info" size={16}/></span><div><strong>A declaration, not detection.</strong><p>Faculty choose their status. There are no presence sensors or attendance tracking.</p></div></div>
            <button className="reset-button" onClick={reset}><Icon name="reset" size={14}/>Reset demo</button>
          </aside>
        </div>
        <footer className="page-footer"><span><Icon name="pulse" size={16}/>CampusPulse <span className="footer-dot">·</span> Built for better campus connections.</span><span>Prototype preview <span className="footer-dot">/</span> All records are fictional</span></footer>
      </main>
    </div>
    <div className={`toast ${message ? "shown" : ""}`} role="status" aria-live="polite">{message && <><Icon name="check" size={18}/>{message}</>}</div>
    <dialog ref={dialog} className="info-dialog"><div className="dialog-top"><span className="panel-kicker">A LITTLE MORE CONNECTED</span><button className="icon-button" aria-label="Close explanation" onClick={() => dialog.current?.close()}><Icon name="close"/></button></div><h2>A quick check.<br/>A better conversation.</h2><p>CampusPulse helps students find a good time to consult faculty, before walking across campus.</p><ol><li><strong>Faculty choose their availability.</strong><span>Three buttons on a desk device declare Available, Busy, or Away.</span></li><li><strong>The directory receives the update.</strong><span>The intended prototype sends device updates to a shared backend. This demo simulates that interaction in your browser.</span></li><li><strong>Students check before visiting.</strong><span>Search the directory and check both the declaration time and device connectivity.</span></li></ol><div className="dialog-note">A heartbeat only tells us the device is connected. It does not establish that a faculty member is in their cabin. Old declarations are marked stale after 30 minutes in this demo.</div><button className="primary-button" onClick={() => dialog.current?.close()}>Explore the directory <Icon name="arrow" size={17}/></button></dialog>
  </div>;
}
