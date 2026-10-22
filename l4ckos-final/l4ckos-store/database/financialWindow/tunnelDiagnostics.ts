import * as metadata from "node:fs";
import { lstat } from "node:fs/promises";
export const TUNNEL_CODES = {
  WINDOW_TUNNEL_ENDPOINT_HOST: ["ENDPOINT", "VALIDATION"],
  WINDOW_TUNNEL_ENDPOINT_PORT: ["ENDPOINT", "VALIDATION"],
  WINDOW_TUNNEL_ENDPOINT_URL_SCHEME: ["ENDPOINT", "VALIDATION"],
  WINDOW_TUNNEL_ENDPOINT_URL_HOST: ["ENDPOINT", "VALIDATION"],
  WINDOW_TUNNEL_ENDPOINT_URL_PORT: ["ENDPOINT", "VALIDATION"],
  WINDOW_TUNNEL_ENDPOINT_DATABASE: ["ENDPOINT", "VALIDATION"],
  WINDOW_TUNNEL_ENDPOINT_USER: ["ENDPOINT", "VALIDATION"],
  WINDOW_TUNNEL_ENDPOINT_FORMAT: ["ENDPOINT", "VALIDATION"],

  WINDOW_TUNNEL_UNCLASSIFIED: ["UNKNOWN", "UNKNOWN"],
  WINDOW_TUNNEL_PENDING: ["SPAWN", "PENDING"],
  WINDOW_TUNNEL_IDENTITY: ["IDENTITY", "VALIDATION"],
  WINDOW_TUNNEL_AMBIGUOUS: ["SERVICE", "VALIDATION"],
  WINDOW_TUNNEL_DEPLOYMENT: ["DEPLOYMENT", "VALIDATION"],
  WINDOW_TUNNEL_SERVICE_NAME: ["SERVICE", "VALIDATION"],
  WINDOW_TUNNEL_ARGUMENTS: ["CLI", "VALIDATION"],
  WINDOW_TUNNEL_CLI_VERSION: ["CLI", "VALIDATION"],
  WINDOW_TUNNEL_DATABASE: ["ENDPOINT", "VALIDATION"],
  WINDOW_TUNNEL_REUSE: ["CLI", "VALIDATION"],
  WINDOW_TUNNEL_CLOSED: ["TRANSPORT", "TRANSPORT"],
  WINDOW_TUNNEL_SPAWN_FAILED: ["SPAWN", "PROCESS"],
  WINDOW_TUNNEL_EXIT_BEFORE_READY: ["READINESS", "PROCESS"],
  WINDOW_TUNNEL_EXIT_AFTER_READY: ["TRANSPORT", "PROCESS"],
  WINDOW_TUNNEL_READY_TIMEOUT: ["READINESS", "TIMEOUT"],
  WINDOW_TUNNEL_OUTPUT_LIMIT: ["OUTPUT", "CONTRACT"],
  WINDOW_TUNNEL_OUTPUT: ["OUTPUT", "CONTRACT"],
  WINDOW_TUNNEL_OUTPUT_FORMAT: ["OUTPUT", "CONTRACT"],
  WINDOW_TUNNEL_ENDPOINT: ["ENDPOINT", "VALIDATION"],
  WINDOW_TUNNEL_SSH_AUTH_REJECTION_REPORTED: ["SSH", "AUTHENTICATION"],
  WINDOW_TUNNEL_SSH_HOST_REJECTION_REPORTED: ["SSH", "AUTHENTICATION"],
  WINDOW_TUNNEL_SSH_KEY_MISSING_REPORTED: ["SSH", "AUTHENTICATION"],
  WINDOW_TUNNEL_SSH_EXIT_REPORTED: ["SSH", "PROCESS"],
  WINDOW_TUNNEL_SSH_TIMEOUT_REPORTED: ["SSH", "TIMEOUT"],
  WINDOW_TUNNEL_INTERACTIVE_REQUIRED_REPORTED: ["CLI", "CONTRACT"],
  WINDOW_TUNNEL_LISTENER_ABSENT: ["LISTENER", "TRANSPORT"],
  WINDOW_TUNNEL_BINDING: ["LOOPBACK", "VALIDATION"],
  WINDOW_TUNNEL_LISTENER_CHECK_FAILED: ["LISTENER", "VALIDATION"],
  WINDOW_TUNNEL_CLEANUP_FAILED: ["CLOSE", "CLEANUP"],
  WINDOW_TUNNEL_TEMP_UNSAFE: ["TEMPORARY_ARTIFACTS", "SECURITY"],
  WINDOW_TUNNEL_TEMP_AUDIT_FAILED: ["TEMPORARY_ARTIFACTS", "SECURITY"],
  WINDOW_TUNNEL_CONNECTION: ["MYSQL", "TRANSPORT"],
  WINDOW_TUNNEL_MYSQL_AUTH_FAILED: ["MYSQL", "AUTHENTICATION"],
  WINDOW_TUNNEL_READY: ["READINESS", "SUCCESS"],
} as const;
export type TunnelCode = keyof typeof TUNNEL_CODES;
export type EndpointField =
  | "HOST"
  | "PORT"
  | "URL_SCHEME"
  | "URL_HOST"
  | "URL_PORT"
  | "DATABASE"
  | "USER"
  | "FORMAT";
const endpointFields = new Set<EndpointField>([
  "HOST",
  "PORT",
  "URL_SCHEME",
  "URL_HOST",
  "URL_PORT",
  "DATABASE",
  "USER",
  "FORMAT",
]);
export type TunnelDiagnostic = {
  field?: EndpointField;
  phase: string;
  category: string;
  code: TunnelCode;
  exitCode: number | null;
  durationMs: number;
  readiness: "WAITING" | "ENDPOINT_VALIDATED" | "LISTENER_VALIDATED" | "FAILED";
  shutdown: "NOT_REQUESTED" | "PENDING" | "EXITED" | "FAILED";
  temporaryArtifacts: {
    presence: "NOT_AUDITED" | "ABSENT" | "PRESENT";
    permissionsSafe: boolean | null;
  };
};
export const initialDiagnostic = (): TunnelDiagnostic => ({
  phase: "SPAWN",
  category: "PROCESS",
  code: "WINDOW_TUNNEL_PENDING",
  exitCode: null,
  durationMs: 0,
  readiness: "WAITING",
  shutdown: "NOT_REQUESTED",
  temporaryArtifacts: { presence: "NOT_AUDITED", permissionsSafe: null },
});
export function sanitizeTunnelDiagnostic(raw: unknown): TunnelDiagnostic {
  const value = (
      raw && typeof raw === "object" ? raw : {}
    ) as Partial<TunnelDiagnostic>,
    s = initialDiagnostic();
  if (value.code && Object.hasOwn(TUNNEL_CODES, value.code)) {
    s.code = value.code;
    [s.phase, s.category] = TUNNEL_CODES[s.code];
    const field = s.code.replace(
      /^WINDOW_TUNNEL_ENDPOINT_/,
      ""
    ) as EndpointField;
    if (endpointFields.has(field)) s.field = field;
  }
  s.exitCode =
    value.exitCode === null || Number.isInteger(value.exitCode)
      ? value.exitCode!
      : null;
  s.durationMs =
    typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0
      ? Math.round(value.durationMs)
      : 0;
  if (
    value.readiness &&
    ["WAITING", "ENDPOINT_VALIDATED", "LISTENER_VALIDATED", "FAILED"].includes(
      value.readiness
    )
  )
    s.readiness = value.readiness;
  if (
    value.shutdown &&
    ["NOT_REQUESTED", "PENDING", "EXITED", "FAILED"].includes(value.shutdown)
  )
    s.shutdown = value.shutdown;
  if (
    value.temporaryArtifacts?.presence &&
    ["NOT_AUDITED", "ABSENT", "PRESENT"].includes(
      value.temporaryArtifacts.presence
    )
  )
    s.temporaryArtifacts.presence = value.temporaryArtifacts.presence;
  if (typeof value.temporaryArtifacts?.permissionsSafe === "boolean")
    s.temporaryArtifacts.permissionsSafe =
      value.temporaryArtifacts.permissionsSafe;
  return s;
}
const brand = Symbol.for("l4ckos.tunnel.failure.v1");
export function isTunnelFailure(error: unknown): error is TunnelFailure {
  return (
    !!error &&
    typeof error === "object" &&
    (error as any)[brand] === true &&
    Object.hasOwn(TUNNEL_CODES, (error as any).code) &&
    typeof (error as any).diagnostic === "function"
  );
}
export class TunnelFailure extends Error {
  readonly [brand] = true;
  constructor(
    readonly code: TunnelCode,
    private snapshot: () => TunnelDiagnostic = initialDiagnostic
  ) {
    super(code);
    this.name = "TunnelFailure";
  }
  diagnostic(): TunnelDiagnostic {
    const { field: _previousField, ...s } = sanitizeTunnelDiagnostic(
        this.snapshot()
      ),
      [phase, category] = TUNNEL_CODES[this.code];
    const field = this.code.replace(
      /^WINDOW_TUNNEL_ENDPOINT_/,
      ""
    ) as EndpointField;
    return {
      ...s,
      ...(endpointFields.has(field) ? { field } : {}),
      phase,
      category,
      code: this.code,
      temporaryArtifacts: { ...s.temporaryArtifacts },
    };
  }
  toJSON() {
    return this.diagnostic();
  }
}
export function tunnelFailure(
  error: unknown,
  fallback: TunnelCode = "WINDOW_TUNNEL_CONNECTION",
  snapshot?: () => TunnelDiagnostic
): TunnelFailure {
  if (error instanceof TunnelFailure)
    return snapshot ? new TunnelFailure(error.code, snapshot) : error;
  if (isTunnelFailure(error))
    return new TunnelFailure(error.code, () => {
      const raw = error.diagnostic(),
        s = initialDiagnostic();
      s.exitCode =
        raw.exitCode === null || Number.isInteger(raw.exitCode)
          ? raw.exitCode
          : null;
      s.durationMs =
        Number.isFinite(raw.durationMs) && raw.durationMs >= 0
          ? Math.round(raw.durationMs)
          : 0;
      if (
        [
          "WAITING",
          "ENDPOINT_VALIDATED",
          "LISTENER_VALIDATED",
          "FAILED",
        ].includes(raw.readiness)
      )
        s.readiness = raw.readiness;
      if (
        ["NOT_REQUESTED", "PENDING", "EXITED", "FAILED"].includes(raw.shutdown)
      )
        s.shutdown = raw.shutdown;
      if (
        ["NOT_AUDITED", "ABSENT", "PRESENT"].includes(
          raw.temporaryArtifacts?.presence
        )
      )
        s.temporaryArtifacts.presence = raw.temporaryArtifacts.presence;
      if (typeof raw.temporaryArtifacts?.permissionsSafe === "boolean")
        s.temporaryArtifacts.permissionsSafe =
          raw.temporaryArtifacts.permissionsSafe;
      return s;
    });
  const code =
    error instanceof Error && Object.hasOwn(TUNNEL_CODES, error.message)
      ? (error.message as TunnelCode)
      : fallback;
  return new TunnelFailure(code, snapshot);
}
// Output is private and ephemeral. A reported CLI/SSH failure is not an inferred root cause.
export function reportedTunnelFailure(text: string): TunnelCode | undefined {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^Error: /, "");
    if (/^\s*(Host|Port|User|Password|Database|URL):/.test(line)) continue;
    if (
      /^(?:[^\s:]+@[^\s:]+: )?Permission denied \(publickey(?:,[a-z-]+)*\)\.?$/.test(
        line
      )
    )
      return "WINDOW_TUNNEL_SSH_AUTH_REJECTION_REPORTED";
    if (line === "Host key verification failed.")
      return "WINDOW_TUNNEL_SSH_HOST_REJECTION_REPORTED";
    if (/^No (?:registered )?SSH keys found/.test(line))
      return "WINDOW_TUNNEL_SSH_KEY_MISSING_REPORTED";
    if (
      /^SSH tunnel exited (?:before it was ready|while coming up) \(/.test(line)
    )
      return "WINDOW_TUNNEL_SSH_EXIT_REPORTED";
    if (
      line ===
      "Timed out waiting for the SSH tunnel to become ready on 127.0.0.1"
    )
      return "WINDOW_TUNNEL_SSH_TIMEOUT_REPORTED";
    if (
      /^(Enter passphrase for key|Are you sure you want to continue connecting)/.test(
        line
      )
    )
      return "WINDOW_TUNNEL_INTERACTIVE_REQUIRED_REPORTED";
    if (/^Service name required in non-interactive mode\./.test(line))
      return "WINDOW_TUNNEL_INTERACTIVE_REQUIRED_REPORTED";
  }
}
// Caller passes paths from a trusted scoped file watcher, never from untrusted CLI text.
// Report only presence and permission safety; do not read content or retain path names.
export async function auditTunnelTemporaryArtifacts(paths: readonly string[]) {
  let safe = true;
  try {
    for (const path of paths) {
      const st = await lstat(path);
      if (
        st.isSymbolicLink() ||
        st.uid !== process.getuid?.() ||
        (st.mode & 0o077) !== 0 ||
        (!st.isFile() && !st.isDirectory())
      )
        safe = false;
    }
  } catch {
    throw new TunnelFailure("WINDOW_TUNNEL_TEMP_AUDIT_FAILED");
  }
  const result = {
    presence: paths.length ? "PRESENT" : "ABSENT",
    permissionsSafe: safe,
  } as const;
  if (!safe)
    throw new TunnelFailure("WINDOW_TUNNEL_TEMP_UNSAFE", () => ({
      ...initialDiagnostic(),
      temporaryArtifacts: result,
    }));
  return result;
}

// Scoped metadata audit of /tmp entries changed while the CLI is alive.
// No file content, path names, or secret-derived hashes leave this closure.
export function createTunnelTemporaryAudit(root = "/tmp") {
  const fs = metadata;
  const scan = () => {
    const entries = new Map<
      string,
      { mtime: number; size: number; directory: boolean }
    >();
    let names: string[];
    try {
      names = fs.readdirSync(root);
    } catch {
      throw new TunnelFailure("WINDOW_TUNNEL_TEMP_AUDIT_FAILED");
    }
    for (const name of names) {
      const path = root + "/" + name;
      try {
        const st = fs.lstatSync(path);
        entries.set(path, {
          mtime: st.mtimeMs,
          size: st.size,
          directory: st.isDirectory(),
        });
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT")
          throw new TunnelFailure("WINDOW_TUNNEL_TEMP_AUDIT_FAILED");
      }
    }
    return entries;
  };
  const before = scan();
  return async () => {
    const after = scan(),
      paths: string[] = [];
    for (const [path, st] of after) {
      const prev = before.get(path);
      if (!prev || prev.mtime !== st.mtime || prev.size !== st.size) {
        paths.push(path);
        if (st.directory) {
          for (const child of fs.readdirSync(path))
            paths.push(path + "/" + child);
        }
      }
    }
    return auditTunnelTemporaryArtifacts(paths);
  };
}
