import type { Connection } from "mysql2/promise";
import {
  FinancialIsolation,
  type IsolationApproval,
} from "../financialIsolation/controller";
import {
  runIsolatedPreflight,
  runIsolatedRecovery,
} from "../financialIsolation/adapter";
import type { Runtime } from "../financialRecovery/operator";
import { takeFullBackup, writeEncryptedBackup } from "./backup";
import { inspectAfterControlLoss, controlRecoveryPlan } from "./recovery";
import { WindowAuthorizer, type WindowAuthorization } from "./authorization";
import { z } from "zod";
/** Explicit commands only. No automatic chaining A→B or release. */
export class WindowSession {
  constructor(
    private authorization: WindowAuthorizer,
    private control: Connection,
    private isolation: FinancialIsolation | undefined,
    private runtime: Runtime,
    private identity: () => Promise<void>
  ) {}
  private channel() {
    if (!this.isolation) throw Error("WINDOW_ISOLATION_CHANNEL_REQUIRED");
    return this.isolation;
  }
  async dispatch(input: unknown) {
    const { authorization, ...command } = z
      .object({
        mode: z.enum(["dry-run", "execute"]).default("dry-run"),
        contextHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        artifactHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        drainProof: z.unknown().optional(),
        operation: z.enum([
          "inspect",
          "activate",
          "preflight",
          "financial-b",
          "backup-export",
          "release",
          "recovery-init",
          "verify-recovery",
        ]),
        request: z.unknown().optional(),
        isolationApproval: z.unknown().optional(),
        authorization: z.unknown().optional(),
        backupPath: z.string().optional(),
        encryptionKeyBase64: z.string().optional(),
        journalHash: z.string().optional(),
        reference: z.string().optional(),
        executionStarted: z.boolean().optional(),
        checkpoint: z.unknown().optional(),
      })
      .strict()
      .parse(input);
    await this.identity();
    if (command.mode === "dry-run") {
      if (command.operation !== "inspect")
        throw Error("WINDOW_DRY_RUN_INSPECT_ONLY");
      return { status: "DRY_RUN", writes: false, automaticExecution: false };
    }
    if (command.operation === "inspect")
      throw Error("WINDOW_INSPECT_REQUIRES_DRY_RUN");
    if (
      command.operation === "verify-recovery" &&
      command.executionStarted === undefined
    )
      throw Error("WINDOW_EXECUTION_START_EVIDENCE_REQUIRED");
    const a = this.authorization.accept(
      command,
      command.operation as WindowAuthorization["operation"],
      authorization
    );
    if (command.operation === "activate") {
      await this.channel().activate(
        command.isolationApproval as IsolationApproval
      );
      return { status: "ISOLATED", inventory: "PRIVATE_JOURNAL" };
    }
    if (command.operation === "preflight")
      return runIsolatedPreflight(
        command.request,
        this.runtime,
        this.channel()
      );
    if (command.operation === "financial-b")
      return runIsolatedRecovery(command.request, this.runtime, this.channel());
    if (command.operation === "release")
      return this.channel().release(
        command.isolationApproval as IsolationApproval
      );
    if (command.operation === "backup-export") {
      const b = await takeFullBackup(this.control, this.identity);
      return writeEncryptedBackup(
        b,
        command.backupPath ?? "",
        Buffer.from(command.encryptionKeyBase64 ?? "", "base64")
      );
    }
    if (command.operation === "recovery-init")
      return controlRecoveryPlan(true, a.reference, command.journalHash ?? "");
    return inspectAfterControlLoss(
      this.control,
      command.checkpoint as any,
      command.reference ?? "",
      this.identity,
      command.executionStarted === true
    );
  }
}
