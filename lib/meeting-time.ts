export function meetingState(status: string, meetingAt: string | null | undefined, now: number) {
  return ["pending", "accepted", "alternative"].includes(status) && meetingAt && Date.parse(meetingAt) <= now ? "expired" : status;
}
export function localMeetingIso(value: string, now = Date.now()) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time <= now || time > now + 180 * 24 * 60 * 60 * 1000) throw new Error("Choose a future meeting time within 180 days.");
  return new Date(time).toISOString();
}
