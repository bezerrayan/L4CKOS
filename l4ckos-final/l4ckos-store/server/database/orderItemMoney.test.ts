import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { orderItems, products, auditLogs, stockReservations } from "../../drizzle/schema";
import { orderItemMoney } from "./orderItemMoney";

describe("order item frozen integer cents", () => {
  it.each([1, 2, 3, 7])("derives line total for quantity %i", quantity => {
    expect(orderItemMoney(5990, quantity)).toEqual({ unitPrice: 5990, quantity, totalPrice: 5990 * quantity });
  });
  it("permits zero price and rejects invalid cents, quantities and overflow", () => {
    expect(orderItemMoney(0, 3).totalPrice).toBe(0);
    for (const price of [-1, 0.5, NaN, Infinity, 2147483648]) expect(() => orderItemMoney(price, 1)).toThrow();
    for (const quantity of [0, -1, 1.5, NaN, Infinity]) expect(() => orderItemMoney(5990, quantity)).toThrow();
    expect(() => orderItemMoney(2147483647, 2)).toThrow();
    expect(orderItemMoney(2147483647, 1).totalPrice).toBe(2147483647);
  });
  it("maps the physical columns without changing catalog price", () => {
    const columns = getTableColumns(orderItems);
    expect(columns.unitPrice.name).toBe("unitPrice");
    expect(columns).not.toHaveProperty("price");
    expect(columns.totalPrice.notNull).toBe(false);
    expect(getTableColumns(products).price.name).toBe("price");
    expect(getTableColumns(auditLogs).actorUserId.notNull).toBe(false);
    expect(getTableColumns(auditLogs).actorType.enumValues).toEqual(["admin", "user", "system"]);
    expect(getTableColumns(stockReservations).status.enumValues).toContain("restocked");
  });
});
