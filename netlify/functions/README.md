# Backend foundation

The site remains a static Node-built site. Netlify publishes `site/` and builds
functions from `netlify/functions/`. The existing `site/_redirects` rule routes
`/api/*` to the `api` function.

## Contact endpoint

`POST /api/contact` accepts JSON containing `name`, `email`, `phone`, `service`,
`message`, and the optional `website` honeypot. The function limits request
bodies to 16 KiB, validates and trims accepted values, and stores each message
before returning `201 {"ok":true}`. It never echoes stored contact data.

The in-memory IP limiter is best-effort per warm function instance; it is not a
distributed or durable rate limit. The honeypot, bounded body, validation, and
limiter are basic defenses, not a substitute for platform-level abuse controls.

## Admin authentication

The `api` function also provides:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/auth/setup` | `POST` | One-time setup of the primary admin, guarded by `ADMIN_SETUP_TOKEN` |
| `/api/auth/login` | `POST` | Verify email/password and issue a new session |
| `/api/auth/session` | `GET` | Verify the current session without returning credentials or tokens |
| `/api/auth/logout` | `POST` | Validate CSRF, revoke the session in Blobs, and clear cookies |

Setup accepts JSON `{ "setupToken", "email", "password" }`; login accepts
`{ "email", "password" }`; logout accepts a JSON object and requires the
`X-CSRF-Token` header to match the readable CSRF cookie. Passwords must be
12–128 UTF-8 bytes during setup and are stored only as a salted `scrypt` hash.
Setup creates one primary account with an atomic `onlyIfNew` write. It does not
create a default account or password.

The session cookie is signed with `SESSION_SIGNING_SECRET`, HttpOnly, SameSite
Strict, and Secure for HTTPS/deployed requests. Session records are stored in
Blobs under a SHA-256 token digest; only the cookie carries the raw random
session token. Sessions expire after 12 hours. The CSRF value is stored as a
digest in the session record and is never returned in JSON.

Five failed login attempts in a 15-minute window trigger a 15-minute lockout.
The lockout record uses a fixed key and ETag-conditional writes, so attempts
are shared across function instances without storing client IPs or creating
unbounded per-IP records. This single-admin lockout can be abused to temporarily
deny login; production deployments should pair it with platform-level abuse
controls.

### Required environment variables

- `SESSION_SIGNING_SECRET` — required for authentication and session
  verification; use at least 32 random bytes, encoded as a string.
- `ADMIN_SETUP_TOKEN` — required only for initial setup; use a different
  high-entropy value of at least 32 random bytes. Remove it from the deployment
  environment after successful setup.

Generate values locally with Node.js, for example:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Set both values in Netlify’s environment-variable configuration, not in source
files or `site.json`. For local development, store them in an ignored `.env`
file and use a linked Netlify CLI environment. The setup request must be sent
over HTTPS in a deployed environment. If required configuration is missing or
too short, authentication routes return a configuration error rather than
falling back to insecure defaults.

After deploying with both variables set, create the primary account once over
HTTPS:

```sh
curl --include --request POST "https://<your-site>/api/auth/setup" \
  --header "Content-Type: application/json" \
  --data '{"setupToken":"<ADMIN_SETUP_TOKEN>","email":"<ADMIN_EMAIL>","password":"<STRONG_PASSWORD>"}'
```

Use your own email and a unique password of at least 12 UTF-8 bytes. The
password and setup token are request inputs only; neither is returned or
logged. Remove `ADMIN_SETUP_TOKEN` from the Netlify environment after setup.
The session cookie is issued only after the account and session records have
been stored. If session storage fails after the one-time account write, use the
same email and password with `/api/auth/login`.

## Blob layout

The storage module opens separate site-wide Netlify Blobs stores:

| Store | Key | Record shape |
| --- | --- | --- |
| `portfolio-admin-metadata` | `admins/primary` | `{ id, email, passwordHash, createdAt, updatedAt, disabled }` |
| `portfolio-contact-messages` | `messages/<uuid>` | `{ id, name, email, phone, service, message, createdAt, unread }` |
| `portfolio-admin-sessions` | `sessions/<token-hash>` | `{ adminId, createdAt, expiresAt, csrfTokenHash }` |
| `portfolio-auth-attempts` | `attempts/login` and `attempts/setup` | `{ failures, windowStartedAt, lockedUntil }` |
| `portfolio-app-settings` | `settings/<name>` | Application-owned JSON value |

No admin account, session, or sample message is provisioned. Password hashes
and sessions are only read or written by server-side functions; no public
endpoint exposes these stores.

## Local checks and deployment

Run `npm install`, `npm run build`, and `npm test` from the workspace root.
For local Netlify Function and Blobs emulation, use a compatible Netlify CLI
with `netlify dev` and link the workspace to a Netlify site as required by the
CLI. Direct Node tests use an injected in-memory persistence function; they do
not exercise Netlify's hosted Blobs service.

Netlify reads `netlify.toml` for the publish directory, build command, Node
runtime, and functions directory. Blobs credentials are supplied by Netlify
inside deployed Functions; do not put Netlify tokens, admin credentials, or
session secrets in public files. Configure any future authentication secrets
through Netlify environment variables.
