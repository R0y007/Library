# A.V.A.M. Library — simple Vercel version

This is the intentionally simple client-ready version: polished public lookup, small registrar panel, free cloud database, and no local SQLite.

## 1. Create the free database
Create a free Supabase project, open **SQL Editor**, paste `supabase.sql`, and run it. Supabase's free plan currently includes a 500 MB Postgres database. The free project can pause after inactivity, so this is best for a small/pocket-money project rather than a high-availability production service.

## 2. Deploy to Vercel
Upload this folder to GitHub and import it into Vercel, or use the Vercel dashboard.

Add these three environment variables in Vercel:

- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — your **service role** key; keep it server-only
- `SESSION_SECRET` — a long random secret

Then redeploy.

## Admin
Open `/admin.html`.

Initial password: `admin123`

Change it immediately from **Change password** after the first login.

## Important
Do not put `SUPABASE_SERVICE_ROLE_KEY` in frontend JavaScript or in any variable beginning with `NEXT_PUBLIC_`. Vercel environment variables are configured in Project Settings and should be kept server-side.
