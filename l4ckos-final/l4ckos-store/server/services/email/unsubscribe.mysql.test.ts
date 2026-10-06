import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Connection } from "mysql2/promise";
import { openBackupConnection } from "../../database/backupRestore";
import { bootstrapArtifacts } from "../../../database/schema/artifacts";
import { buildUnsubscribeToken } from "./emailSubscriptions.js";
import emailRoutes from "../../routes/email.routes";
import { getDb } from "../../db";

const socketPath = "/tmp/l4ckos-reconciliation-socket/mysqld.sock";
const name = `l4ckos_test_unsubscribe_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
let root: Connection;
let db: Connection;
async function invoke(token: string) {
  const r = { status: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
  const route = (emailRoutes as any).stack.find((entry: any) => entry.route?.path === "/email/unsubscribe");
  await route.route.stack[0].handle({ query: { token } }, r);
  return r;
}
describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")("unsubscribe handler against isolated MySQL 8.4.11", () => {
  beforeAll(async () => {
    vi.stubEnv("L4CKOS_LOCAL_RESTORE", "1");
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "synthetic-signing-secret-at-least-32");
    root = await openBackupConnection("mysql://root@localhost/mysql", socketPath);
    expect((await root.query<any[]>("SELECT VERSION() v"))[0][0].v).toBe("8.4.11");
    await root.query(`CREATE DATABASE \`${name}\``);
    db = await openBackupConnection(`mysql://root@localhost/${name}`, socketPath);
    for (const statement of (await bootstrapArtifacts()).statements) await db.query(statement.sql);
    vi.stubEnv("DATABASE_URL", `mysql://root@localhost/${name}?socketPath=${encodeURIComponent(socketPath)}`);
  });
  afterAll(async () => {
    const orm = await getDb();
    if (orm) await (orm as any).$client.end();
    await db?.end();
    await root?.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await root?.end();
    vi.unstubAllEnvs();
  });
  it("persists only the signed email, rejects other contexts and repeats safely", async () => {
    await db.query("INSERT INTO emailUnsubscribes (email,reason,source) VALUES ('other@example.invalid','preserved','fixture')");
    const token = buildUnsubscribeToken("synthetic@example.invalid");
    expect((await invoke(token)).status).toHaveBeenCalledWith(200);
    expect((await invoke(token)).status).toHaveBeenCalledWith(200);
    expect((await invoke("synthetic.jwt.signature")).status).toHaveBeenCalledWith(400);
    expect((await invoke(`${token}.extra`)).status).toHaveBeenCalledWith(400);
    const [rows] = await db.query<any[]>("SELECT email,reason,source FROM emailUnsubscribes ORDER BY email");
    expect(rows).toEqual([
      { email: "other@example.invalid", reason: "preserved", source: "fixture" },
      { email: "synthetic@example.invalid", reason: "unsubscribe_click", source: "marketing_email" },
    ]);
  });
});
