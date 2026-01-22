# ASTA Secure Tax Intake

High-security intake and client dashboard for personal income tax preparation.

## Quick start

1) Install dependencies:

```bash
npm install
```

2) Configure server environment:

```bash
cp .env.example .env
```

Set `DATABASE_URL` and generate a 32-byte base64 key for `SSN_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

3) Update client config in `config.js`:

- `supabaseUrl`
- `supabaseAnonKey`
- `supabaseBucket`

4) Start the server:

```bash
npm run dev
```

Open `http://127.0.0.1:5173` in your browser.

## Storage policies

Supabase Storage RLS must allow authenticated uploads to:

- `uploads/{username}/...`
- `authorizations/{username}/...`

See your SQL editor setup notes for the policy templates.

## Notes

- All intake submissions are written to Postgres via `server.js`.
- The client dashboard and upload vault use Supabase auth + storage.
- Security headers and rate limiting are applied in the API layer.
- Uploads run a lightweight security screening (file signature + sensitive data patterns) before storage.
- Intake status updates are available at `GET /api/intake/status` (by `client_user_id` or email).
- Intake review status can be updated with `PATCH /api/intake/status` (by `intake_id`, `client_user_id`, or email).
- Client profiles are mirrored to Neon via `POST /api/profile`.

## Preparer dashboard

- Access the admin view at `preparer.html`.
- Restrict access in the client by setting `preparerEmailDomain` (or `preparerEmails`) in `config.js`.
- Enforce access on the server with `PREPARER_EMAIL_DOMAIN` (or `PREPARER_EMAILS`) in `.env`.
- Server auth requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or service role key) to verify sessions.
- Optional upload telemetry: set `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_BUCKET` in `.env`.

## Netlify deployment

This repo ships with Netlify Functions for `/api/*` and serves static files from the project root.

1) Connect the repo to Netlify.
2) Build settings:
   - Build command: `npm install` (or leave blank if Netlify auto-installs)
   - Publish directory: `.`
3) Add these environment variables in Netlify:
   - `DATABASE_URL`
   - `SSN_ENCRYPTION_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_BUCKET`
   - `PREPARER_EMAIL_DOMAIN`
   - `PREPARER_EMAILS` (optional)
