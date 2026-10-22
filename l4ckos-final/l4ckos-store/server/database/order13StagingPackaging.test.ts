import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { verifiedLoader } from "../../database/order13Reconciliation/packaging";
const sample = Buffer.from(
  "console.log(JSON.stringify({args:process.argv.slice(2),input:globalThis.__order13Input,hash:globalThis.__order13ArtifactHash}))"
);
it("fixes reader mode despite execution env and safely transports arbitrary approval text", () => {
  const input = "$(touch /tmp/forbidden) `text` '\"\nnew line";
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      ["-e", verifiedLoader(sample, ["dry-run"], input)],
      {
        encoding: "utf8",
        env: { ...process.env, ORDER13_MODE: "execute", COMMIT: "true" },
      }
    )
  );
  expect(result.args).toEqual(["dry-run"]);
  expect(result.input).toBe(input);
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
});
it("refuses changed artifact bytes before executing code", () => {
  expect(() =>
    execFileSync(
      process.execPath,
      ["-e", verifiedLoader(sample, ["dry-run"], "", "f".repeat(64))],
      { stdio: "pipe" }
    )
  ).toThrow();
});
it("cannot prepare a commit loader by using an unknown or ambiguous mode", () => {
  for (const args of [
    ["execute"],
    ["dry-run", "--execute"],
    ["--commit-order13-once"],
    ["--commit-order13-once", "invalid"],
  ])
    expect(() => verifiedLoader(sample, args)).toThrow();
});
it("commit loader requires the separate authorization at invocation time", () => {
  const h = "a".repeat(64),
    loader = verifiedLoader(sample, ["--commit-order13-once", h], "synthetic");
  for (const args of [
    [],
    ["--authorize-order13-at-runtime", "b".repeat(64)],
    ["--authorize-order13-at-runtime", h, "extra"],
  ]) {
    try {
      execFileSync(process.execPath, ["--input-type=commonjs", "-", ...args], {
        input: loader,
        stdio: ["pipe", "pipe", "pipe"],
      });
      throw Error("MUST_BLOCK");
    } catch (e) {
      expect((e as any).status).toBe(64);
    }
  }
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      ["--input-type=commonjs", "-", "--authorize-order13-at-runtime", h],
      { input: loader, encoding: "utf8" }
    )
  );
  expect(result.args).toEqual(["--commit-order13-once", h]);
});
