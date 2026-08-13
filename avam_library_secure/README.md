# A.V.A.M. Library — Secure Certificate Registry

A professional certificate verification portal with a server-side registrar console.

## Security model

- The admin password is **never stored in HTML/JavaScript**.
- Passwords are stored as salted `scrypt` hashes.
- Admin sessions are random opaque tokens stored server-side as hashes.
- The browser receives only a session cookie; it never receives the password or password hash.
- State-changing admin requests require a CSRF token.
- Helmet adds security headers.
- Login and admin endpoints are rate-limited.
- SQLite uses prepared statements.
- Internal registrar notes are never returned by the public verification endpoint.
- No API keys are required by the application.

## Run locally

1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `ADMIN_INITIAL_PASSWORD` to a strong password.
5. Run `npm start`.
6. Open `http://localhost:3000`.

Public verification: `/`

Registrar: `/admin.html`

## Credential handling

Do not place administrator passwords, API keys, database credentials, or private keys in `public/`, HTML, CSS, or browser JavaScript. Set `ADMIN_INITIAL_PASSWORD` only through the host environment during first deployment, then change it from the registrar console.

## Important production requirements

Use HTTPS in production. Put the application behind a reputable reverse proxy or platform that provides TLS and network controls. Keep the `data/` directory private and backed up. Do not commit `.env` or the SQLite database to Git.

This project deliberately does **not** attempt to make browser source "uninspectable". Client-side code is inherently visible to the browser. Security comes from keeping credentials and authoritative data on the server.
