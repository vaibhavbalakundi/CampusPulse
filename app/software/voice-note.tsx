"use client";

import { useEffect, useId, useRef, useState } from "react";
import { supabase } from "../../lib/supabase-client";
import { downloadVoice, MAX_RECORD_SECONDS, MAX_VOICE_BYTES, prepareVoice, type VoiceDraft } from "../../lib/voice-notes";
import styles from "./software.module.css";

function useBlobUrl(blob: Blob | null) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) { setUrl(""); return; }
    const next = URL.createObjectURL(blob); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

type CapturePhase = "idle" | "permission" | "recording" | "processing";
type CaptureMode = "click" | "held" | "locked";

function VoiceIcon({ kind }: { kind: "mic" | "stop" | "finish" | "trash" | "lock" }) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "mic" ? <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></> : kind === "stop" ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/> : kind === "finish" ? <><path d="m4 4 17 8-17 8 3-8-3-8Z"/><path d="M7 12h14"/></> : kind === "trash" ? <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></> : <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/></>}</svg>;
}

export function VoiceNoteInput({ value, onChange, onBusyChange, disabled = false, label = "Voice note", limitSeconds = MAX_RECORD_SECONDS, readyHint = "Voice note ready. Preview it, then send your request or reply." }: {
  value: VoiceDraft | null; onChange: (value: VoiceDraft | null) => void; onBusyChange: (busy: boolean) => void; disabled?: boolean; label?: string; limitSeconds?: number; readyHint?: string;
}) {
  const id = useId();
  const [phase, setPhase] = useState<CapturePhase>("idle"); const phaseRef = useRef<CapturePhase>("idle");
  const [mode, setMode] = useState<CaptureMode>("click"); const modeRef = useRef<CaptureMode>("click");
  const [coarse, setCoarse] = useState(false); const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState(""); const [hint, setHint] = useState("");
  const [slide, setSlide] = useState({ up: 0, left: 0 });
  const recorder = useRef<MediaRecorder | null>(null); const stream = useRef<MediaStream | null>(null);
  const preview = useRef<HTMLAudioElement | null>(null);
  const generation = useRef(0); const mounted = useRef(false); const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null); const suppressClick = useRef(0);
  const heldPointer = useRef<number | null>(null);
  const callbacks = useRef({ onChange, onBusyChange }); callbacks.current = { onChange, onBusyChange };
  const url = useBlobUrl(value?.file ?? null);
  const active = phase !== "idle";
  function updatePhase(next: CapturePhase) { phaseRef.current = next; if (mounted.current) setPhase(next); }
  function clearCapture() {
    if (timer.current) clearInterval(timer.current); timer.current = null;
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
  }
  function cancel(message = "Recording discarded.") {
    generation.current++; gesture.current = null;
    const capture = recorder.current; recorder.current = null;
    if (capture) { capture.onstop = null; capture.ondataavailable = null; capture.onerror = null; if (capture.state !== "inactive") capture.stop(); }
    clearCapture(); updatePhase("idle"); callbacks.current.onBusyChange(false);
    if (mounted.current) { setSlide({ up: 0, left: 0 }); setHint(message); }
  }
  function finish() {
    gesture.current = null;
    if (phaseRef.current === "permission") { cancel("Hold until recording starts, then release to finish."); return; }
    const capture = recorder.current;
    if (phaseRef.current !== "recording" || !capture || capture.state === "inactive") return;
    updatePhase("processing"); capture.stop(); clearCapture();
  }
  useEffect(() => {
    mounted.current = true;
    const media = window.matchMedia("(pointer: coarse)"); const changePointer = () => setCoarse(media.matches); changePointer(); media.addEventListener("change", changePointer);
    const hide = () => { if (document.hidden) { if (phaseRef.current === "recording") finish(); else if (phaseRef.current === "permission") cancel(""); } };
    document.addEventListener("visibilitychange", hide);
    return () => { mounted.current = false; cancel(""); media.removeEventListener("change", changePointer); document.removeEventListener("visibilitychange", hide); };
  }, []);
  useEffect(() => { if (disabled && phaseRef.current !== "idle") cancel(""); }, [disabled]);
  async function record(nextMode: CaptureMode) {
    if (phaseRef.current !== "idle" || disabled) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("Recording is unavailable in this browser. Please use text instead."); return; }
    const version = ++generation.current; const earliest = Date.now() + (nextMode === "held" ? 180 : 0);
    modeRef.current = nextMode; setMode(nextMode); updatePhase("permission"); callbacks.current.onBusyChange(true); setError(""); setHint(""); setSeconds(0); setSlide({ up: 0, left: 0 }); preview.current?.pause();
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || version !== generation.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const delay = earliest - Date.now(); if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      if (!mounted.current || version !== generation.current) { media.getTracks().forEach(t => t.stop()); return; }
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(media, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined); recorder.current = capture;
      const chunks: Blob[] = []; let total = 0; let failed = false;
      capture.ondataavailable = e => { if (e.data.size) { chunks.push(e.data); total += e.data.size; if (total > MAX_VOICE_BYTES && capture.state === "recording") { failed = true; finish(); } } };
      capture.onerror = () => { failed = true; if (capture.state !== "inactive") finish(); else { cancel(""); setError("Recording was interrupted. Please try again or use text."); } };
      capture.onstop = async () => {
        clearCapture(); recorder.current = null; gesture.current = null;
        if (!mounted.current || version !== generation.current) return;
        updatePhase("processing");
        try {
          if (failed) throw new Error("Recording could not be saved. Please try again or use text.");
          const draft = await prepareVoice(new File(chunks, "voice-note", { type: capture.mimeType || chunks[0]?.type || "audio/webm" }));
          if (mounted.current && version === generation.current) { callbacks.current.onChange(draft); setHint(readyHint); }
        } catch (e) { if (mounted.current && version === generation.current) setError(e instanceof Error ? e.message : "Could not save this recording."); }
        finally { if (mounted.current && version === generation.current) { updatePhase("idle"); callbacks.current.onBusyChange(false); setSlide({ up: 0, left: 0 }); } }
      };
      capture.start(250); updatePhase("recording");
      const started = Date.now(); timer.current = setInterval(() => { setSeconds(Math.min(limitSeconds, Math.floor((Date.now() - started) / 1000))); if (Date.now() - started >= limitSeconds * 1000) finish(); }, 250);
    } catch (e) {
      if (mounted.current && version === generation.current) { clearCapture(); gesture.current = null; updatePhase("idle"); callbacks.current.onBusyChange(false); setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone access was denied. Enable it in your browser settings, or use text instead." : "Could not start the microphone. Try again or use text instead."); }
    }
  }
  function touchDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.pointerType === "mouse" || !e.isPrimary || e.button !== 0 || disabled) return;
    if (phaseRef.current !== "idle") { if (modeRef.current === "locked") suppressClick.current = 0; return; }
    e.preventDefault(); heldPointer.current = e.pointerId; gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; suppressClick.current = Date.now() + 800;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* Pointer may have ended while permissions changed. */ }
    void record("held");
  }
  function touchMove(e: React.PointerEvent<HTMLButtonElement>) {
    const start = gesture.current; if (!start || start.id !== e.pointerId) return;
    e.preventDefault(); suppressClick.current = Date.now() + 800;
    const up = Math.max(0, start.y - e.clientY); const left = Math.max(0, start.x - e.clientX);
    setSlide({ up: Math.min(1, up / 70), left: Math.min(1, left / 96) });
    if (phaseRef.current !== "recording") return;
    if (up >= 70 && up >= left) { modeRef.current = "locked"; setMode("locked"); gesture.current = null; setHint("Recording locked. Tap the arrow to finish, or the bin to discard."); navigator.vibrate?.(15); }
    else if (left >= 96 && left > up) cancel();
  }
  function touchEnd(e: React.PointerEvent<HTMLButtonElement>, interrupted = false) {
    if (e.pointerType === "mouse") return;
    if (heldPointer.current === e.pointerId) { suppressClick.current = Date.now() + 800; heldPointer.current = null; }
    if (gesture.current?.id !== e.pointerId) return;
    if (interrupted) cancel(); else finish();
  }
  const actionLabel = phase === "recording" ? mode === "locked" ? "Finish recording" : "Stop recording" : phase === "permission" ? "Waiting for microphone" : phase === "processing" ? "Preparing voice note" : coarse ? "Hold to record voice note" : value ? "Record again" : "Record voice note";
  return <div className={styles.voiceComposer} role="group" aria-label={label} aria-describedby={id + "-help"} onKeyDown={e => { if (e.key === "Escape" && active) { e.preventDefault(); cancel(); } }}>
    <span id={id + "-help"} className={styles.visuallyHidden}>{`Optional recording, up to ${limitSeconds > 60 ? Math.round(limitSeconds / 60) + " minutes" : limitSeconds + " seconds"}. Click to start and stop. On touch screens hold to record, release to finish, slide up to lock or left to cancel. Use the arrow to finish a locked recording. Escape discards. After it is sent, only the people allowed to hear it can access it.`}</span>
    {value && url && <div className={styles.voicePreview}><audio ref={preview} controls preload="metadata" src={url} aria-label={"Preview " + label.toLowerCase()} /><button type="button" className={styles.voiceDiscard} aria-label="Remove audio" title="Remove audio" disabled={disabled || active} onClick={() => { generation.current++; onChange(null); setError(""); setHint(""); }}><VoiceIcon kind="trash"/></button></div>}
    <div className={styles.micBar}>
      {active && <><button type="button" className={styles.voiceDiscard} aria-label="Discard recording" title="Discard recording" disabled={disabled || phase === "processing"} onClick={() => cancel()}><VoiceIcon kind="trash"/></button><span className={styles.recordingClock}><i/>{phase === "permission" ? "Starting…" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span><span className={styles.voiceWave} aria-hidden="true">{[0,1,2,3,4,5,6].map(n => <i key={n} style={{ animationDelay: n * 90 + "ms" }}/>)}</span></>}
      <div className={styles.micAnchor}>
        {active && mode !== "click" && <span className={styles.voiceLock} style={{ opacity: mode === "locked" ? 1 : .6 + slide.up * .4, transform: "translateY(" + (-slide.up * 10) + "px)" }} aria-hidden="true"><VoiceIcon kind="lock"/>{mode === "locked" ? "Locked" : "↑ Lock"}</span>}
        <button type="button" className={styles.micButton + (active ? " " + styles.micActive : "")} aria-label={actionLabel} title={actionLabel} aria-pressed={phase === "recording"} disabled={disabled || phase === "processing"} onPointerDown={touchDown} onPointerMove={touchMove} onPointerUp={e => touchEnd(e)} onPointerCancel={e => touchEnd(e, true)} onLostPointerCapture={e => touchEnd(e, true)} onContextMenu={e => e.preventDefault()} onClick={e => { if (e.detail > 0 && Date.now() < suppressClick.current) return; if (phaseRef.current === "idle") void record("click"); else if (phaseRef.current === "recording") finish(); }}>
          <VoiceIcon kind={phase === "recording" ? mode === "locked" ? "finish" : "stop" : "mic"}/>
        </button>
      </div>
    </div>
    {phase === "recording" && mode === "held" && <p className={styles.gestureHint} style={{ opacity: 1 - slide.left * .5 }}>← Slide to cancel · slide up to lock</p>}
    <span role="status" className={styles.visuallyHidden}>{phase === "recording" ? mode === "locked" ? "Recording locked." : "Recording started." : hint}</span>
    {hint && phase === "idle" && <p className={styles.gestureHint}>{hint}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>;
}

export function VoiceNotePlayer({ path, user, label }: { path: string; user: string; label: string }) {
  const [blob, setBlob] = useState<Blob | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null); const version = useRef(0); const url = useBlobUrl(blob);
  useEffect(() => { setBlob(null); setError(""); setBusy(false); return () => { version.current++; controller.current?.abort(); }; }, [path, user]);
  async function load() {
    if (!supabase) return;
    const attempt = ++version.current; const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 15000); setBusy(true); setError("");
    try { const audio = await downloadVoice(supabase, user, path, abort.signal); if (attempt === version.current) setBlob(audio); }
    catch { if (attempt === version.current) setError("Could not load this voice note. Check your connection and campus access, then retry."); }
    finally { clearTimeout(timer); if (attempt === version.current) setBusy(false); }
  }
  return <div className={styles.voicePlayback}><strong>{label}</strong>{url ? <audio src={url} controls preload="metadata" aria-label={label} /> : <button type="button" className={styles.secondary} disabled={busy} onClick={() => void load()}>{busy ? "Loading audio…" : error ? "Retry voice note" : "Load voice note"}</button>}{error && <p role="alert" className={styles.error}>{error}</p>}</div>;
}
