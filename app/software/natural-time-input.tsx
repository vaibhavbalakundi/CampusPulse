"use client";
import { useId } from "react";
import { parseMeetingTime, type MeetingTimeDraft } from "../../lib/natural-meeting-time";
import styles from "./software.module.css";

const meetingHelp = "Include a date and time, like now or tomorrow at 10 pm.";
const deadlineHelp = "A date is enough, like tomorrow. Time is optional.";
const meetingConfirm = "The request expires at this time.";
const deadlineConfirm = "This note will show on that day.";

export function NaturalTimeInput({
  value, onChange, label, required = false, allowDateOnly = false,
  help, confirm,
}: {
  value: MeetingTimeDraft; onChange: (value: MeetingTimeDraft) => void; label: string; required?: boolean;
  allowDateOnly?: boolean; help?: string; confirm?: string;
}) {
  const id = useId();
  const confirmation = value.dateOnly
    ? "No clock time was given, so this uses the end of that day. You can still add a time if you want one."
    : (confirm ?? (allowDateOnly ? deadlineConfirm : meetingConfirm));
  return <div className={styles.naturalTime}>
    <label htmlFor={id}>{label}<input
      id={id}
      type="text"
      maxLength={150}
      autoComplete="off"
      value={value.text}
      required={required}
      placeholder={allowDateOnly ? "For example, tomorrow or tomorrow at 5 pm" : "For example, tomorrow at 10 pm"}
      aria-describedby={`${id}-help ${id}-result`}
      onChange={e => onChange(parseMeetingTime(e.target.value, new Date(), { allowDateOnly }))}
    /></label>
    <p className={styles.muted} id={`${id}-help`}>{help ?? (allowDateOnly ? deadlineHelp : meetingHelp)}</p>
    <div id={`${id}-result`} aria-live="polite" className={value.iso ? styles.parsedTime : styles.muted}>
      {value.preview && <strong>{value.iso ? "Understood: " : "Date: "}{value.preview}</strong>}
      {value.error && <p>{value.error}</p>}
      {value.iso && confirmation && <p>{confirmation}</p>}
    </div>
  </div>;
}
