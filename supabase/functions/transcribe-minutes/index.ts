import { createClient } from "npm:@supabase/supabase-js@2.118.0";

function actionsFrom(raw: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const list = parsed && typeof parsed === "object" && Array.isArray((parsed as { actions?: unknown }).actions)
    ? (parsed as { actions: unknown[] }).actions : [];
  return list.slice(0, 20).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const text = String((item as { text?: unknown }).text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (text.length < 2) return [];
    const due = (item as { due_on?: unknown }).due_on;
    const due_on = typeof due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(due) && !Number.isNaN(Date.parse(`${due}T00:00:00Z`)) ? due : null;
    return [{ id: crypto.randomUUID(), text, due_on, done: false }];
  });
}

type TranscriptBody = { transcription?: string; error_code?: string; code?: string };

async function pulse(key: string, audio: Uint8Array, language: string) {
  const params = new URLSearchParams({ model: "pulse", language });
  return fetch(`https://api.smallest.ai/waves/v1/stt/?${params}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/octet-stream" },
    body: audio,
    signal: AbortSignal.timeout(40000),
  });
}

async function transcribe(key: string, audio: Blob) {
  const bytes = new Uint8Array(await audio.arrayBuffer());
  let response = await pulse(key, bytes, "multi-indic");
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as TranscriptBody;
    const code = detail.error_code || detail.code;
    if (code !== "LANGUAGE_NOT_ENABLED_IN_REGION") throw new Error("transcription");
    response = await pulse(key, bytes, "en");
    if (!response.ok) throw new Error("transcription");
  }
  const transcript = String((await response.json() as TranscriptBody).transcription ?? "").trim();
  if (!transcript) throw new Error("empty");
  return transcript;
}

function formatMinutes(raw: string) {
  const lines = raw.replace(/\r/g, "").split("\n").map(line => line.replace(/[^\S\n]+/g, " ").trim()).filter(Boolean);
  const bullets = lines.map(line => line.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "").trim()).filter(line => line.length > 1);
  if (bullets.length === 0) return "";
  return bullets.slice(0, 24).map(line => `- ${line.slice(0, 280)}`).join("\n");
}

async function englishMinutes(key: string, transcript: string) {
  const response = await fetch("https://api.smallest.ai/waves/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      model: "electron",
      temperature: 0,
      max_tokens: 2200,
      prompt_cache_key: "campuspulse-minutes-mom-v1",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Turn meeting speech into concise English minutes of the meeting.",
            "english must be short bullet points of only the important points: topics discussed, decisions, agreements, and key facts.",
            "Each bullet is one line starting with \"- \". Do not write a verbatim transcript. Skip filler, hesitation, repetition, and small talk.",
            "Do not invent facts. Keep names, dates, and numbers when spoken.",
            "actions are separate checklist tasks someone agreed to do. Action text is English. due_on is YYYY-MM-DD only when a calendar date was spoken, otherwise null.",
            "Do not put action items inside english unless they are also a decision.",
            "Return JSON {\"english\":\"- point\\n- point\",\"actions\":[{\"text\":\"\",\"due_on\":null}]}.",
          ].join(" "),
        },
        { role: "user", content: transcript.slice(0, 12000) },
      ],
    }),
  });
  if (!response.ok) throw new Error("translation");
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const raw = (body.choices?.[0]?.message?.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: { english?: unknown };
  try { parsed = JSON.parse(raw) as { english?: unknown }; } catch { throw new Error("translation"); }
  const english = formatMinutes(String(parsed.english ?? ""));
  if (english.length < 1) throw new Error("translation");
  return { english, actions: actionsFrom(raw) };
}

const APP_ORIGINS = new Set([
  "https://sygnetta.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "";
  const allow = APP_ORIGINS.has(origin) ? origin : "https://sygnetta.vercel.app";
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
const reply = (request: Request, body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders(request) });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders(request) });
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply(request, { ok: false, message: "Sign in again before transcribing." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(request, { ok: false, message: "Transcription is not available right now." }, 500);
  let minuteId = "";
  try {
    minuteId = String((await request.json() as { minute_id?: unknown }).minute_id ?? "");
  } catch { return reply(request, { ok: false, message: "Choose a meeting recording to transcribe." }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(minuteId)) return reply(request, { ok: false, message: "Choose a meeting recording to transcribe." }, 400);

  const userClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const user = await userClient.auth.getUser();
  if (user.error || !user.data.user) return reply(request, { ok: false, message: "Sign in again before transcribing." }, 401);
  const minute = await userClient.from("meeting_minutes").select("id,audio_path,status").eq("id", minuteId).maybeSingle();
  if (minute.error || !minute.data?.audio_path || minute.data.status !== "transcribing") {
    return reply(request, { ok: false, message: "This recording is not waiting for a transcript." }, 403);
  }

  const fail = (message: string) => admin.rpc("complete_meeting_transcript", {
    p_minute: minuteId, p_user: user.data.user.id, p_transcript: null, p_actions: [], p_failure: message,
  });
  const key = Deno.env.get("SMALLEST_API_KEY");
  if (!key) {
    await fail("Speech transcription is not connected yet. Type the minutes below.");
    return reply(request, { ok: false, message: "Speech transcription is not connected yet. Type the minutes below." });
  }
  try {
    const downloaded = await admin.storage.from("voice-notes").download(minute.data.audio_path);
    if (downloaded.error || !downloaded.data) throw new Error("audio");
    const spoken = await transcribe(key, downloaded.data);
    const minutes = await englishMinutes(key, spoken);
    const saved = await admin.rpc("complete_meeting_transcript", {
      p_minute: minuteId, p_user: user.data.user.id, p_transcript: minutes.english.slice(0, 12000), p_actions: minutes.actions, p_failure: null,
    });
    if (saved.error) throw new Error("save");
    return reply(request, { ok: true });
  } catch {
    await fail("The recording could not be transcribed. Type the minutes below.");
    return reply(request, { ok: false, message: "The recording could not be transcribed. Type the minutes below." });
  }
});
