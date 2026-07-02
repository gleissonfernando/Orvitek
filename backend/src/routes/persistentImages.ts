import { Router } from "express";
import { z } from "zod";
import { getPersistentImage } from "../services/persistentImageStorageService";

const imageIdSchema = z.string().uuid();

export const persistentImagesRouter = Router();

persistentImagesRouter.get("/:imageId", async (req, res, next) => {
  try {
    const imageId = imageIdSchema.parse(req.params.imageId);
    const image = await getPersistentImage(imageId);

    if (!image) {
      return res.status(404).json({ message: "Imagem nao encontrada." });
    }

    const buffer = toImageBuffer(image.buffer);

    if (!buffer.length) {
      return res.status(404).json({ message: "Arquivo da imagem vazio ou invalido." });
    }

    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(buffer);
  } catch (error) {
    return next(error);
  }
});

function toImageBuffer(value: unknown) {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (value && typeof value === "object" && "buffer" in value) {
    const nested = (value as { buffer?: unknown }).buffer;

    if (Buffer.isBuffer(nested)) {
      return nested;
    }

    if (nested instanceof Uint8Array || Array.isArray(nested)) {
      return Buffer.from(nested);
    }
  }

  return Buffer.alloc(0);
}
