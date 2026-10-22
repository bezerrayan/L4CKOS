import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  privateDecrypt,
  constants,
  createHash,
} from "node:crypto";
import { digest } from "./operator";
const aad = (v: any) =>
  JSON.stringify({
    version: v.version,
    operation: v.operation,
    stateHash: v.stateHash,
  });
/** Scoped snapshot encrypted before transport/output; public key only on staging. */
export function sealBackup(snapshot: unknown, publicKeyPem: string) {
  const s = snapshot as { stateHash: string };
  if (!/^[a-f0-9]{64}$/.test(s.stateHash))
    throw Error("BACKUP_SNAPSHOT_REQUIRED");
  const key = randomBytes(32),
    iv = randomBytes(12);
  const head = {
    version: 1,
    operation: "order13-scoped-backup",
    stateHash: s.stateHash,
  };
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad(head)));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(snapshot)),
    cipher.final(),
  ]);
  const packet = {
    ...head,
    wrappedKey: publicEncrypt(
      {
        key: publicKeyPem,
        oaepHash: "sha256",
        padding: constants.RSA_PKCS1_OAEP_PADDING,
      },
      key
    ).toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  key.fill(0);
  return { ...packet, envelopeHash: digest(packet) };
}
export function openBackup(
  packet: ReturnType<typeof sealBackup>,
  privateKeyPem: string
) {
  const { envelopeHash, ...body } = packet;
  if (digest(body) !== envelopeHash) throw Error("BACKUP_HASH_MISMATCH");
  const key = privateDecrypt(
    {
      key: privateKeyPem,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(packet.wrappedKey, "base64")
  );
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(packet.iv, "base64")
    );
    decipher.setAAD(Buffer.from(aad(packet)));
    decipher.setAuthTag(Buffer.from(packet.tag, "base64"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(packet.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8")
    );
  } finally {
    key.fill(0);
  }
}
export const archiveSha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
