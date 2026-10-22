import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const wrapper = readFileSync(
  "scripts/backup/order13-observer-runtime.sh",
  "utf8"
);
it("private stdin credential transport preserves loader and runtime arguments without printing secrets", () => {
  const result = execFileSync(
    "bash",
    [
      "-c",
      wrapper,
      "order13-observer",
      "--input-type=commonjs",
      "-",
      "--authorize-order13-at-runtime",
      "a".repeat(64),
    ],
    {
      timeout: 3000,
      input: Buffer.concat([
        Buffer.from("existing_admin\0synthetic-password\0"),
        Buffer.from(
          `if(process.env.ORDER13_OBSERVER_USER!=='existing_admin'||process.env.ORDER13_OBSERVER_PASSWORD!=='synthetic-password') process.exit(1); console.log(JSON.stringify(process.argv.slice(2)));`
        ),
      ]),
    }
  ).toString();
  expect(JSON.parse(result)).toEqual([
    "--authorize-order13-at-runtime",
    "a".repeat(64),
  ]);
  expect(result).not.toContain("synthetic-password");
});
it("missing administrative credentials fail closed before loading code", () => {
  expect(() =>
    execFileSync("bash", ["-c", wrapper, "order13-observer", "-"], {
      timeout: 3000,
      input: "partial-input",
      stdio: ["pipe", "pipe", "pipe"],
    })
  ).toThrow();
});
