import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// pg_cron sends a signed, two-minute, single-use ticket. The signing key stays in Vault.
// The platform supplies service credentials only to this server runtime.
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const token = request.headers.get("x-campus-job-token");
  if (!token || !/^\d{10,12}\.[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(token)) return new Response("Unauthorized", { status: 401 });
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) },
  });
  try {
    const auth = await client.rpc("validate_retention_job_token", { p_token: token });
    if (auth.error || auth.data !== true) return new Response("Unauthorized", { status: 401 });
    const expired = await client.rpc("expire_meeting_requests");
    if (expired.error) throw new Error("expiry");
    const result = await client.rpc("meeting_retention_candidates");
    if (result.error) throw new Error("candidates");
    const rows = result.data.requests as { id: string; request_voice_path: string | null; response_voice_path: string | null; minutes_voice_path?: string | null }[];
    const paths = [...new Set<string>([...rows.flatMap(r => [r.request_voice_path, r.response_voice_path, r.minutes_voice_path].filter((p): p is string => !!p)), ...result.data.orphans])];
    if (paths.length) {
      const removed = await client.storage.from("voice-notes").remove(paths);
      if (removed.error) throw new Error("storage");
    }
    const final = rows.length ? await client.rpc("finalize_meeting_retention", { p_ids: rows.map(r => r.id) }) : { data: 0, error: null };
    if (final.error) throw new Error("finalize");
    // Counts only: never log message bodies, object paths, credentials or request headers.
    console.log(JSON.stringify({ event: "meeting_maintenance", expired: expired.data, records_removed: final.data, audio_objects: paths.length }));
    return Response.json({ ok: true, expired: expired.data, records_removed: final.data, audio_objects: paths.length });
  } catch {
    console.error(JSON.stringify({ event: "meeting_maintenance_failed" }));
    return Response.json({ ok: false }, { status: 500 });
  }
});
