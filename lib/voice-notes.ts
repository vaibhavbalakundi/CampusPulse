import type { SupabaseClient } from "@supabase/supabase-js";

export const VOICE_BUCKET = "voice-notes";
export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
export const MAX_RECORD_SECONDS = 60;
export type VoiceDraft = { file: File; id: string; mime: string; extension: string };
const formats: Record<string, string> = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav",
};
export function voiceFormat(type: string, name = "") {
  let mime = type.toLowerCase().split(";")[0].trim();
  if (["audio/x-wav", "audio/wave"].includes(mime)) mime = "audio/wav";
  if (mime === "audio/x-m4a") mime = "audio/mp4";
  if (!mime) mime = Object.entries(formats).find(([, ext]) => name.toLowerCase().endsWith(`.${ext}`))?.[0] ?? "";
  if (!formats[mime]) throw new Error("Choose a WebM, Ogg, M4A, MP3 or WAV audio file.");
  return { mime, extension: formats[mime] };
}
export async function prepareVoice(file: File): Promise<VoiceDraft> {
  if (!file.size) throw new Error("This recording is empty. Please try again.");
  if (file.size > MAX_VOICE_BYTES) throw new Error("Voice notes must be 5 MB or smaller.");
  const format = voiceFormat(file.type, file.name);
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const text = (start: number, end: number) => String.fromCharCode(...b.slice(start, end));
  const valid = format.extension === "webm" ? b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
    : format.extension === "ogg" ? text(0, 4) === "OggS"
    : format.extension === "wav" ? text(0, 4) === "RIFF" && text(8, 12) === "WAVE"
    : format.extension === "m4a" ? text(4, 8) === "ftyp"
    : text(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
  if (!valid) throw new Error("This file does not match a supported audio format. Please choose another recording.");
  return { file, id: crypto.randomUUID(), ...format };
}
export const voicePath = (user: string, draft: VoiceDraft) => `${user}/${draft.id}.${draft.extension}`;

// Direct authenticated requests allow cancellation; neither public nor signed URLs are created.
async function voiceHeaders(client: SupabaseClient, user: string) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session || data.session.user.id !== user) throw new Error("Your account changed. Please sign in again.");
  return { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${data.session.access_token}` };
}
const objectUrl = (path: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${VOICE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
export async function uploadVoice(client: SupabaseClient, user: string, draft: VoiceDraft, signal: AbortSignal) {
  const path = voicePath(user, draft);
  const response = await fetch(objectUrl(path), {
    method: "POST", headers: { ...await voiceHeaders(client, user), "Content-Type": draft.mime, "Cache-Control": "no-store", "x-upsert": "false" },
    body: draft.file, signal,
  });
  // A retry uses the same random path and immutable bytes. The RPC still checks ownership and attachment.
  if (!response.ok && response.status !== 409 && response.status !== 400) throw new Error("Could not upload the voice note. Your draft is kept; please try again.");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (String(body.statusCode) !== "409" && body.error !== "Duplicate" && body.code !== "Duplicate") throw new Error("Could not upload the voice note. Check your access and try again.");
  }
  return path;
}
export async function downloadVoice(client: SupabaseClient, user: string, path: string, signal: AbortSignal) {
  const response = await fetch(objectUrl(path), { headers: await voiceHeaders(client, user), signal, cache: "no-store" });
  if (!response.ok) throw new Error("Could not load this voice note. Check your connection and campus access, then retry.");
  return response.blob();
}
export async function discardVoice(client: SupabaseClient, user: string, draft: VoiceDraft) {
  // Storage policies refuse deletion of an attached note, including after a lost RPC response.
  try { await client.storage.from(VOICE_BUCKET).remove([voicePath(user, draft)]); } catch { /* A later cleanup can remove an abandoned draft. */ }
}
