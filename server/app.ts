import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import sharp from "sharp";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { catalog, validateAppearance } from "./catalog.js";
import { buildDecisionInput, createProvider, DecisionServiceError, type DecisionProvider } from "./decision.js";
import { renderSkin } from "./skin.js";

export function createApp(provider: DecisionProvider = createProvider()) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use("/api", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  app.use(express.json({ limit: "16kb" }));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
  });
  app.get("/api/catalog", (_req, res) => res.json({
    categories: catalog,
    mode: provider.mode,
  }));
  app.post("/api/generate", upload.single("image"), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Choose a PNG, JPEG, or WebP photograph." });
      return;
    }
    let image: Buffer;
    try {
      const source = sharp(req.file.buffer, { limitInputPixels: 24_000_000, animated: false });
      const metadata = await source.metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) {
        throw new Error("Unsupported image");
      }
      image = await source.rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    } catch {
      res.status(400).json({ error: "This image could not be read. Use a single-frame PNG, JPEG, or WebP up to 10 MB and 24 megapixels." });
      return;
    }
    let result;
    try {
      result = await provider.decide(buildDecisionInput(image));
      validateAppearance(result.appearance);
    } catch (error) {
      console.error("Decision provider failed:", error instanceof Error ? error.message : "Unknown error");
      res.status(error instanceof DecisionServiceError ? error.status : 502).json({
        error: error instanceof DecisionServiceError ? error.message : "The model returned an invalid response or is unavailable. No skin was generated. Please try again.",
      });
      return;
    }
    const png = await renderSkin(result.appearance);
    res.json({ ...result, skin: `data:image/png;base64,${png.toString("base64")}` });
  });
  app.post("/api/skin", async (req, res) => {
    let appearance;
    try { appearance = validateAppearance(req.body?.appearance); }
    catch {
      res.status(400).json({ error: "Choose one valid option for every appearance category." });
      return;
    }
    const png = await renderSkin(appearance);
    res.type("png").setHeader("Content-Disposition", 'attachment; filename="block-and-you-skin.png"');
    res.send(png);
  });
  app.use("/api", (_req, res) => { res.status(404).json({ error: "API route not found." }); });
  const dist = resolve("dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
  }
  const errors: express.ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "The image must be smaller than 10 MB." : "Upload exactly one image file." });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "Invalid JSON request." });
      return;
    }
    console.error("Request failed:", error instanceof Error ? error.message : "Unknown error");
    res.status(500).json({ error: "The request failed. Please try again." });
  };
  app.use(errors);
  return app;
}
