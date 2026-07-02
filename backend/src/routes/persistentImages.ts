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

    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Length", String(image.size));
    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(image.buffer);
  } catch (error) {
    return next(error);
  }
});
