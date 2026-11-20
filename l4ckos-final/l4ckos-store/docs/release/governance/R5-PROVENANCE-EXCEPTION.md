# R5 provenance risk acceptance — draft for owner signature

**Document status:** OWNER_APPROVED_PAYLOAD — effective only after detached signature verification.
**Record format:** `l4ckos-r5-provenance-exception-v1`
**Prepared at UTC:** 2026-11-20T01:52:43Z
**Effective at UTC:** `2026-11-20T02:12:48Z`
**Provenance exception:** `ACCEPTED`
**Production deploy:** `NOT_YET_AUTHORIZED`

## Exact release identity

- Candidate commit: `3a7db74ef270c39ca5f2c4e99348472c9f022a9a`
- Candidate base commit: `4e548622f320fd19abd752906dc567b8d5a45be2`
- Manifest SHA-256: `f5b45034eb331bc7b602b13ea77b05c294f851c54bfc0e8795d9865449d8d392`
- Unverified-file list SHA-256: `31d8afe6c7171311c679ccb595c58f2e9aa1ae3be35dcb841c8fd6372bec8ce3`
- Candidate inventory SHA-256: `ff59728308ca17bbed8885898acb11b6b392703e956654a82ba8e1546e0098e2`

## Evidence acknowledged

The historical origin of the 112 listed snapshot files is not demonstrated. The 50 critical runtime files received an independent integral review: 50/50 reviewed, zero confirmed defects. The other 62 files did not receive that same complete review (53 tests, 6 scripts/SQL, 3 documents). The independent review is evidence about the current bytes, not historical origin or authorship.

The candidate reported 22 targeted test files, 287 passed and one skipped because the real leaf-certificate fixture was absent; typecheck and clean production build passed. These results cover selected behavior and do not authenticate source origin or prove all runtime behavior. The 15 STOCK/V7 test failures were classified as expected policy rejections for restricted XIV Bis; allowed-SKU positive coverage exists. No live production PIX charge or deployment was part of this review.

## Owner decision to be signed

I, Yan Bezerra, responsible for L4CKOS production and operations, accept the residual risk that the historical origin and supply-chain integrity of the 112 listed files remain unproven. I accept this risk solely to permit continuation of the R5 release process. I do not assert or imply that historical provenance has been proved.

This decision does not waive any other security, data, infrastructure, payment, or operational gate. It does not authorize a deploy, R4 LOAD, privilege GRANT, checkout opening, or payment. Production deploy remains `NOT_YET_AUTHORIZED` until separately authorized.

## Signature binding

- Signer identity asserted: Yan Bezerra
- Algorithm: OpenSSL Ed25519 detached signature
- Owner-held key path (never read or copied by the reviewer): `~/.local/share/l4ckos/rc3.8/backup-keys/manifest-signing.pem`
- Verification public key: `~/.local/share/l4ckos/rc3.8/backup-keys/manifest-signing.pub`
- Public-key PEM SHA-256 to verify before signing: `d2ce58a6d32e7fbcc31c850785626d094d7f475c905201b3a541981a0f314dd8`
- The detached signature covers the exact final bytes of this document. Do not edit the document after signing.

The exception becomes effective only after the owner's detached signature verifies against the stated public key and the signed document and signature hashes are recorded in a governance-only commit. If signature verification fails or the signature is absent, this document records no effective approval.
