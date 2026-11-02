# MyLife

MyLife is a private personal-finance and work tracker built with Next.js, TypeScript, and Supabase. Each signed-in user's records are protected by PostgreSQL row-level security. Money is stored as integer minor units, expected income is kept separate from received payments, and work sessions use database procedures for clock and break changes.

## Local development

1. Install Node.js 20.9 or later and npm.
2. Install dependencies with `npm ci`.
3. Copy `.env.example` to `.env.local` and set the public Supabase project URL and publishable/anon key:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

   The older `NEXT_PUBLIC_SUPABASE_ANON_KEY` variable is also supported. Do not put a Supabase service-role key in this application. `.env.local` is ignored by Git.
4. Apply the SQL files in `supabase/migrations/` to the Supabase project, in filename order. Supabase CLI users can link their project and run `supabase db push`.
5. In Supabase Authentication, enable email/password sign-in and configure the Site URL and redirect allowlist to match `NEXT_PUBLIC_SITE_URL` exactly (including `localhost` versus `127.0.0.1` and the port). Allow `${NEXT_PUBLIC_SITE_URL}/auth/callback`; add the deployed callback origin as well. The browser that starts sign-up must use the same origin when opening its email confirmation link so Supabase's PKCE verifier cookie is available. Configure SMTP/email delivery and password-reset redirect URLs before inviting real users.
6. Start the app:

   ```bash
   npm run dev
   ```

   Without Supabase configuration, the overview displays explicitly identified illustrative sample data. Authenticated users see their private database-backed overview and domain pages.

## Validation

```bash
npm run lint
npx tsc --noEmit
npm run test:db
npm run build
```

`npm run test:db` applies the migrations to a local PGlite database and exercises selected database behaviors. Its lightweight Supabase auth stubs are useful regression checks, but they do not replace testing against a real Supabase project.

## Data export

Signed-in users can download transaction, income, and work-history CSV files, or a full JSON record export, from **Settings → Export your data**. The private export endpoint uses the signed-in Supabase session and row-level security; responses are marked `no-store`. CSV fields are quoted and spreadsheet formula prefixes are neutralized.

The JSON file is a portable data snapshot, **not an automatic restore/import file**. MyLife does not currently provide a restore endpoint. Keep a second copy in a secure location you control, and verify a periodic export by checking that the JSON parses and includes the expected record groups.

## Backup and recovery

Application-level exports are user-triggered downloads; they are not scheduled backups. Before production use:

1. Select a Supabase plan and hosting region that meet your privacy, retention, and recovery requirements.
2. Enable and review the provider's database backup and point-in-time recovery options; confirm retention, recovery-point objective, and recovery-time objective for the selected plan.
3. Restrict production project access, require strong authentication for project administrators, and keep the provider dashboard and deployment credentials out of the client application.
4. Periodically download a MyLife JSON export and store it encrypted in a separate, access-controlled location. Never email or commit personal exports.
5. Verify provider recovery in a separate staging project: restore a backup using the provider's documented procedure, apply any migrations that followed that backup, and check sign-in, RLS isolation, account balances, income reconciliation, work history, goals, and exports before considering the restore successful.
6. In an incident, prevent further writes if needed, restore to a separate project first, validate the restored data and access rules, then switch the deployment only after review. Preserve the original project until recovery is confirmed.

Provider-managed database restore and a manual JSON export are distinct recovery paths. The current app does not import JSON snapshots back into PostgreSQL; do not treat an export alone as a verified recovery plan.

## Security and production setup

- Apply every migration before using finance, work, goals, analytics, or settings.
- Keep row-level security enabled. The migrations grant authenticated users access only to their own records; work-clock changes use scoped database functions.
- Use HTTPS in deployment and set the exact public Supabase URL/key in the hosting provider's environment configuration. Never expose a service-role key.
- Configure Supabase email delivery and production redirect URLs; validate account creation, email confirmation, sign-in, password reset, session refresh, and sign-out in the deployed environment.
- Enable available Supabase administrator MFA and project-level access controls. MyLife does not currently implement end-user MFA or automated backup scheduling.
- Review dependency advisories and apply tested dependency updates before production deployment.

Live authentication/email delivery, provider backup automation, point-in-time recovery, and a real restore drill require a configured Supabase project and hosting provider; they are not verified by local tests.
