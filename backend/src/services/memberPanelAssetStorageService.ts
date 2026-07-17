import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createLog } from "./logService";
import { detectSupportedImageMimeType } from "./persistentImageStorageService";

type MemberPanelAssetMode = "leave" | "welcome";

type StoredMemberPanelAsset = {
  hash: string;
  publicUrl: string;
};

const UPLOAD_ROOT = path.resolve(__dirname, "../../uploads/welcome");
const GUILDS_ROOT = path.join(UPLOAD_ROOT, "guilds");
const BACKUP_ROOT = path.join(UPLOAD_ROOT, "backup");
const CACHE_TTL_MS = 30_000;
const assetCache = new Map<string, { expiresAt: number; hash: string; publicUrl: string }>();
const assetLocks = new Map<string, Promise<unknown>>();

const MIME_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export async function saveMemberPanelAsset(input: {
  actorId?: string | null;
  botId?: string | null;
  buffer: Buffer;
  guildId: string;
  guildName?: string | null;
  mimeType: string;
  mode: MemberPanelAssetMode;
  previousUrl?: string | null;
}) {
  return withAssetLock(input.guildId, input.mode, async () => {
    const mimeType = detectSupportedImageMimeType(input.buffer, input.mimeType);

    const safeGuildId = safeId(input.guildId);
    const extension = MIME_EXTENSIONS[mimeType];
    const hash = sha256(input.buffer);
    const animated = mimeType === "image/gif" && isAnimatedGif(input.buffer);
    const fileName = `${input.mode}_${hash.slice(0, 16)}_${Date.now()}_${randomUUID()}.${extension}`;
    const guildDir = path.join(GUILDS_ROOT, safeGuildId);
    const targetPath = path.join(guildDir, fileName);
    const tmpPath = `${targetPath}.tmp`;

    await fs.mkdir(guildDir, { recursive: true });
    await backupPreviousAsset({
      guildId: input.guildId,
      mode: input.mode,
      url: input.previousUrl ?? null
    }).catch((error) => logAssetError({
      botId: input.botId ?? null,
      error,
      guildId: input.guildId,
      guildName: input.guildName ?? null,
      operation: "backup_previous",
      path: input.previousUrl ?? null
    }));

    await fs.writeFile(tmpPath, input.buffer);
    const written = await fs.readFile(tmpPath);
    const writtenHash = sha256(written);
    if (writtenHash !== hash) {
      await fs.rm(tmpPath, { force: true }).catch(() => null);
      throw Object.assign(new Error("Falha de integridade ao salvar imagem."), { statusCode: 500 });
    }

    await fs.rename(tmpPath, targetPath);
    await fs.writeFile(hashPath(targetPath), hash, "utf8");
    await fs.writeFile(metaPath(targetPath), JSON.stringify({
      createdAt: new Date().toISOString(),
      guildId: input.guildId,
      hash,
      animated,
      extension,
      mode: input.mode,
      mimeType,
      size: input.buffer.length
    }, null, 2), "utf8");

    await removeStaleActiveAssets(guildDir, input.mode, fileName).catch((error) => logAssetError({
      botId: input.botId ?? null,
      error,
      guildId: input.guildId,
      guildName: input.guildName ?? null,
      operation: "remove_stale",
      path: guildDir
    }));

    const publicUrl = `/uploads/welcome/guilds/${encodeURIComponent(safeGuildId)}/${encodeURIComponent(fileName)}`;
    cacheAsset(input.guildId, input.mode, { hash, publicUrl });

    if (input.botId) {
      await createLog({
        botId: input.botId,
        guildId: input.guildId,
        message: `Imagem de ${input.mode} salva em armazenamento isolado do servidor.`,
        metadata: {
          guildId: input.guildId,
          guildName: input.guildName ?? null,
          hash,
          animated,
          extension,
          mimeType,
          path: targetPath,
          publicUrl,
          size: input.buffer.length
        },
        type: "welcome_asset.saved",
        userId: input.actorId ?? null
      }).catch(() => null);
    }

    return publicUrl;
  });
}

export async function resolveMemberPanelAssetUrl(input: {
  botId?: string | null;
  guildId: string;
  guildName?: string | null;
  mode: MemberPanelAssetMode;
  url: string | null;
}) {
  const normalized = input.url?.trim() ?? "";
  if (!normalized || normalized.startsWith("/uploads/welcome/default.gif")) return null;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (!normalized.startsWith("/uploads/welcome/")) return null;

  return withAssetLock(input.guildId, input.mode, async () => {
    const cached = assetCache.get(cacheKey(input.guildId, input.mode));
    if (cached && cached.expiresAt > Date.now() && cached.publicUrl === normalized) {
      const cachedPath = resolveWelcomeUploadPath(cached.publicUrl);
      if (cachedPath && await verifyAssetFile(cachedPath)) {
        return cached.publicUrl;
      }
    }

    const filePath = resolveWelcomeUploadPath(normalized);
    if (filePath && await verifyAssetFile(filePath)) {
      const hash = await readExpectedHash(filePath) ?? sha256(await fs.readFile(filePath));
      cacheAsset(input.guildId, input.mode, { hash, publicUrl: normalized });
      return normalized;
    }

    await logAssetError({
      botId: input.botId ?? null,
      error: new Error(filePath ? "Imagem inexistente ou hash invalido." : "URL local fora do armazenamento permitido."),
      guildId: input.guildId,
      guildName: input.guildName ?? null,
      operation: "validate",
      path: filePath ?? normalized
    });

    const restored = await restoreLatestBackup(input.guildId, input.mode).catch((error) => {
      logAssetError({
        botId: input.botId ?? null,
        error,
        guildId: input.guildId,
        guildName: input.guildName ?? null,
        operation: "restore_backup",
        path: normalized
      });
      return null;
    });

    return restored?.publicUrl ?? null;
  });
}

export function invalidateMemberPanelAssetCache(guildId: string, mode?: MemberPanelAssetMode) {
  if (mode) {
    assetCache.delete(cacheKey(guildId, mode));
    return;
  }

  assetCache.delete(cacheKey(guildId, "welcome"));
  assetCache.delete(cacheKey(guildId, "leave"));
}

async function backupPreviousAsset(input: { guildId: string; mode: MemberPanelAssetMode; url: string | null }) {
  const filePath = input.url ? resolveWelcomeUploadPath(input.url) : null;
  if (!filePath || !await verifyAssetFile(filePath)) return;

  const safeGuildId = safeId(input.guildId);
  const backupDir = path.join(BACKUP_ROOT, safeGuildId);
  const extension = path.extname(filePath);
  const hash = await readExpectedHash(filePath) ?? sha256(await fs.readFile(filePath));
  const backupName = `${input.mode}_${new Date().toISOString().replace(/[:.]/g, "-")}_${hash.slice(0, 16)}${extension}`;
  const backupPath = path.join(backupDir, backupName);

  await fs.mkdir(backupDir, { recursive: true });
  await fs.copyFile(filePath, backupPath);
  await fs.writeFile(hashPath(backupPath), hash, "utf8");
}

async function restoreLatestBackup(guildId: string, mode: MemberPanelAssetMode): Promise<StoredMemberPanelAsset | null> {
  const safeGuildId = safeId(guildId);
  const backupDir = path.join(BACKUP_ROOT, safeGuildId);
  const entries = await fs.readdir(backupDir).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.startsWith(`${mode}_`) && /\.(gif|jpe?g|png|webp)$/i.test(entry))
    .sort()
    .reverse();

  for (const entry of candidates) {
    const backupPath = path.join(backupDir, entry);
    if (!await verifyAssetFile(backupPath)) continue;

    const buffer = await fs.readFile(backupPath);
    const hash = sha256(buffer);
    const guildDir = path.join(GUILDS_ROOT, safeGuildId);
    const extension = path.extname(entry);
    const activeName = `${mode}_${hash.slice(0, 16)}_restored_${Date.now()}${extension}`;
    const activePath = path.join(guildDir, activeName);

    await fs.mkdir(guildDir, { recursive: true });
    await fs.copyFile(backupPath, activePath);
    await fs.writeFile(hashPath(activePath), hash, "utf8");

    const publicUrl = `/uploads/welcome/guilds/${encodeURIComponent(safeGuildId)}/${encodeURIComponent(activeName)}`;
    cacheAsset(guildId, mode, { hash, publicUrl });
    return { hash, publicUrl };
  }

  return null;
}

async function removeStaleActiveAssets(guildDir: string, mode: MemberPanelAssetMode, keepFileName: string) {
  const entries = await fs.readdir(guildDir).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.startsWith(`${mode}_`) && entry !== keepFileName)
    .map(async (entry) => {
      const fullPath = path.join(guildDir, entry);
      await fs.rm(fullPath, { force: true });
      await fs.rm(hashPath(fullPath), { force: true });
      await fs.rm(metaPath(fullPath), { force: true });
    }));
}

async function verifyAssetFile(filePath: string) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) return false;

  const buffer = await fs.readFile(filePath);
  const expectedHash = await readExpectedHash(filePath);
  if (!expectedHash) {
    await fs.writeFile(hashPath(filePath), sha256(buffer), "utf8").catch(() => null);
    return true;
  }

  const actualHash = sha256(buffer);
  return actualHash === expectedHash;
}

async function readExpectedHash(filePath: string) {
  const value = await fs.readFile(hashPath(filePath), "utf8").catch(() => "");
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function resolveWelcomeUploadPath(localUrl: string) {
  const normalized = localUrl.trim();
  if (!normalized.startsWith("/uploads/welcome/")) return null;

  const withoutQuery = normalized.split(/[?#]/, 1)[0] ?? "";
  const relative = decodeURIComponent(withoutQuery.replace(/^\/uploads\/welcome\/+/, ""));
  const resolved = path.resolve(UPLOAD_ROOT, relative);
  const root = path.resolve(UPLOAD_ROOT);
  return resolved.startsWith(root + path.sep) || resolved === root ? resolved : null;
}

function cacheAsset(guildId: string, mode: MemberPanelAssetMode, asset: StoredMemberPanelAsset) {
  assetCache.set(cacheKey(guildId, mode), {
    expiresAt: Date.now() + CACHE_TTL_MS,
    hash: asset.hash,
    publicUrl: asset.publicUrl
  });
}

function cacheKey(guildId: string, mode: MemberPanelAssetMode) {
  return `${safeId(guildId)}:${mode}`;
}

function withAssetLock<T>(guildId: string, mode: MemberPanelAssetMode, task: () => Promise<T>) {
  const key = cacheKey(guildId, mode);
  const previous = assetLocks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  const tracked = current.finally(() => {
    if (assetLocks.get(key) === current) assetLocks.delete(key);
  });
  assetLocks.set(key, current);
  tracked.catch(() => null);
  return current;
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isAnimatedGif(buffer: Buffer) {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") return false;

  let frames = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0x2c) {
      frames += 1;
      if (frames > 1) return true;
    }
  }

  return false;
}

function hashPath(filePath: string) {
  return `${filePath}.sha256`;
}

function metaPath(filePath: string) {
  return `${filePath}.json`;
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "guild";
}

async function logAssetError(input: {
  botId?: string | null;
  error: unknown;
  guildId: string;
  guildName?: string | null;
  operation: string;
  path: string | null;
}) {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const stack = input.error instanceof Error ? input.error.stack : null;
  console.error("[welcome-assets]", {
    guildId: input.guildId,
    guildName: input.guildName ?? null,
    operation: input.operation,
    path: input.path,
    message,
    stack
  });

  if (!input.botId) return;
  await createLog({
    botId: input.botId,
    guildId: input.guildId,
    message: `Falha no asset de boas-vindas: ${input.operation}.`,
    metadata: {
      date: new Date().toISOString(),
      error: message,
      guildId: input.guildId,
      guildName: input.guildName ?? null,
      operation: input.operation,
      path: input.path,
      stack
    },
    type: "welcome_asset.error",
    userId: null
  }).catch(() => null);
}
