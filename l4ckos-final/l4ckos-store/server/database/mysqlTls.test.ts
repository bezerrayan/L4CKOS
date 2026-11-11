import { execFileSync } from "node:child_process";
import { createConnection } from "mysql2/promise";
import net from "node:net";
import tls from "node:tls";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertApprovedMysqlTlsCa,
  createMysqlConnectionOptions,
  MYSQL_TLS_CA_SHA256,
  MYSQL_TLS_HOST,
  validateMysqlTlsCa,
} from "./mysqlTls.mjs";

type SyntheticCertificate = { ca: string; cert: string; key: string };

let workDir: string;
let trusted: SyntheticCertificate;
let wrongSan: SyntheticCertificate;
let unrelatedCa: string;

function runOpenSsl(args: string[]) {
  execFileSync("openssl", args, { stdio: ["ignore", "ignore", "pipe"] });
}

function makeCa(prefix: string) {
  const key = join(workDir, `${prefix}-ca.key`);
  const cert = join(workDir, `${prefix}-ca.pem`);
  runOpenSsl([
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
    "-keyout", key, "-out", cert, "-days", "1", "-subj", `/CN=${prefix}`,
  ]);
  return { key, cert };
}

function makeLeaf(prefix: string, san: string, ca: { key: string; cert: string }): SyntheticCertificate {
  const key = join(workDir, `${prefix}-server.key`);
  const csr = join(workDir, `${prefix}-server.csr`);
  const cert = join(workDir, `${prefix}-server.pem`);
  const ext = join(workDir, `${prefix}-server.ext`);
  runOpenSsl([
    "req", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", csr,
    "-subj", `/CN=${san}`,
  ]);
  writeFileSync(ext, `subjectAltName=DNS:${san}\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n`);
  runOpenSsl([
    "x509", "-req", "-in", csr, "-CA", ca.cert, "-CAkey", ca.key,
    "-CAcreateserial", "-out", cert, "-days", "1", "-sha256", "-extfile", ext,
  ]);
  return { ca: ca.cert, cert, key };
}

function mysqlPacket(payload: Buffer, sequence: number) {
  const header = Buffer.alloc(4);
  header.writeUIntLE(payload.length, 0, 3);
  header[3] = sequence;
  return Buffer.concat([header, payload]);
}

function initialHandshake() {
  const capabilities = 0x00000200 | 0x00000800 | 0x00008000 | 0x00080000;
  const payload = Buffer.concat([
    Buffer.from([0x0a]),
    Buffer.from("8.0.0-tls-fixture\0"),
    Buffer.from([1, 0, 0, 0]),
    Buffer.from("12345678"),
    Buffer.from([0]),
    Buffer.from([capabilities & 0xff, (capabilities >>> 8) & 0xff]),
    Buffer.from([45]),
    Buffer.from([2, 0]),
    Buffer.from([(capabilities >>> 16) & 0xff, (capabilities >>> 24) & 0xff]),
    Buffer.from([21]),
    Buffer.alloc(10),
    Buffer.from("abcdefghijkl\0"),
    Buffer.from("mysql_native_password\0"),
  ]);
  return mysqlPacket(payload, 0);
}

function mysqlErrorPacket() {
  return mysqlPacket(Buffer.concat([
    Buffer.from([0xff, 0x15, 0x04, 0x23]),
    Buffer.from("28000"),
    Buffer.from("fixture authentication stopped after TLS"),
  ]), 3);
}

async function attemptMysqlTls(certificate: SyntheticCertificate, caPem: string) {
  let authenticationResponseSeen = false;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write(initialHandshake());

    let buffer = Buffer.alloc(0);
    let upgraded = false;
    const onData = (chunk: Buffer) => {
      if (upgraded) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const packetLength = buffer.readUIntLE(0, 3);
      if (buffer.length < packetLength + 4) return;
      const packet = buffer.subarray(0, packetLength + 4);
      if (packet[3] !== 1 || packetLength !== 32) {
        socket.destroy(new Error("Unexpected packet before TLS"));
        return;
      }
      upgraded = true;
      socket.removeListener("data", onData);
      const remainder = buffer.subarray(packetLength + 4);
      if (remainder.length) socket.unshift(remainder);
      socket.pause();

      const secureSocket = new tls.TLSSocket(socket, {
        isServer: true,
        secureContext: tls.createSecureContext({
          key: readFileSync(certificate.key),
          cert: readFileSync(certificate.cert),
        }),
      });
      secureSocket.on("error", () => undefined);
      secureSocket.on("secure", () => {
        secureSocket.on("data", () => {
          authenticationResponseSeen = true;
          secureSocket.end(mysqlErrorPacket());
        });
      });
    };
    socket.on("data", onData);
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TLS_FIXTURE_LISTENER_FAILED");

  let connectionError: unknown;
  try {
    const connection = await createConnection({
      host: MYSQL_TLS_HOST,
      port: address.port,
      user: "synthetic-user",
      password: "synthetic-password",
      database: "synthetic",
      connectTimeout: 1500,
      stream: () => net.createConnection({ host: "127.0.0.1", port: address.port }),
      ssl: { ca: caPem, rejectUnauthorized: true, verifyIdentity: true },
    });
    await connection.end();
  } catch (error) {
    connectionError = error;
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
  return { authenticationResponseSeen, connectionError };
}

describe("dedicated MySQL TLS configuration", () => {
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "l4ckos-mysql-tls-test-"));
    const ca = makeCa("l4ckos-test-ca");
    trusted = makeLeaf("valid", MYSQL_TLS_HOST, ca);
    wrongSan = makeLeaf("wrong-san", "wrong-host.invalid", ca);
    unrelatedCa = makeCa("unrelated-test-ca").cert;
  });

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("uses the approved CA hash and strict mysql2 identity options", () => {
    const ca = assertApprovedMysqlTlsCa();
    const options = createMysqlConnectionOptions(`mysql://user:password@${MYSQL_TLS_HOST}:3306/railway`);
    expect(validateMysqlTlsCa(ca)).toBe(ca);
    expect(options.ssl).toMatchObject({
      ca,
      rejectUnauthorized: true,
      verifyIdentity: true,
    });
    expect(options.uri).toContain(`@${MYSQL_TLS_HOST}:`);
    expect(MYSQL_TLS_CA_SHA256).toBe("bc5d33922ec3d772622d9dcf19fdc95a17c7a1f0106b344e78c1169687c24c54");
  });

  it("fails closed for a missing or hash-divergent CA", () => {
    expect(() => validateMysqlTlsCa("")).toThrow("MYSQL_TLS_CA_MISSING");
    expect(() => validateMysqlTlsCa(`${assertApprovedMysqlTlsCa()}\n`)).toThrow("MYSQL_TLS_CA_SHA256_MISMATCH");
  });

  it("rejects a connection URL with an unapproved hostname", () => {
    expect(() => createMysqlConnectionOptions("mysql://user:password@wrong-host.invalid:3306/railway"))
      .toThrow("MYSQL_TLS_HOST_MISMATCH");
  });

  it("completes certificate validation for a trusted CA and matching SAN before MySQL authentication", async () => {
    const result = await attemptMysqlTls(trusted, readFileSync(trusted.ca, "utf8"));
    expect(result.authenticationResponseSeen, String((result.connectionError as Error)?.message ?? "no connection error"))
      .toBe(true);
    expect(result.connectionError).toBeTruthy();
  });

  it("rejects an untrusted CA before transmitting a MySQL authentication response", async () => {
    const result = await attemptMysqlTls(trusted, readFileSync(unrelatedCa, "utf8"));
    expect(result.connectionError).toBeTruthy();
    expect(result.authenticationResponseSeen).toBe(false);
  });

  it("rejects a trusted certificate with a mismatched SAN before transmitting authentication", async () => {
    const result = await attemptMysqlTls(wrongSan, readFileSync(wrongSan.ca, "utf8"));
    expect(result.connectionError).toBeTruthy();
    expect(result.authenticationResponseSeen).toBe(false);
  });

  it("keeps migrations out of application startup and build scripts", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
    const startup = readFileSync(resolve(process.cwd(), "server/_core/index.ts"), "utf8");
    expect(packageJson.scripts.start).not.toMatch(/db:(?:migrate|push|bootstrap)/);
    expect(packageJson.scripts["build:server"]).not.toMatch(/db:(?:migrate|push|bootstrap)/);
    expect(startup).not.toMatch(/(?:db:)?(?:migrate|schema:push|drizzle-kit push)/i);
  });
});
