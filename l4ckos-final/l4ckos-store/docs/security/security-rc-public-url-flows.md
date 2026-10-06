# Security RC: public URL and email flows

Starting HEAD: `b19ead81b5133f33138391e6ef19e11742e831a4`.
Scope is P1–P5 only. No PREORDER/BATCH, schema changes, new migrations,
remote reads/writes, email sends, deployment or push are part of this RC.

## Audit map and implementation

| Finding | Exact cause / surface | Minimal correction | Regression evidence |
| --- | --- | --- | --- |
| P1 CONFIRMED / MEDIUM | `server/_core/index.ts` public image route used textual `isPrivateHostname`, automatic `fetch` redirects, no controlled DNS/socket, deadline or byte cap. | `server/_core/imageProxy.ts`: validate URLs and all DNS addresses, pin one validated address to a fresh socket, revalidate redirects, bound time/body/type. | Mocked resolver and transport matrix plus transport pinning tests; no private/metadata connections. |
| P2 CONFIRMED / LOW | `server/_core/oauth.ts` accepted `//authority` through `startsWith("/")` and resolved against the frontend. | Parse with URL; enforce exact protocol/origin; reject authority, backslashes, controls, encoded slash/backslash/control variants and canonical paths beginning `//`. Validate login input and final callback. | Same-origin path/query/hash; malformed/external paths; nonce/state preservation, mismatched state, full callback with provider mocked. |
| P3 CONFIRMED in code / MEDIUM | `buildUnsubscribeUrl` used frontend APP_URL despite handler being registered on backend `/api/email/unsubscribe`. Actual remote routing was not inspected. | Dedicated backend `PUBLIC_API_URL`, no frontend or hardcoded fallback. Reject invalid/public HTTP origins. Keep existing HMAC token format, remove known-secret fallback and reject extra segments. | Actual marketing HTML, handler valid/invalid/context tokens, repeat and isolated MySQL persistence. |
| P4 CONFIRMED / LOW operational | `client/src/pages/Admin.tsx` initialized launchUrl to the real store; admin audit had a hardcoded fallback and sending could omit a URL. | Frontend defaults to its current origin (empty outside browser). Server announcement URL uses explicit launchUrl, APP_URL, APP_BASE_URL or FRONTEND_URL; absent configuration throws before send. Audit records the same resolved URL. | Staging/production APP_URL rendering, explicit/fallback config and safe absence. |
| P5 B: configuration absent / LOW operational | Internal alerts use existing `getAlertsRecipient` config chain; missing recipient throws before provider. Webhook catches notification failure and emits a warning while acknowledging payment. | No recipient code change or invented address. Preserve existing variables/fallback priority. | All three alerts configured/missing; paid webhook still returns 200 and logs missing recipient. |

## P1 source contract and network policy

Repository evidence: product upload (`server/routers/upload.ts`) saves local
`/uploads` images or accepts the download URL returned by `server/storage.ts`.
Admin product image fields (`server/routers/admin.ts`, `productImageUrlSchema`)
accept external URL strings; promotional image fields do too.
`client/src/lib/images.ts` proxies HTTP(S) images outside frontend/API hosts.
No finite set of legitimate external origins is defined in source, and no remote
catalog/config was inspected. Therefore this RC preserves arbitrary **public**
HTTP(S) image sources rather than inventing a host allowlist. A future allowlist
requires a confirmed inventory of external storage/catalog origins.

Both HTTP and HTTPS remain supported for images on standard ports only; embedded
credentials and non-HTTP protocols are rejected. Every A/AAAA returned by the OS
resolver must pass the public-address policy. IPv4 excludes private, loopback,
link-local, shared/CGNAT, documentation, benchmarking, deprecated relay,
multicast/reserved and platform metadata ranges. IPv6 permits native global
unicast `2000::/3` except special-purpose `2001::/23`, documentation ranges,
6to4 and reserved documentation space. Other IPv6 ranges, including mapped IPv4,
NAT64, unique-local, link-local, multicast and unspecified, fail closed.
This conservative policy intentionally rejects some special globally reachable
addresses, rather than accepting transition or special-purpose destinations.

The socket uses a custom lookup bound to the validated DNS snapshot, disables
connection pooling, and retains the original URL hostname for HTTP Host and TLS
SNI/certificate validation. No second DNS lookup selects the connection target.
Redirects are handled manually (301/302/303/307/308), at most three hops;
relative Locations are parsed against the current URL. Every next URL and all
its DNS answers pass the same checks before connection; loops are rejected.
No cookies, credentials or incoming headers are forwarded.

One 8-second deadline covers DNS, redirects, connection and body. Abort destroys
the active request/response. Bodies are limited to 10 MiB, checked against both
Content-Length and streamed byte count. Only explicit image media types are
accepted (JPEG, PNG, WebP, GIF, AVIF, SVG, APNG and icons); output media type is
normalized rather than reflecting arbitrary upstream header bytes. URLs and
upstream errors are not logged, protecting signed storage URLs.

## Configuration before staging regression (no configuration changed here)

- Set `PUBLIC_API_URL` to the **backend** public origin. It must contain no
  credentials, path, query or hash. Public environments require HTTPS.
  HTTP loopback is permitted only outside NODE_ENV=production. Missing/invalid
  configuration prevents generation/sending of marketing links before provider
  access; it does not silently substitute the frontend or real store.
- Ensure `FRONTEND_URL` is the expected HTTPS frontend origin for public OAuth.
  Missing/invalid configuration returns 503 before OAuth provider calls;
  production does not infer the frontend from request/forwarded Host headers.
- Announcement defaults require APP_URL, APP_BASE_URL or FRONTEND_URL on the
  server, or an explicit valid launchUrl. Only explicitly configured URLs can
  resolve to the production store. The admin UI defaults to its browser origin.
- `EMAIL_UNSUBSCRIBE_SECRET`, or existing JWT_SECRET fallback, must be present.
  Existing correctly signed tokens keep their format and validity. There is no
  public known-secret fallback. Tokens signed under a different context/signature
  and multi-segment tokens cannot mutate subscriptions.
- **STAGING CONFIG ACTION REQUIRED:** choose a controlled internal recipient and
  configure `ALERTS_NOTIFICATION_EMAIL`. Existing fallback order remains
  ORDERS_ALERT_EMAIL → EMAIL_TO_SALES → EMAIL_TO_FINANCE → EMAIL_TO_CONTACT.
  This recipient is necessary to deliver internal alerts, optional for payment
  acceptance. When absent all three alert functions throw a named configuration
  error before provider access. Payment webhook catches and logs it without
  crashing checkout/payment processing. No address belongs in this document.

## Review and limits

No newly introduced exploitable finding was reproduced in the changed paths.
The canonical double-slash OAuth case found during review is included in the
fix/tests. Header/host confusion, DNS rebinding, private redirect targets,
IPv6 bypass, token/URL logging, and subscription ownership were checked locally.
H1/H2/H3 and wider unrelated hardening remain outside this RC.

Legacy APP_URL fallbacks in unrelated transactional flows remain unchanged;
this patch does not constitute an audit or repair of every email URL.
Remote image inventory/availability and real OAuth/email delivery remain for
an explicitly authorized staging regression. Nothing here authorizes deploy.
