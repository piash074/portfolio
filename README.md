# Portfolio and Admin Panel

Static six-page portfolio, deployed with Netlify Functions and Netlify Blobs.
The public contact form remains disconnected; contact records can only be
created through the existing API until the next approved implementation step.

## Admin Panel

| Route | Purpose |
| --- | --- |
| `/admin/login` | Sign in to the existing primary admin account |
| `/admin/dashboard` | Protected message totals and recent messages |
| `/admin/inbox` | Protected message search, filtering, sorting, pagination, details, read status, and deletion |

Pages check the existing session before loading admin data. A signed HttpOnly
session cookie is used by the browser; the password and session token are never
stored in browser storage. The existing readable CSRF cookie is sent in the
`X-CSRF-Token` header for logout and message changes.

## Admin API

All dashboard and inbox endpoints require a valid admin session:

| Method and route | Purpose |
| --- | --- |
| `GET /api/admin/dashboard` | Actual total/read/unread counts, five recent messages, admin email |
| `GET /api/admin/messages?page=1&limit=20&search=&filter=all&sort=newest` | Search, filter (`all`, `unread`, `read`), sort (`newest`, `oldest`), and paginate |
| `GET /api/admin/messages/:id` | Retrieve one complete message |
| `PATCH /api/admin/messages/:id` | Set `{ "unread": true }` or `{ "unread": false }`; requires CSRF |
| `DELETE /api/admin/messages/:id` | Delete a message; requires CSRF |

API responses are JSON with an `ok` flag. Message IDs and query values are
validated server-side, session and storage internals are not included, and
message content is rendered as text in the Admin UI.

## Authentication and setup

The Admin Panel uses the existing `/api/auth/setup`, `/api/auth/login`,
`/api/auth/session`, and `/api/auth/logout` API. Setup creates the sole primary
account once; no default credentials are provisioned. Login uses the secure
session cookie and redirects an authenticated admin to the dashboard. Protected
pages redirect unauthenticated or expired sessions to `/admin/login`.

Configure `SESSION_SIGNING_SECRET` (at least 32 random bytes) and
`ADMIN_SETUP_TOKEN` (a separate high-entropy value of at least 32 random bytes)
as Netlify environment variables for initial account setup. After setting up
the admin, remove `ADMIN_SETUP_TOKEN`. Never place credentials or secrets in
source files or the public `site/` directory. See
[netlify/functions/README.md](./netlify/functions/README.md) for the setup
request and the existing authentication/storage details.

## Local development and deployment

- Requires Node.js 20 or later.
- Install dependencies with `npm install`.
- Run tests with `npm test`.
- Build the published static site with `npm run build`.
- Run the site, functions, and local Blobs integration with a linked Netlify
  project and Netlify CLI using `netlify dev`.
- Netlify deploys `site/`, builds functions from `netlify/functions/`, and uses
  the build/runtime settings in `netlify.toml`. Netlify Blobs access is supplied
  by the deployed Functions environment.

Automated tests use injected in-memory storage and do not test hosted Netlify
Blobs. Netlify Blobs supports paginated key listing but not full-text or
aggregation queries. Dashboard totals and inbox searches therefore scan the
stored message keys in bounded pages, loading message records one at a time and
retaining only the requested result window. For very large inboxes, a dedicated
search/index service would be needed to avoid full scans. Pagination is capped
at 1,000 pages and 50 messages per page.

## Netlify Blobs record compatibility

Messages continue to use the Step 7A record shape
`{ id, name, email, phone, service, message, createdAt, unread }` in the
`portfolio-contact-messages` store under `messages/<uuid>`. The Admin Panel
reads and updates those records directly; it does not provision sample messages
or connect the public form.
