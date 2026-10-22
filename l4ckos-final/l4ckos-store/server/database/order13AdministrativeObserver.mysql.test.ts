import { beforeAll, afterAll, it, expect } from "vitest";
import { createConnection, type Connection } from "mysql2/promise";
import {
  mysqlAdministrativeObserver,
  observeAdministrativeGate,
  type ObservationTarget,
} from "../../database/order13Reconciliation/administrativeObserver";
const socketPath = process.env.L4CKOS_ORDER13_LOCAL_SOCKET;
let app: Connection, admin: Connection, target: ObservationTarget;
const open = () =>
  createConnection({ user: "root", socketPath, database: "mysql" });
beforeAll(async () => {
  if (!socketPath?.startsWith("/tmp/l4ckos-order13-"))
    throw Error("DISPOSABLE_SOCKET_REQUIRED");
  app = await open();
  admin = await open();
  const [rows] = await app.query<any[]>("SELECT SHA2(@@server_uuid,256) h");
  if (
    rows[0].h ===
    "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09"
  )
    throw Error("REMOTE_FORBIDDEN");
  target = {
    project: "disposable",
    environment: "local",
    mysqlService: "socket",
    database: "mysql",
    uuidHash: rows[0].h,
  };
  await admin.query(
    "CREATE TEMPORARY TABLE order13_observer_probe (id INT PRIMARY KEY, stock INT) ENGINE=InnoDB"
  );
});
afterAll(async () => {
  await app?.end();
  await admin?.end();
});
it("valid administrative observation and actual operator session exclusion", async () => {
  await app.query(
    "CREATE TEMPORARY TABLE order13_operator_probe (id INT PRIMARY KEY) ENGINE=InnoDB"
  );
  await app.beginTransaction();
  await app.query("INSERT INTO order13_operator_probe VALUES (1)");
  try {
    await observeAdministrativeGate(
      app,
      mysqlAdministrativeObserver(open, target),
      target
    );
  } finally {
    await app.rollback();
  }
});
it("unavailable observer fails closed", async () => {
  await expect(
    observeAdministrativeGate(app, undefined, target)
  ).rejects.toThrow("UNAVAILABLE");
});
it("different physical instance fails closed", async () => {
  const wrong = { ...target, uuidHash: "0".repeat(64) };
  await expect(
    observeAdministrativeGate(
      app,
      mysqlAdministrativeObserver(open, wrong),
      wrong
    )
  ).rejects.toThrow("INSTANCE_MISMATCH");
});
it("concurrent transaction is not excluded", async () => {
  await admin.beginTransaction();
  await admin.query("INSERT INTO order13_observer_probe VALUES (1,98)");
  await new Promise(r => setTimeout(r, 150));
  try {
    await expect(
      observeAdministrativeGate(
        app,
        mysqlAdministrativeObserver(open, target),
        target
      )
    ).rejects.toThrow("OTHER_DATABASE_TRANSACTION_ACTIVE");
  } finally {
    await admin.rollback();
  }
});
it("old proof fails closed", async () => {
  await expect(
    observeAdministrativeGate(
      app,
      async r => ({
        ...r,
        observedAt: "2020-01-01T00:00:00Z",
        otherTransactions: 0,
        operatorVisible: true,
      }),
      target
    )
  ).rejects.toThrow("STALE");
});
it("failure between gates rolls back candidate effects", async () => {
  await new Promise(r => setTimeout(r, 150));
  const observer = mysqlAdministrativeObserver(open, target);
  await app.beginTransaction();
  try {
    await observeAdministrativeGate(app, observer, target);
    await app.query("INSERT INTO order13_operator_probe VALUES (2)");
    await expect(
      observeAdministrativeGate(
        app,
        async () => {
          throw Error("offline");
        },
        target
      )
    ).rejects.toThrow("UNAVAILABLE");
  } finally {
    await app.rollback();
  }
  const [rows] = await app.query<any[]>(
    "SELECT COUNT(*) n FROM order13_operator_probe"
  );
  expect(Number(rows[0].n)).toBe(0);
});
