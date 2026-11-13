# Isolated homologation protected startup

This procedure is for the isolated Railway target only:

- Project `66faf690-a068-40d1-b85c-cb5d8595560a`
- Environment `5335340d-311c-47e9-9713-6e5a86969c88`
- API service `d66762a4-422a-4656-94a1-502215a27aa2`

It is a preparation checklist, not deployment authorization.

## Required start command

The reviewed artifact must include `dist/isolated/isolatedHomologation.js`, produced by `pnpm build:server`. Set the target service's start command explicitly to:

```sh
pnpm start:isolated-homologation
```

The command runs the isolated entry and its pre-import financial guard. The ordinary `start` command is not an acceptable fallback for this service. The ordinary entry also fails closed when any isolated-homologation Railway identity marker is present. If the service configuration omits the exact protected command, differs from it, or the artifact lacks the entry file, stop before deployment.

## Before an authorized deployment

1. Confirm all three target IDs from read-only Railway metadata and confirm the reviewed source SHA and clean artifact contents.
2. Confirm the deployment will use the exact artifact built with `pnpm build:server` and the service start command above. Do not infer the start command from `package.json` defaults or dashboard labels.
3. Confirm the protected entry's attestation will require the exact project, environment, service, deployment and replica IDs, PID, explicitly closed financial flags, and coherent Asaas Sandbox configuration.
4. Treat start-command or artifact changes as deployment changes that restart the service. Obtain separate, explicit authorization for this exact target, artifact and command before applying them.
5. After an authorized start, review the pre-import `financial.runtime_attestation` verdict and startup health before any further homologation step. Any verdict other than `PASS`, missing correlation ID, startup failure, or evidence of a worker/scheduler start is a stop condition. Do not enable flags to force a pass.

## Rollback and restart risk

Rollback is a paired operation: restore the previously approved artifact and restore its previously approved start command. Do not roll back only one side. A start-command update and deployment restart can stop current replicas and cause downtime; do not assume overlap or zero-downtime behavior. Keep the financial flags closed throughout. If startup fails, preserve logs and the active deployment state, then request authorization for the paired rollback. This procedure does not authorize rollback, flag changes, database operations or financial activity.

The default `start` entrypoint remains for Production and legacy staging. If any isolated-homologation identity marker is present, that entrypoint exits before importing the application and prints that the protected command is required. This prevents a mistaken default command from silently bypassing the guard when Railway identity metadata is present.
