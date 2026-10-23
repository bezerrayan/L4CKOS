import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAGIC = Buffer.from("L4CKOSBK", "ascii");
export const FORMAT_VERSION = 2;
export const ALGORITHM_ID = 1; // AES-256-GCM, direct 32-byte Bitwarden key.
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
const MAX_CONTEXT_BYTES = 64 * 1024;

export type BackupContext = {
  sourceProjectId: string;
  sourceEnvironmentId: string;
  sourceMysqlServiceId: string;
  sourceSchema: string;
  createdAt: string;
  sourceFingerprint: string;
  inventory: { tables: number; views: number; triggers: number; routines: number; events: number; nonInnoDbTables: number };
  mysqlVersion: string;
};

function keyFromHex(hex: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(hex)) throw new Error("BACKUP_KEY_MUST_BE_32_BYTE_HEX");
  return Buffer.from(hex, "hex");
}
function aad(nonce: Buffer, contextBytes: Buffer) {
  const fixed = Buffer.alloc(8 + 1 + 1 + NONCE_BYTES + 4);
  MAGIC.copy(fixed, 0); fixed[8] = FORMAT_VERSION; fixed[9] = ALGORITHM_ID;
  nonce.copy(fixed, 10); fixed.writeUInt32BE(contextBytes.length, 22);
  return Buffer.concat([fixed, contextBytes]);
}
export function createEnvelopeHeader(context: BackupContext, keyHex: string) {
  const key = keyFromHex(keyHex);
  try {
    const contextBytes = Buffer.from(JSON.stringify(context), "utf8");
    if (contextBytes.length > MAX_CONTEXT_BYTES) throw new Error("BACKUP_CONTEXT_TOO_LARGE");
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(nonce, contextBytes));
    return { header: aad(nonce, contextBytes), cipher, nonce, contextBytes };
  } finally { key.fill(0); }
}
export function parseEnvelopeHeader(file: Buffer) {
  const min = 8 + 1 + 1 + NONCE_BYTES + 4;
  if (file.length < min || !file.subarray(0, 8).equals(MAGIC) || file[8] !== FORMAT_VERSION || file[9] !== ALGORITHM_ID) throw new Error("BACKUP_FORMAT_INVALID");
  const contextLength = file.readUInt32BE(22);
  if (contextLength > MAX_CONTEXT_BYTES || file.length < min + contextLength + TAG_BYTES) throw new Error("BACKUP_HEADER_INVALID");
  const nonce = file.subarray(10, 22);
  const aadBytes = file.subarray(0, min + contextLength);
  let context: BackupContext;
  try { context = JSON.parse(file.subarray(min, min + contextLength).toString("utf8")); }
  catch { throw new Error("BACKUP_CONTEXT_INVALID"); }
  return { context, nonce: Buffer.from(nonce), aad: Buffer.from(aadBytes), ciphertextOffset: min + contextLength, tag: Buffer.from(file.subarray(-TAG_BYTES)) };
}
export function createDecryptor(keyHex: string, nonce: Buffer, aadBytes: Buffer, tag: Buffer) {
  const key = keyFromHex(keyHex);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadBytes); decipher.setAuthTag(tag);
    return decipher;
  } finally { key.fill(0); }
}

export async function hashFile(path: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), new Transform({ transform(chunk, _enc, cb) { hash.update(chunk); cb(); } }), new Transform({ transform(_chunk, _enc, cb) { cb(); } }));
  return hash.digest("hex");
}

/** Encrypts the source stream directly into a private temporary ciphertext file. */
export async function encryptStream(source: Readable, destination: string, context: BackupContext, keyHex: string) {
  const temp = `${destination}.partial`;
  const { header, cipher } = createEnvelopeHeader(context, keyHex);
  const hash = createHash("sha256");
  const sink = createWriteStream(temp, { flags: "wx", mode: 0o600 });
  try {
    hash.update(header); sink.write(header);
    const hashing = new Transform({ transform(chunk, _enc, cb) { hash.update(chunk); cb(null, chunk); } });
    await pipeline(source, cipher, hashing, sink);
    const tag = cipher.getAuthTag();
    const handle = await open(temp, "a", 0o600);
    try { await handle.write(tag); await handle.sync(); } finally { await handle.close(); }
    hash.update(tag);
    await rename(temp, destination);
    return { sha256: hash.digest("hex"), nonce: header.subarray(10, 22).toString("hex"), tag: tag.toString("hex") };
  } catch (error) {
    sink.destroy(); await unlink(temp).catch(() => {}); throw error;
  }
}

/** Authenticates a complete first pass before any plaintext is sent to a restore process. */
export async function authenticateEnvelope(path: string, keyHex: string) {
  const handle = await open(path, "r");
  const fixedLength = 8 + 1 + 1 + NONCE_BYTES + 4;
  const fixed = Buffer.alloc(fixedLength);
  try {
    const got = await handle.read(fixed, 0, fixed.length, 0);
    if (got.bytesRead !== fixed.length) throw new Error("BACKUP_HEADER_INVALID");
    const contextLength = fixed.readUInt32BE(22);
    if (contextLength > MAX_CONTEXT_BYTES) throw new Error("BACKUP_HEADER_INVALID");
    const contextBytes = Buffer.alloc(contextLength);
    const contextRead = await handle.read(contextBytes, 0, contextLength, fixedLength);
    if (contextRead.bytesRead !== contextLength) throw new Error("BACKUP_HEADER_INVALID");
    const stat = await handle.stat();
    if (!fixed.subarray(0, 8).equals(MAGIC) || fixed[8] !== FORMAT_VERSION || fixed[9] !== ALGORITHM_ID || stat.size < fixedLength + contextLength + TAG_BYTES) throw new Error("BACKUP_FORMAT_INVALID");
    const tag = Buffer.alloc(TAG_BYTES);
    const tagRead = await handle.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
    if (tagRead.bytesRead !== TAG_BYTES) throw new Error("BACKUP_HEADER_INVALID");
    let context: BackupContext;
    try { context = JSON.parse(contextBytes.toString("utf8")); } catch { throw new Error("BACKUP_CONTEXT_INVALID"); }
    const aadBytes = Buffer.concat([fixed, contextBytes]);
    const parsed = { context, nonce: Buffer.from(fixed.subarray(10, 22)), aad: aadBytes, ciphertextOffset: fixedLength + contextLength, tag };
    const decipher = createDecryptor(keyHex, parsed.nonce, parsed.aad, parsed.tag);
    const plaintextHash = createHash("sha256");
    try {
      const discard = new Transform({ transform(chunk, _enc, cb) { plaintextHash.update(chunk); cb(); } });
      await pipeline(createReadStream(path, { start: parsed.ciphertextOffset, end: stat.size - TAG_BYTES - 1 }), decipher, discard);
    } catch (error) { throw new Error("BACKUP_AUTHENTICATION_FAILED", { cause: error }); }
    return { ...parsed, plaintextSha256: plaintextHash.digest("hex") };
  } finally { await handle.close(); }
}

export async function decryptAuthenticatedStream(path: string, keyHex: string, destination: NodeJS.WritableStream) {
  const parsed = await authenticateEnvelope(path, keyHex);
  const stat = await (await import("node:fs/promises")).stat(path);
  const decipher = createDecryptor(keyHex, parsed.nonce, parsed.aad, parsed.tag);
  await pipeline(createReadStream(path, { start: parsed.ciphertextOffset, end: stat.size - TAG_BYTES - 1 }), decipher, destination as any);
}
