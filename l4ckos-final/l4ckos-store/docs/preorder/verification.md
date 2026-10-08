# Local verification — PREORDER/BATCH

Starting HEAD: `83ee0d835e9bacadc12ac3d08603ce7600135b97`.
Worktree: `/tmp/l4ckos-preorder-83ee0d8/l4ckos-final/l4ckos-store`.
Branch: `feat/preorder-batch`. The original workspace and manager sync commit were preserved.

## Automated gates

Node `22.23.2`; actual MySQL server `8.4.11`, isolated container, Unix socket, synthetic data, no published database port.

```sh
pnpm check
L4CKOS_MYSQL_TEST=1 \
L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-preorder-mysql/mysqld.sock \
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 \
  --testTimeout=30000 --hookTimeout=60000
VITE_API_URL=same-origin pnpm build
```

Final full suite: **31 files PASS; 304 tests PASS; 1 skipped**. The skipped test is the existing optional real SSH staging transport test. All enabled schema, staging-executor and transport tests use local databases or mocked transports; no staging connection was made. Worker limits accommodate a real shared MySQL test instance; concurrency is explicitly tested by eight simultaneous independent connections.

`pnpm check`: client/server PASS. Frontend/backend production builds: PASS. Docker builds: PASS; both Node stages pinned to 22.23.2. Backend startup and `/health`: HTTP 200. Frontend nginx configuration, static root and proxied `/health`: PASS/200. Containers communicate on a Docker **internal** network with no external route; MySQL access uses the local socket. No application provider credentials were supplied.

Initial sandbox-only attempts could not open sockets, fork the smoke process or bind loopback. Authorized local checks were rerun with the required process/socket permissions. An early unrestricted-worker run exceeded the default five-second deadline; the final full suite above is the passing result.

## Required coverage mapping

| Requested cases | Evidence |
| --- | --- |
| 1–10 STOCK | Existing `checkout.mysql.test.ts`: normal qty 1/>1, snapshots, items/reservation FK, shortage, trusted cents/price, retry, transactional failures/rollback. |
| 11–18 PREORDER availability | `preorder.mysql.test.ts`: parameterized DRAFT/CLOSED/CANCELLED and other non-OPEN states, both date boundaries, missing assignment/batch, OPEN with zero stock and no reservations. |
| 19–27 PREORDER persistence/security | Items and mode/drop/estimate snapshots, quantity >1, own/foreign variant, strict rejection of client mode/batch/price/total/quantity manipulation, one order/claim on retry. |
| 28–35 Demand/history | Trusted manual/webhook payment evidence, unpaid/counterfeit/cancelled excluded; product/variant/size/color grouping without duplicates; multi-product minimum progress; product/batch renames preserve snapshots. |
| 36–39 Capacity | Below/exact/above maximum; eight real MySQL connections competing across two products for maximum 5 result in exactly 5 successful claims. Pending claims, cancellation/release and payment do not double-count. Unlimited batches tested separately. |
| 40–46 Mixed | Both kinds create items; only STOCK reserves; cents/discount/freight and snapshots preserved; retries and rollback covered. Browser checks show explicit shipping/paying notices, including mobile. |
| 47–56 Admin | Existing admin guard rejects unauthenticated/ordinary users; list/create/edit/associate/summary and valid/invalid lifecycle transitions; transactional audit records; explicit cancellation acknowledgment. |
| Payment/ownership | Real ORM payment confirmation is idempotent; consumes only STOCK; customer list/detail/tracking enforce ownership; shipped/delivered blocked until all purchased batches received; cancelled preorder cannot reactivate. |
| Backup/restore | Actual MySQL roundtrip checksums preserve 28 tables, mode/batches/snapshots/payment/audits/STOCK reservations; existing old-artifact compatibility and failure/recovery tests pass. |
| Migration/bootstrap | Official V2 runner applies 0021 once; independent fresh v2 bootstrap equals incremental schema; historical STOCK records and v1 artifacts unchanged; drift/checksum rejection tests pass. |
| Emails | Actual HTML render through existing React email template; preorder/full payment/calendar, fifth item, escaping malicious text, STOCK wording. No send calls. |

## Schema evidence

Canonical PRE: `f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d`.
Local expected POST: `6654c63ea42bbcb84af99e7640f24d3963581128a6a5387898b12b34cbbca93a`.
0021 SHA256: `46e7b40f6320659791ba90d3ebaf4c4cc031e84de36f5bdf8789ab1993d0233d`.

The POST contract and v2 bootstrap statements were generated from inspected **real MySQL metadata/SHOW CREATE**, then compared with an independently bootstrapped schema. Governance objects remain separately fingerprinted by the existing mechanism. No remote ledger was modified and no baseline was replaced.

## Operational decisions

Maximum counts all noncancelled preorder items, including pending/recovery orders. A batch row lock serializes the check and item insert; there is no stockReservation or redundant demand/hold table. No automatic expiry: the current provider contract cannot safely invalidate a still-payable charge atomically. Reconcile abandoned charges before admin cancellation. Cancelling an order frees its claim; a late confirmation cannot reactivate it or enter production.

Confirmed demand requires `paymentStatus=confirmed`, a confirmation timestamp, an authenticated manual actor ID or webhook reference, and order status paid/processing/shipped/delivered. Pending, cancelled and invalid confirmation evidence are excluded. Paid demand remains visible after cancelling a batch for operational resolution; production stops and no refund is automatic.

A mixed order has one freight and tracking flow. It ships when all items are available; server transitions enforce that every purchased preorder batch is RECEIVED/SHIPPING/COMPLETED. Minimum is informational and never triggers cancellation/refund. The confirmed value in production summary is gross item cents, before order discount/freight, explicitly labelled.

Before sending the confirmed summary to the factory, reconcile outstanding pending/recovery charges. The V1 summary remains derived from current trusted payment evidence and updates if a legitimate delayed payment arrives; no immutable factory-order/export or automatic provider invalidation is introduced.

Batch cancellation always requires explicit acknowledgment, preventing silent cancellation even if a payment arrives during review. Paid orders require manual contact/provider reconciliation/refund through an authorized operational workflow; V1 adds no refund integration.

Migration is forward-only. Do not run historical migrations or a new baseline. In a future authorized release, review the approved fingerprints/checkpoint first. Recovery uses the existing backup/governance workflow; removing columns/tables or rolling back to an application that ignores preorder history is not a safe rollback.

## Preview and visual evidence

Local review URL: `http://127.0.0.1:3413`. Synthetic account `admin@local.dev`, password `PreorderLocal2026!`; uses existing restricted local-auth configuration, no new bypass. Three synthetic products; DROP 01 contains two PREORDER products; the third is STOCK. The synthetic paid mixed order is #1. Database: `l4ckos_local_preorder_preview`.

Preview assets must be built with `VITE_API_URL=same-origin`. The browser is allowlisted to localhost/127.0.0.1. Rebuilding running assets requires reloading pages to discard cached hashed module paths. Captures in `visual/` cover product cards/detail, cart, checkout, customer order and admin lot/production summary at 1440×1000 and 390×844. Fonts/external domains are blocked during this local review. No payment button was submitted to a real provider.
