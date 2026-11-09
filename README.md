# CampusPulse by Sygnetta

The public introduction is [sygnetta.vercel.app](https://sygnetta.vercel.app/). Sign-in and the campus workspace are at [sygnetta.vercel.app/software/](https://sygnetta.vercel.app/software/). Faculty availability is shown only for the signed-in institution. It uses Supabase Auth, institution-scoped data and private audio storage. Hardware integration is deferred. The old fictional directory and desk-device screen are kept in `demo/` and are not published.

Install CampusPulse from [the phone installation page](https://sygnetta.vercel.app/software/install/). On Android, open it in Chrome and choose Install app. On iPhone, open it in Safari and use Share → Add to Home Screen. Accounts and campus data require connectivity; offline launches show a generic reconnect screen. Microphone access is requested only when recording a voice note.

Run `pnpm build` for a release. This exports the site and generates the security headers and public-only offline cache version in `out/`; deploying an export without the postbuild step omits required release configuration. Use `pnpm preview` to serve that configuration locally. See the [phone-app security verification](../docs/phone-app-security-verification-2026-11-04.md) for test results and remaining device/provider acceptance work.

Students can request meetings with text or voice notes and ordinary-English timing such as “tomorrow at 10 pm”. Faculty can respond with text/audio and propose another time. The app previews the interpreted date, time and time zone. Requests expire at the effective meeting time; their records, updates and audio remain accessible for 45 days afterward, then scheduled maintenance deletes them.

Use Node.js 22.18+ and pnpm. Install dependencies, copy .env.example to the ignored .env.local with only the public Supabase URL/browser key, and run pnpm dev. Open /software/. Never put a service key in browser configuration. The default test command is local semantic tests; opted-in live scripts use fictional credentials from ignored .pilot-test/ and create tracked disposable data.

See [software setup](supabase/README.md), [current implementation status](../docs/development-status.md) and [voice/timing/retention evidence](../docs/voice-timing-retention-verification-2026-11-03.md). Technical checks pass; college authorization, backup/restore and remaining operational/device acceptance gates are tracked separately.

---

# Historical browser demo

Next.js / TypeScript faculty availability demo. All records are fictional and all device interactions are simulated in the current browser. Reloading resets the data. No backend or hardware connection is required.

Install Node.js 22.18+ and pnpm, then:

```text
pnpm install
pnpm dev
```

Open http://127.0.0.1:3000. Use the desk panel or the arrow on a faculty card to try Available, Busy and Away. Search by name, department or room; combine department/status filters. Reset demo restores the original examples.

```text
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

Build output is `out/`. Preview serves the built output at http://127.0.0.1:3000; stop the development server before using the same port for preview. Browser interactions are client-side and require JavaScript. Fonts have system fallbacks.

Faculty declarations and connectivity timestamps are separate. Simulated heartbeats every 15 seconds never refresh the declaration timestamp. Offline means no heartbeat for two minutes; stale means no declaration for 30 minutes. The demo includes both examples. Available/Busy/Away filters and the Available overview count include only current declarations. Needs update includes stale/offline records.

Available lights green; Busy lights yellow; Away turns both off. Simulated disconnection immediately marks the selected device offline and disables submission. Reconnecting preserves the declaration timestamp. The demo does not simulate offline firmware input or queued updates.

Supabase, actual device ingestion and firmware await hardware context. No presence detection or attendance monitoring is implemented. Status never guarantees physical presence.
