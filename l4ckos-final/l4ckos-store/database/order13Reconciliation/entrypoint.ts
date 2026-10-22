import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
// Verified in-memory loader supplies these non-writable properties. No env flags.
export async function artifactHash() {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "__order13ArtifactHash"
  );
  if (descriptor?.writable === false && /^[a-f0-9]{64}$/.test(descriptor.value))
    return descriptor.value as string;
  return createHash("sha256")
    .update(await readFile(process.argv[1]))
    .digest("hex");
}
export async function inputText() {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "__order13Input"
  );
  if (descriptor?.writable === false && typeof descriptor.value === "string")
    return descriptor.value;
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 128 * 1024) throw Error("INPUT_LIMIT");
  }
  return input;
}
