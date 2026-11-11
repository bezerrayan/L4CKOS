import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import {
  EXCLUSIVE_DROP_ERROR_CODES as CODES,
  computeDropState,
  isPurchaseWindowOpen,
  isRequestWindowOpen,
  type AccessRequestStatus,
  type DropLike,
  type DropStoredStatus,
  type ExclusiveDropErrorCode,
  type ProductDropView,
  type PublicDropView,
  type ViewerAccessView,
  type AdminSaveDropInput,
} from "../../shared/exclusiveDropsV1";
import { generateAccessCode, hashAccessCode, isWellFormedAccessCode } from "./codes";

export class ExclusiveError extends Error {
  constructor(public readonly code: ExclusiveDropErrorCode | "NOT_FOUND" | "ALREADY_DECIDED" | "INVALID_STATE", message: string) {
    super(message);
    this.name = "ExclusiveError";
  }
}

/** A claim taken before the STOCK attempt row exists is honored this long (the create is in flight). */
export const CLAIM_GRACE_MS = 2 * 60 * 1000;
export const REDEEM_MAX_FAILURES = 5;
export const REDEEM_WINDOW_MS = 15 * 60 * 1000;
export const NOTIFICATION_LEASE_MS = 5 * 60 * 1000;

type Row = RowDataPacket & Record<string, any>;

/** All instants are stored and compared as UTC; never rely on the pool/session time zone. */
const sqlTime = (date: Date) => date.toISOString().replace("T", " ").replace("Z", "");
const dt = (column: string, alias = column.split(".").pop()!) => `DATE_FORMAT(${column}, '%Y-%m-%d %H:%i:%s.%f') AS ${alias}`;
const parseTime = (value: unknown): Date | null => (value ? new Date(`${String(value).replace(" ", "T")}Z`) : null);
const iso = (date: Date | null) => (date ? date.toISOString() : null);

const DROP_COLUMNS = `d.id, d.slug, d.name, d.description, d.timezone, d.isPublic, d.requiresAuthorization, d.defaultUnitLimit, d.status AS storedStatus,
  ${dt("d.requestStartsAt")}, ${dt("d.requestEndsAt")}, ${dt("d.purchaseStartsAt")}, ${dt("d.purchaseEndsAt")}`;

type DropRecord = DropLike & {
  id: number; slug: string; name: string; description: string | null; timezone: string;
  isPublic: boolean; requiresAuthorization: boolean; defaultUnitLimit: number;
};

function toDrop(row: Row): DropRecord {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: row.description ?? null,
    timezone: String(row.timezone),
    isPublic: Boolean(row.isPublic),
    requiresAuthorization: Boolean(row.requiresAuthorization),
    defaultUnitLimit: Number(row.defaultUnitLimit),
    storedStatus: row.storedStatus as DropStoredStatus,
    requestStartsAt: parseTime(row.requestStartsAt),
    requestEndsAt: parseTime(row.requestEndsAt),
    purchaseStartsAt: parseTime(row.purchaseStartsAt)!,
    purchaseEndsAt: parseTime(row.purchaseEndsAt)!,
  };
}

export function toPublicDrop(drop: DropRecord, now: Date): PublicDropView {
  return {
    id: drop.id,
    slug: drop.slug,
    name: drop.name,
    description: drop.description,
    state: computeDropState(drop, now),
    timezone: drop.timezone,
    requiresAuthorization: drop.requiresAuthorization,
    requestWindow: { startsAt: iso(drop.requestStartsAt), endsAt: iso(drop.requestEndsAt), open: isRequestWindowOpen(drop, now) },
    purchaseWindow: { startsAt: drop.purchaseStartsAt.toISOString(), endsAt: drop.purchaseEndsAt.toISOString(), open: isPurchaseWindowOpen(drop, now) },
  };
}

const errno = (error: unknown) => (typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : "");
const isMissingTable = (error: unknown) => errno(error) === "ER_NO_SUCH_TABLE";
const isDuplicate = (error: unknown) => errno(error) === "ER_DUP_ENTRY";

async function withTransaction<T>(pool: Pool, work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      if ((errno(error) === "ER_LOCK_DEADLOCK" || errno(error) === "ER_LOCK_WAIT_TIMEOUT") && attempt < 2) continue;
      throw error;
    } finally {
      connection.release();
    }
  }
}

/**
 * Units of a grant still counted against its limit, DERIVED from the STOCK attempt each claim points to:
 *  - STOCK attempt missing: the claim counts only during the short in-flight grace window;
 *  - paid, reserved, pending, ambiguous or awaiting reconciliation: counts;
 *  - released with a SAFE provider state (never started / definitive failure) and no reconciliation flag: free.
 * Nothing is "released" by writing here, so cancel/expiry is idempotent and never ahead of STOCK's own reconciliation.
 */
const COUNTED_UNITS_SQL = `
  SELECT COALESCE(SUM(u.units), 0) AS used
    FROM exclusiveGrantUsage u
    LEFT JOIN stockCheckoutAttempts a ON a.attemptId = u.attemptId
   WHERE u.grantId = ?
     AND (
       (a.attemptId IS NULL AND u.createdAt > ?)
       OR (a.attemptId IS NOT NULL AND NOT (
            a.status = 'released' AND a.providerState IN ('not_started', 'definitive_failure') AND a.reconciliationRequiredAt IS NULL))
     )`;

async function countedUnits(connection: Pool | PoolConnection, grantId: number, now: Date): Promise<number> {
  const [rows] = await connection.query<Row[]>(COUNTED_UNITS_SQL, [grantId, sqlTime(new Date(now.getTime() - CLAIM_GRACE_MS))]);
  return Number(rows[0]?.used ?? 0);
}

export type CheckoutItem = { productId: number; variantId?: number; quantity: number };
export type ExclusiveCheckoutClaim = { userId: number; attemptId: string; items: CheckoutItem[]; now?: Date };

export type NotificationEvent = {
  eventKey: string;
  eventType: "request_received" | "access_approved" | "access_rejected" | "access_revoked";
  userId: number;
  requestId: number;
};

/** Contract for the transactional e-mail adapter. The provider must use `eventKey` as its idempotency key. */
export interface ExclusiveDropNotifier {
  send(event: NotificationEvent): Promise<void>;
}

export function createExclusiveStore(pool: Pool, options: { now?: () => Date } = {}) {
  const clock = options.now ?? (() => new Date());

  async function dropForProductIds(connection: Pool | PoolConnection, productIds: number[], lock = false): Promise<Map<number, DropRecord>> {
    if (!productIds.length) return new Map();
    const [rows] = await connection.query<Row[]>(
      `SELECT p.productId, ${DROP_COLUMNS} FROM exclusiveDropProducts p JOIN exclusiveDrops d ON d.id = p.dropId WHERE p.productId IN (?)${lock ? " FOR UPDATE" : ""}`,
      [productIds],
    );
    return new Map(rows.map(row => [Number(row.productId), toDrop(row)]));
  }

  async function event(connection: PoolConnection, input: { dropId: number; requestId?: number | null; grantId?: number | null; subjectUserId: number; actorUserId?: number | null; event: string; details?: string; at: Date }) {
    await connection.query(
      `INSERT INTO exclusiveEvents (dropId, requestId, grantId, subjectUserId, actorUserId, event, details, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.dropId, input.requestId ?? null, input.grantId ?? null, input.subjectUserId, input.actorUserId ?? null, input.event, input.details?.slice(0, 500) ?? null, sqlTime(input.at)],
    );
  }

  async function outbox(connection: PoolConnection, input: NotificationEvent & { at: Date }) {
    // INSERT IGNORE on the unique logical key: a retried decision never duplicates the notification.
    await connection.query(
      `INSERT IGNORE INTO exclusiveNotificationOutbox (eventKey, eventType, userId, requestId, createdAt) VALUES (?, ?, ?, ?, ?)`,
      [input.eventKey, input.eventType, input.userId, input.requestId, sqlTime(input.at)],
    );
  }

  async function activeGrant(connection: Pool | PoolConnection, dropId: number, userId: number, lock: boolean) {
    const [rows] = await connection.query<Row[]>(
      `SELECT g.id, g.requestId, g.unitLimit, ${dt("g.expiresAt")}, ${dt("g.unlockedAt")}
         FROM exclusiveGrants g JOIN exclusiveAccessRequests r ON r.id = g.requestId
        WHERE g.dropId = ? AND g.userId = ? AND g.revokedAt IS NULL AND r.status = 'approved'
        ORDER BY g.id DESC LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
      [dropId, userId],
    );
    const row = rows[0];
    return row ? { id: Number(row.id), requestId: Number(row.requestId), unitLimit: Number(row.unitLimit), expiresAt: parseTime(row.expiresAt)!, unlockedAt: parseTime(row.unlockedAt) } : null;
  }

  const store = {
    // ------------------------------------------------------------------ storefront
    async viewerAccess(userId: number | null, drop: DropRecord, now = clock()): Promise<ViewerAccessView> {
      if (userId == null) return { status: "login_required" };
      const [requests] = await pool.query<Row[]>(`SELECT status FROM exclusiveAccessRequests WHERE dropId = ? AND userId = ?`, [drop.id, userId]);
      const status = requests[0]?.status as AccessRequestStatus | undefined;
      if (!status) return { status: "none" };
      if (status !== "approved") return { status };
      const grant = await activeGrant(pool, drop.id, userId, false);
      if (!grant) return { status: "revoked" };
      const used = await countedUnits(pool, grant.id, now);
      const base = { unitLimit: grant.unitLimit, unitsUsed: used, unitsRemaining: Math.max(0, grant.unitLimit - used), expiresAt: grant.expiresAt.toISOString() };
      if (grant.expiresAt.getTime() <= now.getTime()) return { status: "expired", ...base, unitsRemaining: 0 };
      return { status: grant.unlockedAt ? "unlocked" : "approved", ...base };
    },

    /** Public view of a product's drop. Missing migration or no drop = not exclusive. Draft drops are invisible. */
    async productDrop(productId: number, userId: number | null, now = clock()): Promise<ProductDropView> {
      let drop: DropRecord | undefined;
      try {
        drop = (await dropForProductIds(pool, [productId])).get(productId);
      } catch (error) {
        if (isMissingTable(error)) return { exclusive: false };
        throw error;
      }
      if (!drop || computeDropState(drop, now) === "hidden" || !drop.isPublic) {
        // Hidden/non-public drop: the product stays purchase-blocked on the server, but nothing is advertised.
        return drop ? { exclusive: true, drop: toPublicDrop({ ...drop, name: "Drop exclusivo", description: null }, now), viewer: await store.viewerAccess(userId, drop, now) } : { exclusive: false };
      }
      return { exclusive: true, drop: toPublicDrop(drop, now), viewer: await store.viewerAccess(userId, drop, now) };
    },

    async requestAccess(userId: number, dropId: number, now = clock()) {
      return withTransaction(pool, async connection => {
        const [drops] = await connection.query<Row[]>(`SELECT ${DROP_COLUMNS} FROM exclusiveDrops d WHERE d.id = ?`, [dropId]);
        if (!drops[0]) throw new ExclusiveError("NOT_FOUND", "Drop não encontrado.");
        const drop = toDrop(drops[0]);
        const find = async () => {
          const [rows] = await connection.query<Row[]>(`SELECT id, status FROM exclusiveAccessRequests WHERE dropId = ? AND userId = ? FOR UPDATE`, [dropId, userId]);
          return rows[0];
        };
        let existing = await find();
        // Idempotent: a duplicate click on a pending/approved request returns it unchanged.
        if (existing && (existing.status === "pending" || existing.status === "approved")) return { requestId: Number(existing.id), status: existing.status as AccessRequestStatus, created: false };
        if (existing?.status === "revoked") return { requestId: Number(existing.id), status: "revoked" as AccessRequestStatus, created: false };
        if (!isRequestWindowOpen(drop, now)) throw new ExclusiveError(CODES.requestWindowClosed, "As solicitações de acesso a este drop não estão abertas.");
        if (!existing) {
          try {
            const [inserted] = await connection.query<ResultSetHeader>(
              `INSERT INTO exclusiveAccessRequests (dropId, userId, status, createdAt) VALUES (?, ?, 'pending', ?)`, [dropId, userId, sqlTime(now)]);
            const requestId = inserted.insertId;
            await event(connection, { dropId, requestId, subjectUserId: userId, event: "requested", at: now });
            await outbox(connection, { eventKey: `req:${requestId}:received:1`, eventType: "request_received", userId, requestId, at: now });
            return { requestId, status: "pending" as AccessRequestStatus, created: true };
          } catch (error) {
            if (!isDuplicate(error)) throw error;
            existing = await find();
            return { requestId: Number(existing!.id), status: existing!.status as AccessRequestStatus, created: false };
          }
        }
        // Rejected earlier: the customer may ask again (back to pending, new notification sequence).
        await connection.query(`UPDATE exclusiveAccessRequests SET status = 'pending', decidedAt = NULL, decidedByUserId = NULL WHERE id = ?`, [existing.id]);
        const [[count]] = await connection.query<Row[]>(`SELECT COUNT(*) AS n FROM exclusiveEvents WHERE requestId = ? AND event = 'requested'`, [existing.id]) as unknown as [Row[]];
        await event(connection, { dropId, requestId: Number(existing.id), subjectUserId: userId, event: "requested", at: now });
        await outbox(connection, { eventKey: `req:${existing.id}:received:${Number(count?.n ?? 0) + 1}`, eventType: "request_received", userId, requestId: Number(existing.id), at: now });
        return { requestId: Number(existing.id), status: "pending" as AccessRequestStatus, created: true };
      });
    },

    async myRequests(userId: number, now = clock()) {
      const [rows] = await pool.query<Row[]>(
        `SELECT r.id, r.status, ${dt("r.createdAt")}, ${DROP_COLUMNS} FROM exclusiveAccessRequests r JOIN exclusiveDrops d ON d.id = r.dropId WHERE r.userId = ? ORDER BY r.id DESC`, [userId]);
      const out = [];
      for (const row of rows) {
        const drop = toDrop(row);
        out.push({ requestId: Number(row.id), requestStatus: row.status as AccessRequestStatus, drop: toPublicDrop(drop, now), viewer: await store.viewerAccess(userId, drop, now) });
      }
      return out;
    },

    /** Unlocks the caller's own grant with the individual code. Wrong/foreign/expired/revoked codes are indistinguishable. */
    async redeemCode(userId: number, code: string, now = clock()) {
      const since = sqlTime(new Date(now.getTime() - REDEEM_WINDOW_MS));
      const [failed] = await pool.query<Row[]>(`SELECT COUNT(*) AS n FROM exclusiveRedeemAttempts WHERE userId = ? AND success = 0 AND createdAt > ?`, [userId, since]);
      if (Number(failed[0]?.n ?? 0) >= REDEEM_MAX_FAILURES) throw new ExclusiveError(CODES.codeRateLimited, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");

      const fail = async (): Promise<never> => {
        await pool.query(`INSERT INTO exclusiveRedeemAttempts (userId, success, createdAt) VALUES (?, 0, ?)`, [userId, sqlTime(now)]);
        throw new ExclusiveError(CODES.codeInvalid, "Código inválido ou indisponível para esta conta.");
      };
      if (!isWellFormedAccessCode(code)) return fail();
      const hash = hashAccessCode(code);

      const outcome = await withTransaction(pool, async connection => {
        const [rows] = await connection.query<Row[]>(
          `SELECT g.id AS grantId, g.requestId, g.userId, g.dropId, ${dt("g.expiresAt")}, ${dt("g.unlockedAt")}, g.revokedAt IS NOT NULL AS revoked,
                  r.status AS requestStatus, ${DROP_COLUMNS}
             FROM exclusiveGrants g
             JOIN exclusiveAccessRequests r ON r.id = g.requestId
             JOIN exclusiveDrops d ON d.id = g.dropId
            WHERE g.codeHash = ? FOR UPDATE`, [hash]);
        const row = rows[0];
        if (!row) return false;
        const drop = toDrop(row);
        const state = computeDropState(drop, now);
        const valid = Number(row.userId) === userId && !row.revoked && row.requestStatus === "approved"
          && parseTime(row.expiresAt)!.getTime() > now.getTime() && (state === "scheduled" || state === "active");
        if (!valid) return false;
        if (!row.unlockedAt) {
          await connection.query(`UPDATE exclusiveGrants SET unlockedAt = ? WHERE id = ?`, [sqlTime(now), row.grantId]);
          await event(connection, { dropId: drop.id, requestId: Number(row.requestId), grantId: Number(row.grantId), subjectUserId: userId, event: "code_redeemed", at: now });
        }
        await connection.query(`INSERT INTO exclusiveRedeemAttempts (userId, success, createdAt) VALUES (?, 1, ?)`, [userId, sqlTime(now)]);
        return true;
      });
      if (!outcome) return fail();
      return { unlocked: true as const };
    },

    // ------------------------------------------------------------------ checkout guard (server-side enforcement)
    /** Called by STOCK inside the same MySQL transaction that creates the attempt and reserves variants. */
    async reserveForCheckoutInTransaction(connection: PoolConnection, input: ExclusiveCheckoutClaim): Promise<void> {
      try {
        const now = input.now ?? clock();
        const drops = await dropForProductIds(connection, [...new Set(input.items.map(item => item.productId))], true);

        const unitsByDrop = new Map<number, { drop: DropRecord; units: number }>();
        for (const item of input.items) {
          const drop = drops.get(item.productId);
          if (!drop) continue;
          const entry = unitsByDrop.get(drop.id) ?? { drop, units: 0 };
          entry.units += item.quantity;
          unitsByDrop.set(drop.id, entry);
        }

        for (const { drop } of unitsByDrop.values()) {
          if (!isPurchaseWindowOpen(drop, now)) throw new ExclusiveError(CODES.dropClosed, "Este drop não está aberto para compras.");
        }
        const needsGrant = [...unitsByDrop.values()].filter(entry => entry.drop.requiresAuthorization).sort((a, b) => a.drop.id - b.drop.id);
        for (const { drop, units } of needsGrant) {
          const grant = await activeGrant(connection, drop.id, input.userId, true);
          if (!grant || !grant.unlockedAt || grant.expiresAt.getTime() <= now.getTime()) {
            throw new ExclusiveError(CODES.accessRequired, "Você precisa de acesso aprovado e desbloqueado para comprar este produto.");
          }
          const [existing] = await connection.query<Row[]>(`SELECT units FROM exclusiveGrantUsage WHERE grantId = ? AND attemptId = ?`, [grant.id, input.attemptId]);
          if (existing[0]) {
            if (Number(existing[0].units) !== units) throw new ExclusiveError(CODES.quotaExceeded, "Esta tentativa não pode ser alterada.");
            continue;
          }
          const used = await countedUnits(connection, grant.id, now);
          if (used + units > grant.unitLimit) {
            throw new ExclusiveError(CODES.quotaExceeded, `Limite de unidades excedido (restam ${Math.max(0, grant.unitLimit - used)}).`);
          }
          await connection.query(`INSERT INTO exclusiveGrantUsage (grantId, attemptId, units, createdAt) VALUES (?, ?, ?, ?)`, [grant.id, input.attemptId, units, sqlTime(now)]);
          await event(connection, { dropId: drop.id, requestId: grant.requestId, grantId: grant.id, subjectUserId: input.userId, event: "units_claimed", details: `${units}`, at: now });
        }
      } catch (error) {
        if (error instanceof ExclusiveError) throw error;
        // A schema/query/constraint failure means the server cannot prove the
        // product is public or the grant is valid. The surrounding STOCK tx rolls back.
        throw new ExclusiveError(CODES.unverifiable, "Não foi possível verificar o acesso a este produto.");
      }
    },

    /** Server-side "can this account put this product in a cart?" (no claim, no quota consumption). Public products always pass. */
    async assertCanAddToCart(input: { userId: number; productId: number; quantity: number; now?: Date }): Promise<void> {
      const now = input.now ?? clock();
      let drop: DropRecord | undefined;
      try {
        drop = (await dropForProductIds(pool, [input.productId])).get(input.productId);
      } catch (error) {
        if (isMissingTable(error)) throw new ExclusiveError(CODES.unverifiable, "Não foi possível verificar o acesso a este produto.");
        throw new ExclusiveError(CODES.unverifiable, "Não foi possível verificar o acesso a este produto.");
      }
      if (!drop) return;
      if (!isPurchaseWindowOpen(drop, now)) throw new ExclusiveError(CODES.dropClosed, "Este drop não está aberto para compras.");
      if (!drop.requiresAuthorization) return;
      const grant = await activeGrant(pool, drop.id, input.userId, false).catch(() => {
        throw new ExclusiveError(CODES.unverifiable, "Não foi possível verificar o acesso a este produto.");
      });
      if (!grant || !grant.unlockedAt || grant.expiresAt.getTime() <= now.getTime()) throw new ExclusiveError(CODES.accessRequired, "Você precisa de acesso aprovado e desbloqueado para comprar este produto.");
      const used = await countedUnits(pool, grant.id, now);
      if (used + input.quantity > grant.unitLimit) throw new ExclusiveError(CODES.quotaExceeded, `Limite de unidades excedido (restam ${Math.max(0, grant.unitLimit - used)}).`);
    },

    /** Legacy (non-STOCK) paths must refuse any exclusive product outright. */
    async assertNoExclusiveProducts(productIds: number[]): Promise<void> {
      try {
        const drops = await dropForProductIds(pool, productIds);
        if (drops.size > 0) throw new ExclusiveError(CODES.accessRequired, "Este produto só pode ser comprado pelo checkout de drops exclusivos.");
      } catch (error) {
        if (error instanceof ExclusiveError) throw error;
        if (isMissingTable(error)) throw new ExclusiveError(CODES.unverifiable, "Não foi possível verificar o acesso a este produto.");
        throw new ExclusiveError(CODES.unverifiable, "Não foi possível verificar o acesso a este produto.");
      }
    },

    // ------------------------------------------------------------------ admin
    async saveDrop(input: AdminSaveDropInput, actorUserId: number, now = clock()) {
      return withTransaction(pool, async connection => {
        const values = [input.slug, input.name, input.description ?? null, input.timezone, input.requestStartsAt ? sqlTime(input.requestStartsAt) : null,
          input.requestEndsAt ? sqlTime(input.requestEndsAt) : null, sqlTime(input.purchaseStartsAt), sqlTime(input.purchaseEndsAt),
          input.isPublic ? 1 : 0, input.requiresAuthorization ? 1 : 0, input.defaultUnitLimit, input.status];
        let dropId = input.id;
        if (dropId) {
          await connection.query(
            `UPDATE exclusiveDrops SET slug=?, name=?, description=?, timezone=?, requestStartsAt=?, requestEndsAt=?, purchaseStartsAt=?, purchaseEndsAt=?,
                    isPublic=?, requiresAuthorization=?, defaultUnitLimit=?, status=?, updatedAt=? WHERE id=?`, [...values, sqlTime(now), dropId]);
        } else {
          const [result] = await connection.query<ResultSetHeader>(
            `INSERT INTO exclusiveDrops (slug, name, description, timezone, requestStartsAt, requestEndsAt, purchaseStartsAt, purchaseEndsAt, isPublic, requiresAuthorization, defaultUnitLimit, status, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...values, sqlTime(now), sqlTime(now)]);
          dropId = result.insertId;
        }
        // A product may only belong to one drop. Re-pointing a product to this drop is explicit.
        const [taken] = await connection.query<Row[]>(`SELECT productId FROM exclusiveDropProducts WHERE productId IN (?) AND dropId <> ?`, [input.productIds, dropId]);
        if (taken.length) throw new ExclusiveError("INVALID_STATE", `Produto(s) já participam de outro drop: ${taken.map(r => r.productId).join(", ")}.`);
        await connection.query(`DELETE FROM exclusiveDropProducts WHERE dropId = ? AND productId NOT IN (?)`, [dropId, input.productIds]);
        for (const productId of input.productIds) await connection.query(`INSERT IGNORE INTO exclusiveDropProducts (productId, dropId) VALUES (?, ?)`, [productId, dropId]);
        await event(connection, { dropId: dropId!, subjectUserId: actorUserId, actorUserId, event: input.id ? "drop_updated" : "drop_created", at: now });
        return { dropId: dropId! };
      });
    },

    async listDrops(now = clock()) {
      const [rows] = await pool.query<Row[]>(`SELECT ${DROP_COLUMNS}, (SELECT GROUP_CONCAT(productId) FROM exclusiveDropProducts WHERE dropId = d.id) AS productIds FROM exclusiveDrops d ORDER BY d.id DESC`);
      return rows.map(row => ({ ...toPublicDrop(toDrop(row), now), storedStatus: row.storedStatus as DropStoredStatus, defaultUnitLimit: Number(row.defaultUnitLimit), productIds: String(row.productIds ?? "").split(",").filter(Boolean).map(Number) }));
    },

    async listRequests(filter: { dropId?: number; status?: AccessRequestStatus } = {}, now = clock()) {
      const where: string[] = []; const params: unknown[] = [];
      if (filter.dropId) { where.push("r.dropId = ?"); params.push(filter.dropId); }
      if (filter.status) { where.push("r.status = ?"); params.push(filter.status); }
      const [rows] = await pool.query<Row[]>(
        `SELECT r.id, r.dropId, r.userId, r.status, ${dt("r.createdAt")}, ${dt("r.decidedAt")}, d.name AS dropName, u.name AS userName, u.email AS userEmail,
                g.id AS grantId, g.unitLimit, ${dt("g.expiresAt")}, ${dt("g.unlockedAt")}
           FROM exclusiveAccessRequests r
           JOIN exclusiveDrops d ON d.id = r.dropId
           JOIN users u ON u.id = r.userId
           LEFT JOIN exclusiveGrants g ON g.id = (SELECT MAX(id) FROM exclusiveGrants WHERE requestId = r.id AND revokedAt IS NULL)
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.id DESC LIMIT 500`, params);
      const out = [];
      for (const row of rows) {
        const used = row.grantId ? await countedUnits(pool, Number(row.grantId), now) : 0;
        out.push({
          requestId: Number(row.id), dropId: Number(row.dropId), dropName: String(row.dropName), userId: Number(row.userId),
          userName: row.userName ?? null, userEmail: row.userEmail ?? null, status: row.status as AccessRequestStatus,
          createdAt: iso(parseTime(row.createdAt)), decidedAt: iso(parseTime(row.decidedAt)),
          grant: row.grantId ? { id: Number(row.grantId), unitLimit: Number(row.unitLimit), unitsUsed: used, expiresAt: iso(parseTime(row.expiresAt)), unlocked: Boolean(row.unlockedAt) } : null,
        });
      }
      return out;
    },

    /** Returns the plaintext code ONCE. It is never stored, logged or placed in the outbox. */
    async approve(input: { requestId: number; unitLimit: number; expiresAt: Date; actorUserId: number }, now = clock()) {
      if (input.expiresAt.getTime() <= now.getTime()) throw new ExclusiveError("INVALID_STATE", "A validade do acesso deve estar no futuro.");
      return withTransaction(pool, async connection => {
        const [rows] = await connection.query<Row[]>(`SELECT r.id, r.dropId, r.userId, r.status, ${DROP_COLUMNS} FROM exclusiveAccessRequests r JOIN exclusiveDrops d ON d.id = r.dropId WHERE r.id = ? FOR UPDATE`, [input.requestId]);
        const request = rows[0];
        if (!request) throw new ExclusiveError("NOT_FOUND", "Solicitação não encontrada.");
        if (request.status === "approved") throw new ExclusiveError("ALREADY_DECIDED", "Solicitação já aprovada. Use a reemissão de código, se necessário.");
        if (computeDropState(toDrop(request), now) === "closed") throw new ExclusiveError("INVALID_STATE", "O drop está encerrado.");
        const code = generateAccessCode();
        const [grant] = await connection.query<ResultSetHeader>(
          `INSERT INTO exclusiveGrants (requestId, dropId, userId, codeHash, unitLimit, expiresAt, createdByUserId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [input.requestId, request.dropId, request.userId, hashAccessCode(code), input.unitLimit, sqlTime(input.expiresAt), input.actorUserId, sqlTime(now)]);
        await connection.query(`UPDATE exclusiveAccessRequests SET status='approved', decidedAt=?, decidedByUserId=? WHERE id=?`, [sqlTime(now), input.actorUserId, input.requestId]);
        await event(connection, { dropId: Number(request.dropId), requestId: input.requestId, grantId: grant.insertId, subjectUserId: Number(request.userId), actorUserId: input.actorUserId, event: "approved", details: `limit=${input.unitLimit}`, at: now });
        await outbox(connection, { eventKey: `req:${input.requestId}:approved:${grant.insertId}`, eventType: "access_approved", userId: Number(request.userId), requestId: input.requestId, at: now });
        return { grantId: grant.insertId, code, unitLimit: input.unitLimit, expiresAt: input.expiresAt.toISOString() };
      });
    },

    async reject(input: { requestId: number; actorUserId: number }, now = clock()) {
      return withTransaction(pool, async connection => {
        const [rows] = await connection.query<Row[]>(`SELECT id, dropId, userId, status FROM exclusiveAccessRequests WHERE id = ? FOR UPDATE`, [input.requestId]);
        const request = rows[0];
        if (!request) throw new ExclusiveError("NOT_FOUND", "Solicitação não encontrada.");
        if (request.status !== "pending") throw new ExclusiveError("ALREADY_DECIDED", "Só solicitações pendentes podem ser recusadas.");
        await connection.query(`UPDATE exclusiveAccessRequests SET status='rejected', decidedAt=?, decidedByUserId=? WHERE id=?`, [sqlTime(now), input.actorUserId, input.requestId]);
        const [[count]] = await connection.query<Row[]>(`SELECT COUNT(*) AS n FROM exclusiveEvents WHERE requestId = ? AND event = 'rejected'`, [input.requestId]) as unknown as [Row[]];
        await event(connection, { dropId: Number(request.dropId), requestId: input.requestId, subjectUserId: Number(request.userId), actorUserId: input.actorUserId, event: "rejected", at: now });
        await outbox(connection, { eventKey: `req:${input.requestId}:rejected:${Number(count?.n ?? 0) + 1}`, eventType: "access_rejected", userId: Number(request.userId), requestId: input.requestId, at: now });
        return { status: "rejected" as const };
      });
    },

    /** Revocation blocks NEW claims immediately. Open STOCK attempts keep their own lifecycle; paid units stay in the history. */
    async revoke(input: { requestId: number; actorUserId: number }, now = clock()) {
      return withTransaction(pool, async connection => {
        const [rows] = await connection.query<Row[]>(`SELECT id, dropId, userId, status FROM exclusiveAccessRequests WHERE id = ? FOR UPDATE`, [input.requestId]);
        const request = rows[0];
        if (!request) throw new ExclusiveError("NOT_FOUND", "Solicitação não encontrada.");
        if (request.status !== "approved") throw new ExclusiveError("ALREADY_DECIDED", "Só acessos aprovados podem ser revogados.");
        const [grants] = await connection.query<Row[]>(`SELECT id FROM exclusiveGrants WHERE requestId = ? AND revokedAt IS NULL FOR UPDATE`, [input.requestId]);
        await connection.query(`UPDATE exclusiveGrants SET revokedAt = ? WHERE requestId = ? AND revokedAt IS NULL`, [sqlTime(now), input.requestId]);
        await connection.query(`UPDATE exclusiveAccessRequests SET status='revoked', decidedAt=?, decidedByUserId=? WHERE id=?`, [sqlTime(now), input.actorUserId, input.requestId]);
        const grantId = grants[0] ? Number(grants[0].id) : null;
        await event(connection, { dropId: Number(request.dropId), requestId: input.requestId, grantId, subjectUserId: Number(request.userId), actorUserId: input.actorUserId, event: "revoked", at: now });
        await outbox(connection, { eventKey: `grant:${grantId ?? `req${input.requestId}`}:revoked`, eventType: "access_revoked", userId: Number(request.userId), requestId: input.requestId, at: now });
        return { status: "revoked" as const };
      });
    },

    /** New code for an approved grant; the old code stops working immediately and the customer must unlock again. */
    async reissueCode(input: { requestId: number; actorUserId: number }, now = clock()) {
      return withTransaction(pool, async connection => {
        const [rows] = await connection.query<Row[]>(`SELECT id, dropId, userId, status FROM exclusiveAccessRequests WHERE id = ? FOR UPDATE`, [input.requestId]);
        const request = rows[0];
        if (!request) throw new ExclusiveError("NOT_FOUND", "Solicitação não encontrada.");
        const grant = request.status === "approved" ? await activeGrant(connection, Number(request.dropId), Number(request.userId), true) : null;
        if (!grant) throw new ExclusiveError("INVALID_STATE", "Não há acesso aprovado ativo para reemitir.");
        const code = generateAccessCode();
        await connection.query(`UPDATE exclusiveGrants SET codeHash = ?, unlockedAt = NULL WHERE id = ?`, [hashAccessCode(code), grant.id]);
        await event(connection, { dropId: Number(request.dropId), requestId: input.requestId, grantId: grant.id, subjectUserId: Number(request.userId), actorUserId: input.actorUserId, event: "code_reissued", at: now });
        return { grantId: grant.id, code };
      });
    },

    async history(filter: { dropId?: number; requestId?: number }) {
      const where: string[] = []; const params: unknown[] = [];
      if (filter.dropId) { where.push("e.dropId = ?"); params.push(filter.dropId); }
      if (filter.requestId) { where.push("e.requestId = ?"); params.push(filter.requestId); }
      const [rows] = await pool.query<Row[]>(
        `SELECT e.id, e.dropId, e.requestId, e.grantId, e.subjectUserId, e.actorUserId, e.event, e.details, ${dt("e.createdAt")} FROM exclusiveEvents e
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY e.id DESC LIMIT 500`, params);
      return rows.map(row => ({ id: Number(row.id), dropId: Number(row.dropId), requestId: row.requestId == null ? null : Number(row.requestId), grantId: row.grantId == null ? null : Number(row.grantId),
        subjectUserId: Number(row.subjectUserId), actorUserId: row.actorUserId == null ? null : Number(row.actorUserId), event: String(row.event), details: row.details ?? null, createdAt: iso(parseTime(row.createdAt))! }));
    },

    // ------------------------------------------------------------------ e-mail outbox (adapter only; no provider is wired here)
    /**
     * Claims pending (or lease-expired) notifications atomically, hands them to the adapter with `eventKey` as the provider
     * idempotency key, and finalizes only while this worker still holds the lease. A failure marks `failed` and is never auto-resent.
     */
    async dispatchNotifications(notifier: ExclusiveDropNotifier, limit = 20, now = clock()) {
      const lease = new Date(now.getTime() + NOTIFICATION_LEASE_MS);
      const claimed = await withTransaction(pool, async connection => {
        const [rows] = await connection.query<Row[]>(
          `SELECT id FROM exclusiveNotificationOutbox WHERE status = 'pending' OR (status = 'processing' AND leaseExpiresAt < ?) ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED`,
          [sqlTime(now), limit]);
        if (!rows.length) return [] as Row[];
        const ids = rows.map(row => row.id);
        await connection.query(`UPDATE exclusiveNotificationOutbox SET status='processing', attempts=attempts+1, leaseExpiresAt=? WHERE id IN (?)`, [sqlTime(lease), ids]);
        const [full] = await connection.query<Row[]>(`SELECT id, eventKey, eventType, userId, requestId FROM exclusiveNotificationOutbox WHERE id IN (?)`, [ids]);
        return full;
      });
      let sent = 0; let failed = 0;
      for (const row of claimed) {
        try {
          await notifier.send({ eventKey: String(row.eventKey), eventType: row.eventType, userId: Number(row.userId), requestId: Number(row.requestId) });
          const [res] = await pool.query<ResultSetHeader>(`UPDATE exclusiveNotificationOutbox SET status='sent', sentAt=?, lastError=NULL WHERE id=? AND status='processing' AND leaseExpiresAt=?`, [sqlTime(now), row.id, sqlTime(lease)]);
          if (res.affectedRows) sent += 1;
        } catch (error) {
          failed += 1;
          const message = (error instanceof Error ? error.message : "send failed").replace(/[A-Z0-9]{5}(-[A-Z0-9]{5}){3}/g, "[redacted]").slice(0, 250);
          await pool.query(`UPDATE exclusiveNotificationOutbox SET status='failed', lastError=? WHERE id=? AND status='processing' AND leaseExpiresAt=?`, [message, row.id, sqlTime(lease)]);
        }
      }
      return { claimed: claimed.length, sent, failed };
    },
  };
  return store;
}

export type ExclusiveStore = ReturnType<typeof createExclusiveStore>;
