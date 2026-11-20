# R5 candidate provenance and review boundary

## Versioned base

- Base commit: `4e548622f320fd19abd752906dc567b8d5a45be2`.
- Base tree: `2b4dc8207111ef6c123e327662658c1256903b65`.
- This is the newest locally versioned commit found with the STOCK router and engine (`server/routers/stockCheckout.ts`, `server/stock/stockCheckout.ts`). The earlier deployed commit `d6c9d3e3a3da92a05cf02f498d346d43667d2939` lacks those modules. The `4e54862` source does not contain the Route-B V7 contract package; that contract was separately applied and verified on c7. This candidate makes no schema or migration changes.
- The base has 1,232 files under the app root. `p23-build` and `p3i-build` each have 1,272 files after excluding `.git`, `.local`, `node_modules`, and `dist`. P23 contains all 1,232 base paths: 100 are changed and 40 are new. The complete path-by-path list is `R5-SNAPSHOT-DELTA.csv`.

## What is proven by the reviewed patches

- P2.3 is the exact two-file delta from `p22-build` to `p23-build`: `server/services/asaasConfig.ts` and its test. The patch is `codex-review-package-r32/patches/P23-asaas-service-pin.diff`, SHA-256 `490afe9424347cb62e2c349f2043b99f0759d303918eefd057b12424363b949b`.
- P3 is the exact three-file delta from `p3-tls-build` to `p3i-build`: `server/database/mysqlTls.d.mts`, `mysqlTls.mjs`, and `mysqlTls.test.ts`. The applied candidate versions are byte-for-byte the `p3i-build` files and correspond to the approved R3.3 incremental patch SHA-256 `f1b3365a48c22ed0bf355d8647a66c7c22976529506193cc9e01ceb42109c880`.
- The snapshots differ in exactly six files: those three TLS files, the two Asaas files above, and `server/services/pixPreflight.test.ts`. P23 was retained for Asaas/Pix; only the three approved TLS files were taken from P3i. No private-key file or PEM private-key material was found in either snapshot or this candidate.
- The R32 review package checksum manifest verifies locally. Its V7 schema package defines the runtime tables and columns used by STOCK: `orders.stockAttemptId` and shipping/payment fields; `stockCheckoutAttempts` attempt, owner, fingerprint, provider state, amount, payment, URL, expiry and settlement fields; `stockCheckoutItems` line snapshots; `stockReservations` attempt/variant/order snapshots; plus `stockWebhookEvents`, `notificationOutbox`, and `auditLogs`. The P23 SQL adapter reads/writes these names. V7 also contains the related product, variant, production-batch, user and order-item fields. This is a static contract comparison against the reviewed V7 package, not a new remote query.

## Provenance that remains unresolved

The snapshots have no Git metadata and no complete source-tree manifest. For 23 changed/new P23 files an identical Git blob exists at the same path in reachable local history; the exact source commit is recorded in `R5-SNAPSHOT-DELTA.csv`. For 117 changed/new snapshot blobs there is no matching object at that path in reachable history. The two P2.3 files are separately proven by the approved patch, and the three final TLS files are separately proven by P3; after those exclusions, **112 P23 files remain without demonstrated source provenance**. Their exact paths and SHA-256 values are in `R5-UNVERIFIED-SNAPSHOT-FILES.txt`.

That unverified set includes production-critical code, including the payment controller, MySQL connection setup, public purchase policy, stock checkout/store/provider/webhook paths, order and product routers, and e-mail/webhook persistence paths. Compilation and tests below establish that the snapshot builds and that selected behaviors pass; they do not authenticate the origin or fully audit those 112 files. Creating this branch/commit and hashing the tree does not change that limitation.

## Candidate-only changes made here

- `server/routers/stockCheckout.ts` now requires the normal public/staging gate before `resume`; when public checkout is closed, only the configured owner test can resume its one server-selected attempt. `resumeLatest` always uses the normal gate, so it cannot return a pending `checkoutUrl` while closed.
- `server/stock/ownerPixTestGate.ts` is disabled unless `OWNER_PIX_TEST_ENABLED=true`, the exact production Railway project/environment/backend service and production labels match, all public checkout flags remain closed, the authenticated user is an admin with the exact configured `OWNER_OPEN_ID`, a fixed server-side attempt ID is configured, the UTC expiry is live and no more than 15 minutes ahead, and a positive maximum amount is configured.
- The quote and create routes allow that authenticated owner exception. The runtime rechecks it, replaces any client attempt ID with the configured ID, and the checkout domain enforces the maximum amount before reservation/order/provider writes. For this one-off path it skips expiry-maintenance writes before the amount check. Existing attempt uniqueness, owner/fingerprint matching, and the production Asaas adapter's `supportsIdempotencyKey=false` rule prevent replay from creating a second charge: a known payment is returned from its stored attempt; an uncertain create is not retried.
- No schema, migration, public checkout flag, legacy checkout route, or Coming Soon code was changed to implement the exception. Disable it by setting `OWNER_PIX_TEST_ENABLED=false` or letting its short expiry pass; public flags remain `coming-soon/false/false` throughout.

## Local verification

- Runtime: Node `v22.23.2`, pnpm `10.4.1` (the package's declared manager).
- Targeted checkout, Asaas, TLS, shipping, webhook-boundary, and Coming Soon suite: 22 files, 287 passed, 1 skipped. The skipped TLS test needs the owner's real local leaf certificate and was not supplied/read here.
- `pnpm check`: client and server typechecks passed.
- Clean production build: `dist` removed, then `VITE_DEPLOY_TARGET=production VITE_API_URL=https://api.l4ckos.com.br pnpm build` passed. This was a local compile only; no deployment or external call was made.

## Release decision

This is a reproducible, buildable review candidate, not a production-approved release. The explicit blocker is unresolved provenance and incomplete independent review of the 112 files listed above. Review should begin with the payment, database-connection, STOCK, webhook/outbox, and checkout policy files before any deployment authorization.
