# CampusPulse

CampusPulse is a campus coordination application by Sygnetta. It helps students find out whether faculty are accepting meetings and send requests through a dedicated campus channel.

## What is implemented

- Faculty availability with expiry and optional scheduled changes.
- A searchable faculty directory and recurring office hours.
- Student meeting requests, faculty responses, and in-app updates.
- Institution-scoped profiles, basic administration, and CSV profile import for existing confirmed accounts.
- A Supabase-backed development setup with row-level security and access checks.

The software application is at `/software/`. The `/` route is an earlier hardware-oriented demonstration. `/software/preview/` uses fictional data and does not save changes.

The project is under development. A controlled college pilot, actual signup email delivery, retention policies, and production operations still need to be verified. The team has discussed AI-assisted meeting-request drafting as a possible experiment; it is not implemented.

## Run locally

Requirements: Node.js 20.9 or later and pnpm. The tests require Node.js 22.18 or later, or Node.js 20.19 or later with `--experimental-strip-types`.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

On Windows PowerShell, use `Copy-Item .env.example .env.local`. Add your own Supabase project URL and **publishable** key to `.env.local`, then open `http://localhost:3000/software/`. Never add a Supabase secret or service-role key to a `NEXT_PUBLIC_` variable or commit credentials. To run the software MVP against your own project, review and apply the migrations in `supabase/migrations` in order. The campus-domain signup hook also requires separate activation in Supabase Auth; do not expose registration until that restriction and email confirmation are verified.

To view the fictional faculty preview without Supabase, visit `http://localhost:3000/software/preview/`.

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Data and access

Faculty availability reflects an explicit declaration, not location or physical presence. Expired statuses display as unknown. The development system uses institution-scoped policies and database functions, but a college pilot still requires institutional approval and further operational, privacy, backup, and security review. In-app notifications are available while the app is open; email and push notifications are not implemented.

## Status

Founder-reported student and faculty conversations informed the problem. The core request workflow has been tested with fictional accounts. No pilot, institutional purchase, or measured improvement is claimed.
