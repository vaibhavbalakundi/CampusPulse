# CampusPulse demo

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
