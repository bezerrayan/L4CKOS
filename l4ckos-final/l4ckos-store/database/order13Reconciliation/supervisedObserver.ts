import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";
import type {
  AdministrativeObserver,
  ObservationTarget,
} from "./administrativeObserver";

export const FRAME = "ORDER13_OBSERVER ";
const configSchema = z
  .object({ version: z.literal(1), runId: z.string().uuid() })
  .strict();
const requestSchema = z
  .object({
    nonce: z.string().uuid(),
    operatorSession: z.number().int().positive().safe(),
    operatorUser: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
    target: z
      .object({
        project: z.string(),
        environment: z.string(),
        mysqlService: z.string(),
        database: z.string(),
        uuidHash: z.string(),
      })
      .strict(),
  })
  .strict();
const sampleSchema = z
  .object({
    version: z.literal(1),
    runId: z.string().uuid(),
    gate: z.enum(["beforeWrite", "beforeCommit"]),
    nonce: z.string().uuid(),
    operatorSession: z.number().int().positive().safe(),
    project: z.string(),
    environment: z.string(),
    mysqlService: z.string(),
    database: z.string(),
    uuidHash: z.string(),
    account: z.literal("root@localhost"),
    observedAt: z.string().datetime({ offset: true }),
    operatorVisible: z.literal(1),
    operatorInTransaction: z.literal(1),
    otherTransactions: z.number().int().nonnegative().safe(),
  })
  .strict();
function need(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error(code);
}

/** Private pipes owned by the authenticated Ubuntu supervisor; no receipt/file/CLI proof input. */
export function createSupervisedObserver(
  input: Readable,
  output: Writable,
  runId: string
): AdministrativeObserver {
  configSchema.parse({ version: 1, runId });
  let sequence = 0,
    dead = false,
    session: number | undefined,
    user: string | undefined;
  let pending:
    | { resolve: (v: unknown) => void; reject: (e: Error) => void }
    | undefined;
  const rl = createInterface({ input, crlfDelay: Infinity });
  const fail = () => {
    dead = true;
    pending?.reject(Error("OBSERVER_CHANNEL_LOST"));
    pending = undefined;
    rl.close();
  };
  input.on("error", fail);
  output.on("error", fail);
  rl.on("close", () => {
    dead = true;
    pending?.reject(Error("OBSERVER_CHANNEL_LOST"));
    pending = undefined;
  });
  rl.on("line", line => {
    if (!pending || line.length > 8192 || !line.startsWith(FRAME))
      return fail();
    const p = pending;
    pending = undefined;
    try {
      p.resolve(JSON.parse(line.slice(FRAME.length)));
    } catch {
      p.reject(Error("OBSERVER_AMBIGUOUS_RESPONSE"));
      fail();
    }
  });
  return async raw => {
    need(!dead && !pending && sequence < 2, "OBSERVER_CHANNEL_UNAVAILABLE");
    const request = requestSchema.parse(raw);
    if (sequence === 0) {
      session = request.operatorSession;
      user = request.operatorUser;
    }
    need(
      session === request.operatorSession && user === request.operatorUser,
      "OBSERVER_SESSION_CHANGED"
    );
    const gate = ++sequence === 1 ? "beforeWrite" : "beforeCommit";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        pending = { resolve, reject };
        timer = setTimeout(fail, 4500);
        output.write(
          FRAME + JSON.stringify({ version: 1, runId, gate, request }) + "\n"
        );
      });
      need(!dead, "OBSERVER_AMBIGUOUS_RESPONSE");
      const sample = sampleSchema.parse(response);
      need(
        sample.runId === runId &&
          sample.gate === gate &&
          sample.nonce === request.nonce &&
          sample.operatorSession === session,
        "OBSERVER_BINDING_MISMATCH"
      );
      for (const [key, value] of Object.entries(request.target))
        need(
          sample[key as keyof typeof sample] === value,
          "OBSERVER_INSTANCE_MISMATCH"
        );
      return {
        nonce: sample.nonce,
        operatorSession: sample.operatorSession,
        target: request.target,
        observedAt: sample.observedAt,
        otherTransactions: sample.otherTransactions,
        operatorVisible: true,
      };
    } catch (error) {
      fail();
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (sequence === 2) rl.close();
    }
  };
}

export function runtimeSupervisedObserver():
  | AdministrativeObserver
  | undefined {
  const d = Object.getOwnPropertyDescriptor(globalThis, "__order13Supervisor");
  if (!d) return undefined;
  need(
    d.writable === false && d.configurable === false,
    "OBSERVER_RUNTIME_BINDING_INVALID"
  );
  const config = configSchema.parse(d.value);
  return createSupervisedObserver(process.stdin, process.stdout, config.runId);
}
