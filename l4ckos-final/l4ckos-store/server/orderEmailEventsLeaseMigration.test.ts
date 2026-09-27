import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("order email event processing lease migration", () => {
  const ddl = fs.readFileSync(
    path.resolve(process.cwd(), "drizzle/0019_order_email_event_processing_lease.sql"),
    "utf8",
  );

  it("adds an owned processing lease without rewriting existing events", () => {
    expect(ddl).toMatch(/ALTER TABLE\s+`orderEmailEvents`/i);
    expect(ddl).toMatch(/ADD COLUMN\s+`processingToken`\s+varchar\(64\)\s+NULL/i);
    expect(ddl).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
  });
});
