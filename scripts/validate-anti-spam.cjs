const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const files = {
  apiClient: read("bot/src/services/apiClient.ts"),
  eventHandler: read("bot/src/handlers/eventHandler.ts"),
  imageBot: read("bot/src/services/imageAntiSpamService.ts"),
  linkBot: read("bot/src/services/linkAntiSpamService.ts"),
  messageCreate: read("bot/src/events/messageCreate.ts"),
  messageUpdate: read("bot/src/events/messageUpdate.ts"),
  mongo: read("backend/src/database/mongo.ts"),
  route: read("backend/src/routes/imageAntiSpam.ts"),
  selfBot: read("bot/src/services/selfBotProtectionService.ts"),
  service: read("backend/src/services/imageAntiSpamService.ts"),
  panel: read("frontend/src/components/moderation/ImageAntiSpamPanel.tsx")
};

const checks = [
  ["Eventos Discord", files.messageCreate, ["handleImageAntiSpamMessage", "handleSelfBotProtectionMessage", "handleLinkAntiSpamMessage"]],
  ["MessageUpdate para embeds", files.eventHandler + files.messageUpdate, ["Events.MessageUpdate", "handleImageAntiSpamMessage", "isBotModuleEnabled(\"image-anti-spam\")"]],
  ["Deteccao de imagens/GIFs/stickers/embeds/anexos", files.imageBot, ["message.stickers.size", "message.embeds", "gifCount", "attachmentCount", "deleteMediaSpamMessages"]],
  ["Exclusao em lote", files.imageBot, ["MediaMessageRef", "removedMessageCount", "removedMediaCount", "messageIds"]],
  ["Anti-spam texto geral", files.selfBot, ["anti-flood", "anti-texto-repetido", "anti-copypasta", "anti-mencoes", "anti-emojis", "anti-flood-multi-canais"]],
  ["Anti-spam de links", files.linkBot + files.messageCreate, ["handleLinkAntiSpamMessage", "message.delete", "moderation.link_anti_spam"]],
  ["Punicoes", files.selfBot + files.imageBot, ["timeout", "kick", "ban", "delete_message", "warnMember", "applyPunishment"]],
  ["Logs e auditoria", files.route + files.selfBot, ["createLog", "logs:new", "sendLog", "punishmentSucceeded", "removedMessages"]],
  ["Persistencia Mongo", files.mongo + files.service, ["image_anti_spam_settings", "image_anti_spam_incidents", "channelIds", "mediaTypes", "messageIds"]],
  ["Dashboard realtime", files.panel + files.route, ["image-anti-spam:settings_updated", "image-anti-spam:incident", "Canal de logs e punicoes"]],
  ["Cache e sincronizacao bot", files.imageBot + files.apiClient, ["settingsCache.delete", "onImageAntiSpamSettingsUpdated", "getImageAntiSpamSettings"]]
];

const failures = [];

for (const [name, content, required] of checks) {
  const missing = required.filter((needle) => !content.includes(needle));

  if (missing.length) {
    failures.push({ name, missing });
  } else {
    console.log(`[ok] ${name}`);
  }
}

if (failures.length) {
  console.error("\nAnti-Spam validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure.name}: faltando ${failure.missing.join(", ")}`);
  }
  process.exit(1);
}

console.log("\nAnti-Spam validation passed.");
