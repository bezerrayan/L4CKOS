import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ddl = readFileSync(new URL("../drizzle/0018_order_email_events.sql", import.meta.url), "utf8");

describe("0018 order email events DDL regression", () => {
  it("indexes the auto-increment column as the primary key", () => {
    expect(ddl).toMatch(/`id`\s+int\s+AUTO_INCREMENT\s+NOT NULL/i);
    expect(ddl).toMatch(/PRIMARY KEY\s*\(\s*`id`\s*\)/i);
  });

  it("preserves the unique business-event key independently of the primary key", () => {
    expect(ddl).toMatch(/CONSTRAINT `orderEmailEvents_order_event_unique`\s+UNIQUE\s*\(`orderId`,\s*`eventType`\)/i);
  });
});
