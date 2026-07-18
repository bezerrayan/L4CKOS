import { Request, Router } from "express";
import multer from "multer";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { storagePut } from "../storage";
import { AuthenticatedRequest, requireAdminUser } from "../_core/httpAuth";
import { buildApiErrorResponse } from "../_core/appErrors";
import { securityLog } from "../_core/security";

const router = Router();
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"]);
const PRODUCT_IMAGE_BACKGROUND = { r: 8, g: 8, b: 8, alpha: 1 };
const PRODUCT_IMAGE_VARIANTS = {
  thumbnail: { width: 800, height: 1000, suffix: "thumb" },
  detail: { width: 1200, height: 1500, suffix: "detail" },
  banner: { width: 1600, height: 900, suffix: "banner" },
} as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const mimeAllowed = ALLOWED_MIME_TYPES.has(file.mimetype);
    const extensionAllowed = ALLOWED_EXTENSIONS.has(extension);

    if (!mimeAllowed || !extensionAllowed) {
      callback(new Error("Tipo de arquivo não permitido"));
      return;
    }

    callback(null, true);
  },
});

function sanitizeExtension(fileName: string) {
  const extension = path.extname(fileName || "").toLowerCase();
  return ALLOWED_EXTENSIONS.has(extension) ? extension : ".bin";
}

export async function buildProductImageVariants(buffer: Buffer) {
  const entries = await Promise.all(
    Object.entries(PRODUCT_IMAGE_VARIANTS).map(async ([key, config]) => {
      const output = await sharp(buffer, { animated: false })
        .rotate()
        .resize({
          width: config.width,
          height: config.height,
          fit: "contain",
          position: "center",
          background: PRODUCT_IMAGE_BACKGROUND,
        })
        .webp({ quality: 88, effort: 4 })
        .toBuffer();

      return [key, output] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<keyof typeof PRODUCT_IMAGE_VARIANTS, Buffer>;
}

async function saveLocally(filename: string, buffer: Buffer) {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, filename);
  await writeFile(filePath, buffer, { flag: "wx" });
  return `/uploads/${filename}`;
}

function buildAbsoluteUploadUrl(req: Request, relativePath: string) {
  const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim();

  if (!host) return relativePath;
  return `${protocol}://${host}${relativePath}`;
}

router.post("/", requireAdminUser, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.authUser;
    if (!user) {
      res.status(401).json(buildApiErrorResponse({
        status: 401,
        code: "AUTH_REQUIRED",
        message: "Faça login para continuar.",
      }));
      return;
    }

    upload.single("file")(req, res, async uploadError => {
      if (uploadError) {
        securityLog("warn", "upload.rejected", {
          userId: user.id,
          requestIp: req.ip || "unknown",
          reason: uploadError.message,
        });
        res.status(400).json(buildApiErrorResponse({
          status: 400,
          code: "INVALID_UPLOAD",
          message: uploadError.message || "Upload inválido.",
        }));
        return;
      }

      try {
        if (!req.file) {
          res.status(400).json(buildApiErrorResponse({
            status: 400,
            code: "FILE_REQUIRED",
            message: "Selecione um arquivo para enviar.",
          }));
          return;
        }

        const { originalname, buffer, mimetype, size } = req.file;
        if (!ALLOWED_MIME_TYPES.has(mimetype)) {
          res.status(400).json(buildApiErrorResponse({
            status: 400,
            code: "INVALID_FILE_TYPE",
            message: "Tipo de arquivo não permitido.",
          }));
          return;
        }

        if (size > MAX_UPLOAD_SIZE_BYTES) {
          res.status(400).json(buildApiErrorResponse({
            status: 400,
            code: "FILE_TOO_LARGE",
            message: "O arquivo excede o tamanho máximo permitido.",
          }));
          return;
        }

        const id = randomUUID();
        const filename = `${id}${sanitizeExtension(originalname)}`;

        let variantBuffers: Record<keyof typeof PRODUCT_IMAGE_VARIANTS, Buffer>;
        try {
          variantBuffers = await buildProductImageVariants(buffer);
        } catch (processingError) {
          securityLog("warn", "upload.image_processing_failed", {
            userId: user.id,
            requestIp: req.ip || "unknown",
            reason: processingError instanceof Error ? processingError.message : "unknown",
          });
          variantBuffers = {
            thumbnail: buffer,
            detail: buffer,
            banner: buffer,
          };
        }

        const variantFiles = {
          thumbnail: `${id}-${PRODUCT_IMAGE_VARIANTS.thumbnail.suffix}.webp`,
          detail: `${id}-${PRODUCT_IMAGE_VARIANTS.detail.suffix}.webp`,
          banner: `${id}-${PRODUCT_IMAGE_VARIANTS.banner.suffix}.webp`,
        } as const;

        try {
          const [{ url: originalUrl }, { url: thumbnailUrl }, { url: detailUrl }, { url: bannerUrl }] = await Promise.all([
            storagePut(`uploads/${filename}`, buffer, mimetype),
            storagePut(`uploads/${variantFiles.thumbnail}`, variantBuffers.thumbnail, "image/webp"),
            storagePut(`uploads/${variantFiles.detail}`, variantBuffers.detail, "image/webp"),
            storagePut(`uploads/${variantFiles.banner}`, variantBuffers.banner, "image/webp"),
          ]);
          securityLog("info", "upload.saved_remote", { userId: user.id, requestIp: req.ip || "unknown", fileName: filename });
          let responseUrls = {
            originalUrl,
            thumbnailUrl,
            detailUrl,
            bannerUrl,
            storage: "remote" as const,
          };

          try {
            const [localOriginalPath, localThumbnailPath, localDetailPath, localBannerPath] = await Promise.all([
              saveLocally(filename, buffer),
              saveLocally(variantFiles.thumbnail, variantBuffers.thumbnail),
              saveLocally(variantFiles.detail, variantBuffers.detail),
              saveLocally(variantFiles.banner, variantBuffers.banner),
            ]);
            responseUrls = {
              originalUrl: buildAbsoluteUploadUrl(req, localOriginalPath),
              thumbnailUrl: buildAbsoluteUploadUrl(req, localThumbnailPath),
              detailUrl: buildAbsoluteUploadUrl(req, localDetailPath),
              bannerUrl: buildAbsoluteUploadUrl(req, localBannerPath),
              storage: "remote" as const,
            };
          } catch (localMirrorError) {
            securityLog("warn", "upload.local_mirror_unavailable", {
              userId: user.id,
              requestIp: req.ip || "unknown",
              reason: localMirrorError instanceof Error ? localMirrorError.message : "unknown",
            });
          }

          res.json({
            success: true,
            url: responseUrls.detailUrl,
            originalUrl: responseUrls.originalUrl,
            thumbnailUrl: responseUrls.thumbnailUrl,
            detailUrl: responseUrls.detailUrl,
            bannerUrl: responseUrls.bannerUrl,
            filename,
            storage: responseUrls.storage,
          });
          return;
        } catch (storageError) {
          securityLog("warn", "upload.remote_storage_unavailable", {
            userId: user.id,
            requestIp: req.ip || "unknown",
            reason: storageError instanceof Error ? storageError.message : "unknown",
          });
          const [originalPath, thumbnailPath, detailPath, bannerPath] = await Promise.all([
            saveLocally(filename, buffer),
            saveLocally(variantFiles.thumbnail, variantBuffers.thumbnail),
            saveLocally(variantFiles.detail, variantBuffers.detail),
            saveLocally(variantFiles.banner, variantBuffers.banner),
          ]);
          const originalUrl = buildAbsoluteUploadUrl(req, originalPath);
          const thumbnailUrl = buildAbsoluteUploadUrl(req, thumbnailPath);
          const detailUrl = buildAbsoluteUploadUrl(req, detailPath);
          const bannerUrl = buildAbsoluteUploadUrl(req, bannerPath);
          res.json({
            success: true,
            url: detailUrl,
            originalUrl,
            thumbnailUrl,
            detailUrl,
            bannerUrl,
            filename,
            storage: "local",
          });
        }
      } catch (error) {
        securityLog("error", "upload.failed", {
          userId: user.id,
          requestIp: req.ip || "unknown",
          reason: error instanceof Error ? error.message : "unknown",
        });
        res.status(500).json(buildApiErrorResponse({
          status: 500,
          code: "UPLOAD_FAILED",
          message: "Não foi possível enviar o arquivo.",
        }));
      }
    });
  } catch {
    res.status(401).json(buildApiErrorResponse({
      status: 401,
      code: "AUTH_REQUIRED",
      message: "Faça login para continuar.",
    }));
  }
});

export default router;
