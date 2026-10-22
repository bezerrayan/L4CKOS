import { sign, verify, randomUUID } from "node:crypto";
import { z } from "zod";
import { TARGET, digest } from "../financialRecovery/policy";
export const authorizationSchema = z
  .object({
    version: z.literal(1),
    operation: z.enum([
      "provision",
      "activate",
      "preflight",
      "financial-b",
      "backup-export",
      "release",
      "recovery-init",
      "verify-recovery",
    ]),
    projectId: z.literal(TARGET.projectId),
    environmentId: z.literal(TARGET.environmentId),
    apiServiceId: z.literal(TARGET.serviceId),
    mysqlServiceId: z.literal("bcda5d78-4a0d-4682-8659-8316847addb7"),
    deploymentId: z.literal(TARGET.deploymentId),
    artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
    commandHash: z.string().regex(/^[a-f0-9]{64}$/),
    reference: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
    nonce: z.string().uuid(),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    confirmation: z.literal("AUTHORIZE_ONE_STAGING_OPERATION_ONLY"),
  })
  .strict();
export type WindowAuthorization = z.infer<typeof authorizationSchema>;
export function signWindowCommand(
  command: unknown,
  operation: WindowAuthorization["operation"],
  artifactHash: string,
  reference: string,
  privateKey: string
) {
  const now = Date.now();
  const body = authorizationSchema.parse({
    version: 1,
    operation,
    projectId: TARGET.projectId,
    environmentId: TARGET.environmentId,
    apiServiceId: TARGET.serviceId,
    mysqlServiceId: "bcda5d78-4a0d-4682-8659-8316847addb7",
    deploymentId: TARGET.deploymentId,
    artifactHash,
    commandHash: digest(command),
    reference,
    nonce: randomUUID(),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
    confirmation: "AUTHORIZE_ONE_STAGING_OPERATION_ONLY",
  });
  return {
    body,
    signature: sign(null, Buffer.from(digest(body)), privateKey).toString(
      "base64"
    ),
  };
}
export class WindowAuthorizer {
  private used = new Set<string>();
  constructor(
    private publicKey: string,
    private artifactHash: string,
    private consume?: (nonce: string, hash: string) => void
  ) {}
  accept(
    command: unknown,
    operation: WindowAuthorization["operation"],
    input: unknown
  ) {
    const envelope = z
        .object({ body: authorizationSchema, signature: z.string().max(128) })
        .strict()
        .parse(input),
      a = envelope.body,
      now = Date.now();
    if (
      a.operation !== operation ||
      a.artifactHash !== this.artifactHash ||
      a.commandHash !== digest(command) ||
      Date.parse(a.issuedAt) > now ||
      Date.parse(a.expiresAt) <= now ||
      Date.parse(a.expiresAt) - Date.parse(a.issuedAt) > 900000 ||
      this.used.has(a.nonce) ||
      !verify(
        null,
        Buffer.from(digest(a)),
        this.publicKey,
        Buffer.from(envelope.signature, "base64")
      )
    )
      throw Error("WINDOW_AUTHORIZATION_INVALID");
    this.consume?.(a.nonce, digest(a));
    this.used.add(a.nonce);
    return a;
  }
}
