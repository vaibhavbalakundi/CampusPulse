import type { SupabaseClient } from "@supabase/supabase-js";

export const CAMPUS_FILES_BUCKET = "campus-files";
export const MAX_CAMPUS_FILE_BYTES = 10 * 1024 * 1024;

export type CampusFileKind = "event" | "notice";
export type CampusFileDraft = { file: File; id: string; mime: string; extension: string; name: string };

const eventMimes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const noticeMimes: Record<string, string> = {
  ...eventMimes,
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

const extensionFallback: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function normalizeMime(type: string, name: string, kind: CampusFileKind) {
  let mime = type.toLowerCase().split(";")[0].trim();
  if (mime === "image/jpg") mime = "image/jpeg";
  const allowed = kind === "event" ? eventMimes : noticeMimes;
  if (!mime) {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    mime = extensionFallback[ext] ?? "";
  }
  const extension = allowed[mime];
  if (!extension) {
    throw new Error(
      kind === "event"
        ? "Event posters must be JPG, PNG, WEBP, or GIF."
        : "Notices accept PDF, images, or common office documents.",
    );
  }
  return { mime, extension };
}

export async function prepareCampusFile(file: File, kind: CampusFileKind): Promise<CampusFileDraft> {
  if (!file.size) throw new Error("This file is empty. Choose another file.");
  if (file.size > MAX_CAMPUS_FILE_BYTES) throw new Error("Files must be 10 MB or smaller.");
  const format = normalizeMime(file.type, file.name, kind);
  const name = file.name.trim().slice(0, 180) || `attachment.${format.extension}`;
  return { file, id: crypto.randomUUID(), name, ...format };
}

export const campusFilePath = (user: string, draft: CampusFileDraft) => `${user}/${draft.id}.${draft.extension}`;

async function fileHeaders(client: SupabaseClient, user: string) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session || data.session.user.id !== user) throw new Error("Your account changed. Please sign in again.");
  return { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${data.session.access_token}` };
}

const objectUrl = (path: string) =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${CAMPUS_FILES_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;

export async function uploadCampusFile(client: SupabaseClient, user: string, draft: CampusFileDraft, signal?: AbortSignal) {
  const path = campusFilePath(user, draft);
  const response = await fetch(objectUrl(path), {
    method: "POST",
    headers: { ...await fileHeaders(client, user), "Content-Type": draft.mime, "Cache-Control": "no-store", "x-upsert": "false" },
    body: draft.file,
    signal,
  });
  if (!response.ok && response.status !== 409 && response.status !== 400) {
    throw new Error("Could not upload the file. Please try again.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (String(body.statusCode) !== "409" && body.error !== "Duplicate" && body.code !== "Duplicate") {
      throw new Error("Could not upload the file. Check your access and try again.");
    }
  }
  return path;
}

export async function discardCampusFile(client: SupabaseClient, user: string, draft: CampusFileDraft) {
  try { await client.storage.from(CAMPUS_FILES_BUCKET).remove([campusFilePath(user, draft)]); } catch { /* abandoned drafts are cleaned later */ }
}

export async function signedCampusFileUrl(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage.from(CAMPUS_FILES_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error("Could not open this file.");
  return data.signedUrl;
}

export function isImageMime(mime?: string | null) {
  return !!mime && mime.startsWith("image/");
}

export function isPdfMime(mime?: string | null) {
  return mime === "application/pdf";
}

export function isTextMime(mime?: string | null) {
  return mime === "text/plain" || mime === "text/csv";
}

export function isOfficeMime(mime?: string | null) {
  return !!mime && (
    mime === "application/msword"
    || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || mime === "application/vnd.ms-excel"
    || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || mime === "application/vnd.ms-powerpoint"
    || mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
}

export function officeEmbedUrl(fileUrl: string) {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
}
