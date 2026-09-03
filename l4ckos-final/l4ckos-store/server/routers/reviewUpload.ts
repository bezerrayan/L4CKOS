import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import sharp from "sharp";
import { buildApiErrorResponse } from "../_core/appErrors";
import { type AuthenticatedRequest, requireAuthenticatedUser } from "../_core/httpAuth";
import { getOperationalConfig, isOperationalWriteBlocked } from "../_core/operationalConfig";
import { securityLog } from "../_core/security";
import { getReviewEligibility, registerProductReviewUpload } from "../db";
import { storagePut } from "../storage";

const router = Router();
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const MAX_SIDE = 1600;
const allowed = new Map([["image/jpeg", new Set([".jpg", ".jpeg"])], ["image/png", new Set([".png"])], ["image/webp", new Set([".webp"])] ]);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 1 }, fileFilter: (_req, file, done) => {
  const extensions = allowed.get(file.mimetype);
  if (!extensions?.has(path.extname(file.originalname || "").toLowerCase())) return done(new Error("INVALID_REVIEW_IMAGE"));
  done(null, true);
} });

function fail(res: Response, status: number, code: string, message: string) {
  res.status(status).json(buildApiErrorResponse({ status, code, message }));
}

export function hasAllowedReviewImageSignature(buffer: Buffer, mime: string) {
  if (mime === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return mime === "image/webp" && buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

export async function normalizeReviewImage(buffer: Buffer) {
  const source = sharp(buffer, { failOn: "error", animated: false, limitInputPixels: MAX_PIXELS });
  const meta = await source.metadata();
  if (!meta.width || !meta.height || (meta.pages && meta.pages > 1)) throw new Error("INVALID_REVIEW_IMAGE");
  return sharp(buffer, { failOn: "error", animated: false, limitInputPixels: MAX_PIXELS })
    .rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84, effort: 4 }).toBuffer();
}

function localStorageAllowed() {
  const config = getOperationalConfig();
  return config.environment === "staging" && config.storageMode === "local" && String(process.env.ALLOW_EPHEMERAL_STAGING_STORAGE).toLowerCase() === "true";
}

function absoluteUrl(req: Request, relative: string) {
  const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim();
  return host ? `${protocol}://${host}${relative}` : relative;
}

async function store(req: Request, buffer: Buffer) {
  const name = `${randomUUID()}.webp`;
  const mode = getOperationalConfig().storageMode;
  if (mode === "disabled") throw Object.assign(new Error("STORAGE_DISABLED"), { code: "STORAGE_DISABLED" });
  if (mode === "local") {
    if (!localStorageAllowed()) throw Object.assign(new Error("STORAGE_DISABLED"), { code: "STORAGE_DISABLED" });
    const dir = path.resolve(process.cwd(), "uploads", "reviews");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), buffer, { flag: "wx" });
    return absoluteUrl(req, `/uploads/reviews/${name}`);
  }
  try { return (await storagePut(`review-uploads/${name}`, buffer, "image/webp")).url; }
  catch { throw Object.assign(new Error("STORAGE_UNAVAILABLE"), { code: "STORAGE_UNAVAILABLE" }); }
}

router.post("/", requireAuthenticatedUser, (req: Request, res: Response) => {
  const auth = req as AuthenticatedRequest;
  const user = auth.authUser;
  if (!user) return fail(res, 401, "AUTH_REQUIRED", "Faça login para continuar.");
  if (isOperationalWriteBlocked()) return fail(res, 503, "MAINTENANCE_MODE", "Uploads estão bloqueados durante a manutenção.");
  upload.single("file")(req, res, async error => {
    if (error) return fail(res, 400, "INVALID_REVIEW_IMAGE", "Envie uma imagem JPG, PNG ou WEBP de até 3 MB.");
    const productId = Number(req.body?.productId);
    if (!req.file || !Number.isInteger(productId) || productId <= 0 || Object.keys(req.body || {}).some(key => key !== "productId")) return fail(res, 400, "INVALID_REVIEW_IMAGE", "Envie uma imagem e um produto válidos.");
    const extension = path.extname(req.file.originalname || "").toLowerCase();
    if (!allowed.get(req.file.mimetype)?.has(extension) || !hasAllowedReviewImageSignature(req.file.buffer, req.file.mimetype)) return fail(res, 400, "INVALID_REVIEW_IMAGE", "A imagem não é válida.");
    try {
      const eligible = await getReviewEligibility(user.id, productId);
      if (!eligible.some(row => row.eligible)) return fail(res, 403, "REVIEW_NOT_ELIGIBLE", "Esta compra ainda não pode ser avaliada.");
      const processed = await normalizeReviewImage(req.file.buffer);
      const imageUrl = await store(req, processed);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await registerProductReviewUpload({ token, userId: user.id, productId, imageUrl, expiresAt });
      securityLog("info", "review_image.uploaded", { userId: user.id, productId, requestIp: req.ip || "unknown" });
      res.status(201).json({ token, previewUrl: imageUrl, expiresAt });
    } catch (cause: any) {
      const code = cause?.code === "STORAGE_DISABLED" ? "STORAGE_DISABLED" : cause?.code === "STORAGE_UNAVAILABLE" ? "STORAGE_UNAVAILABLE" : "INVALID_REVIEW_IMAGE";
      const status = code.startsWith("STORAGE_") ? 503 : 400;
      securityLog("warn", "review_image.rejected", { userId: user.id, productId, requestIp: req.ip || "unknown", code });
      fail(res, status, code, code.startsWith("STORAGE_") ? "O storage de imagens está indisponível." : "Não foi possível validar essa imagem.");
    }
  });
});

export default router;
