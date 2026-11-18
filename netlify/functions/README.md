# Backend foundation

The site remains a static Node-built site. Netlify publishes `site/` and builds
functions from `netlify/functions/`. The existing `site/_redirects` rule routes
`/api/*` to the `api` function.

## Contact endpoint

`POST /api/contact` accepts JSON containing `name`, `email`, `phone`, `service`,
`message`, and the optional `website` honeypot. The function limits request
bodies to 16 KiB, validates and trims accepted values, and stores each message
before returning `201 {"ok":true}`. It never echoes stored contact data.
The generated public Contact Form is configured by `site.formEndpoint` in
`site/content/site.json` and posts to `/api/contact` as JSON. It uses no admin
session or CSRF token; those remain required only for the admin-only endpoints.
The browser displays success only for a successful `{ "ok": true }` response
and retains the entered form values after a failed request.

The in-memory IP limiter is best-effort per warm function instance; it is not a
distributed or durable rate limit. The honeypot, bounded body, validation, and
limiter are basic defenses, not a substitute for platform-level abuse controls.
Automated tests inject in-memory persistence; use a linked Netlify site with
Netlify Dev/Blobs to test the hosted storage path, then verify the message at
`/admin/inbox`.

## Admin authentication

The `api` function also provides:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/auth/setup` | `POST` | One-time setup of the primary admin, guarded by `ADMIN_SETUP_TOKEN` |
| `/api/auth/login` | `POST` | Verify email/password and issue a new session |
| `/api/auth/session` | `GET` | Verify the current session without returning credentials or tokens |
| `/api/auth/logout` | `POST` | Validate CSRF, revoke the session in Blobs, and clear cookies |
| `/api/admin/dashboard` | `GET` | Return authenticated message statistics, recent messages, and admin email |
| `/api/admin/messages` | `GET` | List/search/filter/sort/paginate authenticated contact messages |
| `/api/admin/messages/:id` | `GET` | Return one authenticated message |
| `/api/admin/messages/:id` | `PATCH` | Mark a message read/unread; requires CSRF |
| `/api/admin/messages/:id` | `DELETE` | Delete a message; requires CSRF |

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

The static Admin Panel is served at `/admin/login`, `/admin/dashboard`, and
`/admin/inbox`. Dashboard/inbox requests are authorized by the same
`requireAdmin` session verifier; changing or deleting a message also requires
the CSRF cookie/header pair. Admin responses expose only message fields needed
by the UI and never return storage keys, session tokens, or password hashes.
Searches and exact statistics iterate the Blobs message key listing in pages,
read records one at a time, and retain only the requested result window. Netlify
Blobs has no full-text query API, so searches/statistics are O(number of
messages); see the root README for this limitation.

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
HTTPS. In PowerShell, prompt for the setup token and password instead of putting
them in the command line or shell history:

```powershell
$site = "https://<your-site>"
$email = Read-Host "Admin email"
$setupTokenSecure = Read-Host "Admin setup token" -AsSecureString
$passwordSecure = Read-Host "Admin password" -AsSecureString

function ConvertTo-PlainText([System.Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$setupToken = $null
$password = $null
$setupBody = $null
$result = $null
try {
  $setupToken = ConvertTo-PlainText $setupTokenSecure
  $password = ConvertTo-PlainText $passwordSecure
  $setupBody = @{
    setupToken = $setupToken
    email = $email
    password = $password
  } | ConvertTo-Json -Compress

  $result = Invoke-RestMethod `
    -Uri "$site/api/auth/setup" `
    -Method Post `
    -ContentType "application/json" `
    -Body $setupBody `
    -ErrorAction Stop

  if ($result.ok -ne $true -or $result.authenticated -ne $true) {
    throw "Unexpected setup response."
  }
  Write-Host "Admin setup succeeded. Sign in at $site/admin/login."
} catch {
  throw "Admin setup was not confirmed. Do not print or share response headers or body. Check setup status by attempting a normal login before retrying; setup may already have created the account."
} finally {
  $setupToken = $null
  $password = $null
  $setupBody = $null
  $result = $null
  $setupTokenSecure.Dispose()
  $passwordSecure.Dispose()
}
```

Use your own email and a unique password of at least 12 UTF-8 bytes. The
prompted credentials are converted to plaintext briefly in the PowerShell
process to send the request; do not enable transcription or logging for this
session, and close the shell afterward. The command reads only the JSON response
body, does not display response headers, and does not retain the session cookie.
The API's `Set-Cookie` headers contain session credentials:
never display, copy, or share them. The success response body contains only
authentication status. After setup, sign in through `/admin/login`; remove
`ADMIN_SETUP_TOKEN` from the Netlify environment and retain
`SESSION_SIGNING_SECRET`. If setup storage succeeded but session creation
failed, try the same email and password at `/api/auth/login` before attempting
setup again.

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
