import { Router, type Response } from "express";
import multer from "multer";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { buildApiErrorResponse } from "../_core/appErrors";
import { type AuthenticatedRequest, requireAuthenticatedUser } from "../_core/httpAuth";
import { securityLog } from "../_core/security";
import { hasEligibleReviewPurchase, registerProductReviewUpload } from "../db";
import { storagePut } from "../storage";

const router = Router();
const MAX_REVIEW_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_REVIEW_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_REVIEW_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_REVIEW_IMAGE_BYTES, files: 1, fields: 2 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_REVIEW_IMAGE_MIMES.has(file.mimetype) || !ALLOWED_REVIEW_IMAGE_EXTENSIONS.has(extension)) {
      callback(new Error("Envie uma imagem JPG, PNG ou WEBP."));
      return;
    }
    callback(null, true);
  },
});

export function hasAllowedReviewImageSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/webp") {
    return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function sendUploadError(res: Response, status: number, code: string, message: string) {
  res.status(status).json(buildApiErrorResponse({ status, code, message }));
}

async function saveReviewImage(req: AuthenticatedRequest, buffer: Buffer) {
  const fileId = randomUUID();
  const filename = `${fileId}.webp`;

  try {
    const stored = await storagePut(`review-uploads/${filename}`, buffer, "image/webp");
    return stored.url;
  } catch (error) {
    securityLog("warn", "review_image.remote_storage_unavailable", {
      userId: req.authUser?.id,
      reason: error instanceof Error ? error.message : "unknown",
    });
    const directory = path.resolve(process.cwd(), "uploads", "reviews");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, filename), buffer, { flag: "wx" });
    const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim();
    return host ? `${protocol}://${host}/uploads/reviews/${filename}` : `/uploads/reviews/${filename}`;
  }
}

router.post("/", requireAuthenticatedUser, (req, res) => {
  upload.single("file")(req, res, async uploadError => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.authUser;
    if (!user) {
      sendUploadError(res, 401, "AUTH_REQUIRED", "Faça login para continuar.");
      return;
    }

    if (uploadError) {
      sendUploadError(res, 400, "INVALID_REVIEW_IMAGE", uploadError.message || "Imagem inválida.");
      return;
    }

    const productId = Number(req.body?.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      sendUploadError(res, 400, "INVALID_PRODUCT", "Produto inválido.");
      return;
    }
    if (!req.file) {
      sendUploadError(res, 400, "FILE_REQUIRED", "Selecione uma foto.");
      return;
    }
    if (!hasAllowedReviewImageSignature(req.file.buffer, req.file.mimetype)) {
      sendUploadError(res, 400, "INVALID_REVIEW_IMAGE", "O conteúdo do arquivo não corresponde a uma imagem permitida.");
      return;
    }

    try {
      const eligible = await hasEligibleReviewPurchase(user.id, productId);
      if (!eligible) {
        securityLog("warn", "review_image.ineligible_upload", {
          userId: user.id,
          productId,
          requestIp: req.ip || "unknown",
        });
        sendUploadError(res, 403, "REVIEW_NOT_ELIGIBLE", "Esta compra ainda não pode ser avaliada.");
        return;
      }

      // A decodificação pelo Sharp valida o conteúdo real, remove metadados e
      // converte tudo para WEBP, independentemente do nome enviado pelo cliente.
      const processed = await sharp(req.file.buffer, { failOn: "error", animated: false })
        .rotate()
        .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 84, effort: 4 })
        .toBuffer();

      const imageUrl = await saveReviewImage(authReq, processed);
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await registerProductReviewUpload({ token, userId: user.id, productId, imageUrl, expiresAt });

      res.status(201).json({ token, previewUrl: imageUrl, expiresAt });
    } catch (error) {
      securityLog("warn", "review_image.rejected", {
        userId: user.id,
        productId,
        requestIp: req.ip || "unknown",
        reason: error instanceof Error ? error.message : "unknown",
      });
      sendUploadError(res, 400, "INVALID_REVIEW_IMAGE", "Não foi possível validar essa imagem.");
    }
  });
});

export default router;
