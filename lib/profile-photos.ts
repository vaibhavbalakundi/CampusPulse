import type { SupabaseClient } from "@supabase/supabase-js";

export const PROFILE_PHOTO_BUCKET = "profile-photos";
export const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;

const photoMimes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ProfilePhotoDraft = { file: File; id: string; mime: string; extension: string };

export function profilePhotoPath(user: string, draft: ProfilePhotoDraft) {
  return `${user}/${draft.id}.${draft.extension}`;
}

export function publicProfilePhotoUrl(path: string | null | undefined) {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${PROFILE_PHOTO_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function prepareProfilePhoto(file: File): Promise<ProfilePhotoDraft> {
  if (!file.size) throw new Error("This file is empty. Choose another photo.");
  if (file.size > MAX_PROFILE_PHOTO_BYTES) throw new Error("Photos must be 2 MB or smaller.");
  let mime = file.type.toLowerCase().split(";")[0].trim();
  if (mime === "image/jpg") mime = "image/jpeg";
  if (!mime) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "";
  }
  const extension = photoMimes[mime];
  if (!extension) throw new Error("Use a JPG, PNG, or WEBP photo.");
  return { file, id: crypto.randomUUID(), mime, extension };
}

async function authHeaders(client: SupabaseClient, user: string) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session || data.session.user.id !== user) throw new Error("Your account changed. Please sign in again.");
  return { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${data.session.access_token}` };
}

export async function uploadProfilePhoto(client: SupabaseClient, user: string, draft: ProfilePhotoDraft, signal?: AbortSignal) {
  const path = profilePhotoPath(user, draft);
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${PROFILE_PHOTO_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { ...await authHeaders(client, user), "Content-Type": draft.mime, "Cache-Control": "public, max-age=3600", "x-upsert": "true" },
    body: draft.file,
    signal,
  });
  if (!response.ok) throw new Error("Could not upload the photo. Please try again.");
  return path;
}

export async function removeProfilePhotoObject(client: SupabaseClient, path: string) {
  try { await client.storage.from(PROFILE_PHOTO_BUCKET).remove([path]); } catch { /* ignore orphan cleanup */ }
}
