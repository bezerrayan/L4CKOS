# R5 provenance exception governance record

Record format: l4ckos-r5-provenance-exception-registration-v1
Registration: effective through this governance-only commit after signature verification.
Owner decision effective at: 2026-11-20T02:12:48Z
Signature independently verified at: 2026-11-20T02:22:50Z

## Signed decision

The preserved owner-signed document is R5-PROVENANCE-EXCEPTION.md and its detached Ed25519 signature is R5-PROVENANCE-EXCEPTION.md.sig.

- Signed document SHA-256: 686b4a91ee52f28da8af36cfc5725371e7c3ee00e4891d2b7fb1cc62f0ad7dcd
- Detached signature SHA-256: 7d117c86ee3dfb50a3db88aaa9d0017d3c82d5e54e64b7f46b5d5fe1f8ae7cf5
- Signature result: Signature Verified Successfully
- Verification: OpenSSL Ed25519 detached verification with raw input.

The original signed bytes were copied unchanged into this release record. The owner's original files remain at their original local paths.

## Verification key identity

- Signer identity asserted in the signed document: Yan Bezerra.
- Key identifier: the previously identified local RC3.8 manifest-signing public key.
- Public key PEM SHA-256: d2ce58a6d32e7fbcc31c850785626d094d7f475c905201b3a541981a0f314dd8
- Public key DER SHA-256 fingerprint: f1ba2c80d76eb34e671124ce565559c304cfece6f23d0d6b045c85dbec149208
- Auditable public key copy: R5-PROVENANCE-VERIFICATION-KEY.pub.
- No private key was read, copied, or used by the reviewer.

The cryptographic result establishes that the exact document bytes verify against this public key. The human signer identity is the owner's assertion and the key's previously established local identity; this record does not claim an external identity certificate.

## Candidate and accepted residual risk

- Candidate commit: 3a7db74ef270c39ca5f2c4e99348472c9f022a9a
- Candidate base commit: 4e548622f320fd19abd752906dc567b8d5a45be2
- Manifest before this governance update SHA-256: f5b45034eb331bc7b602b13ea77b05c294f851c54bfc0e8795d9865449d8d392
- Unverified-file list SHA-256: 31d8afe6c7171311c679ccb595c58f2e9aa1ae3be35dcb841c8fd6372bec8ce3
- Pre-waiver candidate inventory SHA-256: ff59728308ca17bbed8885898acb11b6b392703e956654a82ba8e1546e0098e2
- Pre-waiver inventory is preserved byte-for-byte as R5-CANDIDATE-SHA256SUMS-PRE-WAIVER.
- Current release manifest declares PROVENANCE_EXCEPTION=ACCEPTED.
- PRODUCTION_DEPLOY remains NOT_YET_AUTHORIZED.

The historical origin and supply-chain integrity of the 112 listed files remain unproven. The 50 critical runtime files received integral independent review, 50/50 reviewed with zero confirmed defects. The other 62 files did not receive that same complete review (53 tests, 6 scripts/SQL, 3 documents). Functional review and selected tests concern the current bytes; they do not establish historical origin or authorship. The reported candidate validation was 287 passed and one skipped because a real leaf-certificate fixture was absent; typecheck and clean production build passed. This exception accepts only the stated provenance risk and does not satisfy other release or production gates.

## Scope

This commit records governance only. It does not change runtime, tests, schema, integrations, Railway, production configuration, checkout state, payment state, or deployment authorization.
