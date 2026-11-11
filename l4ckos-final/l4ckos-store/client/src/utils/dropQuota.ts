/**
 * Cart-side view of the exclusive-drop purchase limits.
 *
 * Source of truth is the server (`exclusiveDrops.forProduct`): `viewer.unitsRemaining` is derived from STOCK attempts and is
 * SHARED by every product of the same drop (one grant per drop). The cart does not reserve anything, so the number of units
 * the customer may still send to checkout is exactly `unitsRemaining`. This module never invents a limit: when the server view
 * is missing (not loaded, failed, product not exclusive) no cap is applied and checkout stays the definitive gate.
 */
export type DropViewInput =
  | { exclusive: false }
  | {
      exclusive: true;
      drop: { id: number; name: string; requiresAuthorization: boolean; purchaseWindow: { open: boolean } };
      viewer: { status: string; unitsRemaining?: number; unitLimit?: number };
    };

export type DropGroupReason =
  | "ok" // unlocked, within the limit
  | "limit_reached" // unlocked, exactly at the limit
  | "over_limit" // unlocked, cart holds more than the limit
  | "login_required"
  | "needs_access" // signed in without an unlocked, valid grant
  | "window_closed";

export type DropGroup = {
  dropId: number;
  dropName: string;
  productIds: number[];
  /** Units of this drop currently in the cart (all products, sizes and variants). */
  requested: number;
  /** Units the customer may still send to checkout; null = no known cap. */
  cap: number | null;
  /** Total authorised for the drop, when the server reports it. */
  unitLimit: number | null;
  /** Units above the cap (0 when none / unknown). */
  excess: number;
  reason: DropGroupReason;
  /** True when the server data already proves checkout would be refused. */
  blocking: boolean;
};

export type CartLine = { productId: number; quantity: number };

export function computeDropQuota(lines: readonly CartLine[], views: Readonly<Record<number, DropViewInput | undefined>>) {
  const groups = new Map<number, DropGroup>();
  const byProduct: Record<number, DropGroup> = {};
  for (const line of lines) {
    const view = views[line.productId];
    if (!view || !view.exclusive) continue;
    const { drop, viewer } = view;
    let group = groups.get(drop.id);
    if (!group) {
      let cap: number | null = null;
      let reason: DropGroupReason = "ok";
      if (!drop.purchaseWindow.open) {
        cap = 0;
        reason = "window_closed";
      } else if (drop.requiresAuthorization) {
        if (viewer.status === "login_required") {
          cap = 0;
          reason = "login_required";
        } else if (viewer.status !== "unlocked") {
          cap = 0;
          reason = "needs_access";
        } else if (Number.isSafeInteger(viewer.unitsRemaining) && (viewer.unitsRemaining as number) >= 0) {
          cap = viewer.unitsRemaining as number;
        } // unlocked without a usable number: unknown cap, the server decides
      }
      group = {
        dropId: drop.id,
        dropName: drop.name,
        productIds: [],
        requested: 0,
        cap,
        unitLimit: Number.isSafeInteger(viewer.unitLimit) ? (viewer.unitLimit as number) : null,
        excess: 0,
        reason,
        blocking: false,
      };
      groups.set(drop.id, group);
    }
    if (!group.productIds.includes(line.productId)) group.productIds.push(line.productId);
    group.requested += line.quantity;
    byProduct[line.productId] = group;
  }
  for (const group of groups.values()) {
    if (group.cap === null) continue;
    group.excess = Math.max(0, group.requested - group.cap);
    if (group.reason === "ok" && group.requested >= group.cap) group.reason = group.excess > 0 ? "over_limit" : "limit_reached";
    group.blocking = group.excess > 0 || (group.reason !== "ok" && group.reason !== "limit_reached" && group.reason !== "over_limit" && group.requested > 0);
  }
  return { groups: Array.from(groups.values()), byProduct };
}

/** Units that can still be added for a product without crossing a KNOWN cap; null when no cap is known. */
export function additionalUnitsAllowed(group: DropGroup | undefined): number | null {
  if (!group || group.cap === null) return null;
  return Math.max(0, group.cap - group.requested);
}

const plural = (n: number) => `${n} ${n === 1 ? "unidade" : "unidades"}`;

/** Customer-facing explanation; never promises stock or batch capacity, which only the transactional checkout confirms. */
export function describeDropGroup(group: DropGroup): { tone: "info" | "warning"; text: string } {
  const confirm = "O limite e a disponibilidade são confirmados ao finalizar o pedido.";
  switch (group.reason) {
    case "login_required":
      return { tone: "warning", text: `“${group.dropName}” exige uma conta autorizada. Entre na sua conta para validar o seu limite.` };
    case "needs_access":
      return { tone: "warning", text: `“${group.dropName}” exige acesso aprovado e desbloqueado nesta conta. Volte à página do produto para solicitar ou desbloquear o acesso, ou remova estes itens.` };
    case "window_closed":
      return { tone: "warning", text: `A compra de “${group.dropName}” não está aberta no momento. ${confirm}` };
    case "over_limit":
      return { tone: "warning", text: `Sua sacola tem ${plural(group.requested)} de “${group.dropName}”, acima do seu limite de ${plural(group.cap ?? 0)}. Remova ${plural(group.excess)} para continuar.` };
    case "limit_reached":
      return { tone: "info", text: `Limite de “${group.dropName}” atingido: ${plural(group.cap ?? 0)} na sacola, somando todos os produtos e tamanhos do drop. ${confirm}` };
    default:
      return group.cap === null
        ? { tone: "info", text: `“${group.dropName}” tem limite de compra por conta. ${confirm}` }
        : { tone: "info", text: `Você pode comprar até ${plural(group.cap)} de “${group.dropName}” (somando todos os produtos e tamanhos do drop); há ${group.requested} na sacola. ${confirm}` };
  }
}
