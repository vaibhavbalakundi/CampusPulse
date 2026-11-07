"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./software.module.css";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const InstallContext = createContext<{ prompt: InstallPrompt | null; installed: boolean; ios: boolean; install: () => Promise<void> }>({ prompt: null, installed: false, ios: false, install: async () => {} });

export function PhoneAppProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null); const [installed, setInstalled] = useState(false); const [ios, setIos] = useState(false);
  const [offline, setOffline] = useState(false); const [waiting, setWaiting] = useState<ServiceWorker | null>(null); const [updating, setUpdating] = useState(false);
  const reloadForUpdate = useRef(false);
  useEffect(() => {
    let active = true; let registration: ServiceWorkerRegistration | null = null; let installing: ServiceWorker | null = null;
    const mode = window.matchMedia("(display-mode: standalone)");
    const updateMode = () => setInstalled(mode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    updateMode(); setIos(/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
    const network = () => setOffline(!navigator.onLine); network();
    const offer = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const installedApp = () => { setInstalled(true); setPrompt(null); };
    const changed = () => { if (reloadForUpdate.current) window.location.reload(); };
    const stateChanged = () => { if (active && installing?.state === "installed" && navigator.serviceWorker.controller) setWaiting(registration?.waiting ?? installing); };
    const foundUpdate = () => { installing?.removeEventListener("statechange", stateChanged); installing = registration?.installing ?? null; installing?.addEventListener("statechange", stateChanged); };
    window.addEventListener("beforeinstallprompt", offer); window.addEventListener("appinstalled", installedApp); window.addEventListener("online", network); window.addEventListener("offline", network); mode.addEventListener("change", updateMode);
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.addEventListener("controllerchange", changed);
      void navigator.serviceWorker.register("/software/sw.js", { scope: "/software/", updateViaCache: "none" }).then(value => {
        if (!active) return; registration = value; if (value.waiting) setWaiting(value.waiting); value.addEventListener("updatefound", foundUpdate); foundUpdate();
      }).catch(() => { /* Installation remains optional; normal sign-in still works. */ });
    }
    return () => { active = false; window.removeEventListener("beforeinstallprompt", offer); window.removeEventListener("appinstalled", installedApp); window.removeEventListener("online", network); window.removeEventListener("offline", network); mode.removeEventListener("change", updateMode); navigator.serviceWorker?.removeEventListener("controllerchange", changed); registration?.removeEventListener("updatefound", foundUpdate); installing?.removeEventListener("statechange", stateChanged); };
  }, []);
  async function install() { if (!prompt) return; const current = prompt; setPrompt(null); try { await current.prompt(); await current.userChoice; } catch { /* Manual platform instructions remain available. */ } }
  return <InstallContext.Provider value={{ prompt, installed, ios, install }}>{children}
    {offline && <div role="status" className={styles.appNotice}>You’re offline. Reconnect to check availability or send a request.</div>}
    {!offline && waiting && <div role="status" className={styles.appNotice}><span>An app update is ready. Finish or save your current draft before updating.</span><button type="button" disabled={updating} onClick={() => {reloadForUpdate.current = true; setUpdating(true); waiting.postMessage({ type: "ACTIVATE_UPDATE" });}}>{updating ? "Updating…" : "Update app"}</button></div>}
  </InstallContext.Provider>;
}

export function InstallPhoneApp() {
  const { prompt, installed, ios, install } = useContext(InstallContext);
  return <section className={styles.card}><span className={styles.eyebrow}>YOUR CAMPUS, ONE TAP AWAY</span><h2>{installed ? "CampusPulse is ready." : "Add CampusPulse to your phone."}</h2>
    <p>{installed ? "You’re using the installed app or have just completed installation. Sign in with your usual campus account." : "Keep CampusPulse on your home screen and open it in its own app window. Use the same account as the website."}</p>
    {prompt && !installed && <button type="button" className={styles.primary} onClick={() => void install()}>Install CampusPulse</button>}
    {installed && <a className={styles.secondary} href="/software/">Open your campus</a>}
    {!installed && <><h3>{ios ? "On this iPhone or iPad" : "Android"}</h3><ol><li>Open this website in {ios ? "Safari" : "Chrome"}.</li><li>{ios ? "Tap Share, then Add to Home Screen." : "Tap Install CampusPulse above when available, or open the browser menu and choose Install app / Add to Home screen."}</li><li>{ios ? "Turn on Open as Web App if shown, then tap Add." : "Confirm installation, then open CampusPulse from its home-screen icon."}</li></ol>{!ios && <><h3>iPhone or iPad</h3><p>Open this website in Safari, tap Share → Add to Home Screen, enable Open as Web App if shown, then tap Add.</p></>}</>}
    <p className={styles.muted}>If an in-app browser does not offer installation, open this address in Safari or Chrome. Signing in may be required again when you first open the installed app.</p>
  </section>;
}
