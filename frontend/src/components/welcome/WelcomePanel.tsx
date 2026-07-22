import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Hash,
  ImageIcon,
  Link2,
  Loader2,
  MessageSquareText,
  Plus,
  RotateCcw,
  Save,
  Send,
  Smile,
  Trash2,
  Upload
} from "lucide-react";
import {
  API_URL,
  getGuildLiveOptions,
  getSystemEmojiDashboard,
  patchGuildSettings,
  testLeavePanel,
  testWelcomePanel,
  uploadLeaveImage,
  uploadWelcomeImage
} from "../../lib/api";
import type { DashboardGuild, GuildChannelOption, GuildSettings, MemberPanelSection, SystemEmojiConfig } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type MemberPanelMode = "welcome" | "leave";

type WelcomePanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading?: boolean;
  mode?: MemberPanelMode;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
  viewerName: string;
};

const DEFAULT_WELCOME_TITLE = "Bem-vindo à NextTech";
const DEFAULT_WELCOME_SUBTITLE = "A comunidade está pronta para receber você.";
const DEFAULT_WELCOME_MESSAGE = [
  "{user}, seja bem-vindo(a) à comunidade NextTech.",
  "Explore os canais, participe das conversas e fique à vontade para acompanhar os avisos, novidades e espaços de interação."
].join("\n");
const DEFAULT_WELCOME_RULES_TITLE = "Regras e verificação";
const DEFAULT_WELCOME_RULES = [
  "Leia as regras para entender como a comunidade funciona.",
  "Conclua a verificação caso ela esteja disponível.",
  "Use cada canal para o assunto correto e mantenha uma convivência respeitosa."
].join("\n");
const DEFAULT_WELCOME_CHANNEL_LABEL = "Comece por";
const DEFAULT_WELCOME_FOOTER_TEXT = "NextTech - Comunidade";
const DEFAULT_LEAVE_TITLE = "Até breve";
const DEFAULT_LEAVE_SUBTITLE = "Obrigado por ter caminhado com a NextTech.";
const DEFAULT_LEAVE_MESSAGE = [
  "{user}, obrigado por ter feito parte da NextTech.",
  "Sua participação foi respeitada e as portas continuarão abertas caso decida retornar."
].join("\n");
const DEFAULT_LEAVE_RULES_TITLE = "Despedida";
const DEFAULT_LEAVE_RULES = [
  "Agradecemos pelo tempo dedicado à comunidade.",
  "Desejamos sucesso na sua jornada.",
  "Quando quiser voltar, a NextTech estará de portas abertas."
].join("\n");
const DEFAULT_LEAVE_CHANNEL_LABEL = "Comunidade";
const DEFAULT_LEAVE_FOOTER_TEXT = "NextTech - As portas seguem abertas";
const DEFAULT_WELCOME_SECTIONS: MemberPanelSection[] = [
  { description: "{user}, sua entrada foi registrada com sucesso. A partir de agora você faz parte de uma comunidade organizada, acolhedora e preparada para receber você.", emoji: ":aniversario:", enabled: true, id: "boas-vindas", order: 1, title: "Chegada confirmada" },
  { description: "Conheça os canais, acompanhe os avisos e participe dos espaços que combinam com o que você procura dentro da NextTech.", emoji: ":discord:", enabled: true, id: "comunidade", order: 2, title: "Explore a comunidade" },
  { description: "Antes de interagir, leia as regras e conclua a verificação quando ela estiver disponível. Isso mantém o servidor seguro, claro e bem organizado.", emoji: ":folha:", enabled: true, id: "regras", order: 3, title: "Regras e verificação" },
  { description: "Se precisar de orientação, a equipe está disponível para ajudar com dúvidas, acesso aos canais e primeiros passos na comunidade.", emoji: ":interrogacao:", enabled: true, id: "suporte", order: 4, title: "Equipe disponível" }
];
const DEFAULT_LEAVE_SECTIONS: MemberPanelSection[] = [
  { description: "{user}, obrigado por ter dedicado parte do seu tempo à NextTech. Sua presença fez parte da história da comunidade.", emoji: ":prancheta_acertos:", enabled: true, id: "agradecimento", order: 1, title: "Obrigado pela participação" },
  { description: "Respeitamos sua decisão e desejamos que a sua próxima etapa seja produtiva, leve e cheia de boas oportunidades.", emoji: ":trofeu_alt:", enabled: true, id: "jornada", order: 2, title: "Sucesso na jornada" },
  { description: "Caso queira retornar no futuro, a NextTech continuará de portas abertas para receber você novamente.", emoji: ":porta:", enabled: true, id: "retorno", order: 3, title: "Portas abertas" },
  { description: "Fica o nosso agradecimento final e uma despedida sincera, elegante e respeitosa em nome de toda a comunidade.", emoji: ":visto:", enabled: true, id: "despedida", order: 4, title: "Até breve" }
];

const panelConfig = {
  welcome: {
    channelKey: "welcomeChannelId",
    colorKey: "welcomeColor",
    description: "Mensagem automática quando alguém entra.",
    displayChannelKey: "welcomeDisplayChannelId",
    enabledKey: "welcomeEnabled",
    footerTextKey: "welcomeFooterText",
    imageKey: "welcomeImageUrl",
    channelLabelKey: "welcomeChannelLabel",
    loadingText: "Carregando entrada...",
    messageKey: "welcomeMessage",
    rulesKey: "welcomeRules",
    rulesTitleKey: "welcomeRulesTitle",
    sectionsKey: "welcomeSections",
    embedTitleKey: "welcomeTitle",
    subtitleKey: "welcomeSubtitle",
    defaultChannelLabel: DEFAULT_WELCOME_CHANNEL_LABEL,
    defaultFooterText: DEFAULT_WELCOME_FOOTER_TEXT,
    defaultMessage: DEFAULT_WELCOME_MESSAGE,
    defaultRules: DEFAULT_WELCOME_RULES,
    defaultRulesTitle: DEFAULT_WELCOME_RULES_TITLE,
    defaultSections: DEFAULT_WELCOME_SECTIONS,
    defaultSubtitle: DEFAULT_WELCOME_SUBTITLE,
    defaultTitle: DEFAULT_WELCOME_TITLE,
    missingGuildText: "Selecione um servidor para configurar entrada.",
    missingSettingsText: "Não foi possível carregar as configurações de entrada.",
    savedImageText: "Banner de entrada atualizado.",
    savedMessageText: "Mensagem de entrada salva.",
    testButtonText: "Testar entrada",
    testSentText: "Entrada enviada para teste.",
    title: "Entrada",
    toggleLabel: "Entrada"
  },
  leave: {
    channelKey: "leaveChannelId",
    colorKey: "leaveColor",
    description: "Mensagem automática quando alguém sai.",
    displayChannelKey: "leaveDisplayChannelId",
    enabledKey: "leaveEnabled",
    footerTextKey: "leaveFooterText",
    imageKey: "leaveImageUrl",
    channelLabelKey: "leaveChannelLabel",
    loadingText: "Carregando saída...",
    messageKey: "leaveMessage",
    rulesKey: "leaveRules",
    rulesTitleKey: "leaveRulesTitle",
    sectionsKey: "leaveSections",
    embedTitleKey: "leaveTitle",
    subtitleKey: "leaveSubtitle",
    defaultChannelLabel: DEFAULT_LEAVE_CHANNEL_LABEL,
    defaultFooterText: DEFAULT_LEAVE_FOOTER_TEXT,
    defaultMessage: DEFAULT_LEAVE_MESSAGE,
    defaultRules: DEFAULT_LEAVE_RULES,
    defaultRulesTitle: DEFAULT_LEAVE_RULES_TITLE,
    defaultSections: DEFAULT_LEAVE_SECTIONS,
    defaultSubtitle: DEFAULT_LEAVE_SUBTITLE,
    defaultTitle: DEFAULT_LEAVE_TITLE,
    missingGuildText: "Selecione um servidor para configurar saída.",
    missingSettingsText: "Não foi possível carregar as configurações de saída.",
    savedImageText: "Banner de saída atualizado.",
    savedMessageText: "Mensagem de saída salva.",
    testButtonText: "Testar saída",
    testSentText: "Saída enviada para teste.",
    title: "Saída",
    toggleLabel: "Saída"
  }
} satisfies Record<
  MemberPanelMode,
  {
    channelKey: "welcomeChannelId" | "leaveChannelId";
    colorKey: "welcomeColor" | "leaveColor";
    description: string;
    displayChannelKey: "welcomeDisplayChannelId" | "leaveDisplayChannelId";
    enabledKey: "welcomeEnabled" | "leaveEnabled";
    footerTextKey: "welcomeFooterText" | "leaveFooterText";
    imageKey: "welcomeImageUrl" | "leaveImageUrl";
    channelLabelKey: "welcomeChannelLabel" | "leaveChannelLabel";
    loadingText: string;
    messageKey: "welcomeMessage" | "leaveMessage";
    rulesKey: "welcomeRules" | "leaveRules";
    rulesTitleKey: "welcomeRulesTitle" | "leaveRulesTitle";
    sectionsKey: "welcomeSections" | "leaveSections";
    embedTitleKey: "welcomeTitle" | "leaveTitle";
    subtitleKey: "welcomeSubtitle" | "leaveSubtitle";
    defaultChannelLabel: string;
    defaultFooterText: string;
    defaultMessage: string;
    defaultRules: string;
    defaultRulesTitle: string;
    defaultSections: MemberPanelSection[];
    defaultSubtitle: string;
    defaultTitle: string;
    missingGuildText: string;
    missingSettingsText: string;
    savedImageText: string;
    savedMessageText: string;
    testButtonText: string;
    testSentText: string;
    title: string;
    toggleLabel: string;
  }
>;

export function WelcomePanel({
  botId,
  canManage,
  guild,
  loading = false,
  mode = "welcome",
  onSettingsChange,
  settings,
  viewerName
}: WelcomePanelProps) {
  const config = panelConfig[mode];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [channelLabelInput, setChannelLabelInput] = useState("");
  const [colorInput, setColorInput] = useState("#f5c542");
  const [footerInput, setFooterInput] = useState("");
  const [imageInput, setImageInput] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [rulesInput, setRulesInput] = useState("");
  const [rulesTitleInput, setRulesTitleInput] = useState("");
  const [sectionsInput, setSectionsInput] = useState<MemberPanelSection[]>([]);
  const [subtitleInput, setSubtitleInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [emojiOptions, setEmojiOptions] = useState<SystemEmojiConfig[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const imageUrl = useMemo(
    () => {
      const value = settings?.[config.imageKey]?.trim();
      return value ? resolveAssetUrl(value) : "";
    },
    [config.imageKey, settings]
  );
  const enabled = Boolean(settings?.[config.enabledKey]);
  const channelId = settings?.[config.channelKey] ?? null;
  const displayChannelId = settings?.[config.displayChannelKey] ?? null;
  const destinationChannel = channels.find((channel) => channel.id === channelId) ?? null;
  const displayChannel = channels.find((channel) => channel.id === (displayChannelId ?? channelId)) ?? destinationChannel;

  useEffect(() => {
    if (!guild || !canManage) {
      setChannels([]);
      setEmojiOptions([]);
      return;
    }

    setLoadingChannels(true);
    getGuildLiveOptions(guild.id, botId)
      .then((options) => setChannels(options.channels))
      .catch(() => setChannels([]))
      .finally(() => setLoadingChannels(false));

    getSystemEmojiDashboard(botId, guild.id)
      .then((dashboard) => setEmojiOptions(dashboard.emojis.filter((emoji) => emoji.enabled !== false)))
      .catch(() => setEmojiOptions([]));
  }, [botId, canManage, guild]);

  useEffect(() => {
    const currentImageUrl = settings?.[config.imageKey] ?? "";
    setImageInput(/^https?:\/\//i.test(currentImageUrl) ? currentImageUrl : "");
  }, [config.imageKey, settings]);

  useEffect(() => {
    setTitleInput(settings?.[config.embedTitleKey]?.trim() ?? "");
    setSubtitleInput(settings?.[config.subtitleKey]?.trim() ?? "");
    setMessageInput(settings?.[config.messageKey]?.trim() ?? "");
    setRulesTitleInput(settings?.[config.rulesTitleKey]?.trim() ?? "");
    setRulesInput(settings?.[config.rulesKey]?.trim() ?? "");
    setSectionsInput(normalizeSectionsForEditor(settings?.[config.sectionsKey], config.defaultSections));
    setChannelLabelInput(settings?.[config.channelLabelKey]?.trim() ?? "");
    setFooterInput(settings?.[config.footerTextKey]?.trim() ?? "");
    setColorInput(settings?.[config.colorKey]?.trim() || "#f5c542");
  }, [config.channelLabelKey, config.colorKey, config.defaultSections, config.embedTitleKey, config.footerTextKey, config.messageKey, config.rulesKey, config.rulesTitleKey, config.sectionsKey, config.subtitleKey, settings]);

  async function savePatch(payload: Partial<GuildSettings>, key: string, successText = "Alteração salva.") {
    if (!guild || !settings || !canManage) {
      return false;
    }

    setSaving(key);
    setStatus(null);
    setError(null);

    try {
      const nextSettings = await patchGuildSettings(guild.id, payload, botId);
      onSettingsChange(nextSettings);
      setStatus(successText);
      return true;
    } catch (requestError) {
      setError(readErrorMessage(requestError));
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function handleChannelChange(nextChannelId: string) {
    const payload: Partial<GuildSettings> = {
      [config.channelKey]: nextChannelId || null
    } as Partial<GuildSettings>;

    if (!settings?.[config.displayChannelKey]) {
      Object.assign(payload, {
        [config.displayChannelKey]: nextChannelId || null
      });
    }

    await savePatch(
      payload,
      "channel",
      "Canal de envio salvo."
    );
  }

  async function handleDisplayChannelChange(nextChannelId: string) {
    await savePatch(
      {
        [config.displayChannelKey]: nextChannelId || null
      } as Partial<GuildSettings>,
      "displayChannel",
      nextChannelId ? "Canal do botão salvo." : "Canal do botão usando o canal de envio."
    );
  }

  async function handleMessageSave() {
    await savePatch(
      {
        [config.embedTitleKey]: titleInput.trim(),
        [config.subtitleKey]: subtitleInput.trim(),
        [config.messageKey]: messageInput.trim(),
        [config.rulesTitleKey]: rulesTitleInput.trim(),
        [config.rulesKey]: rulesInput.trim(),
        [config.sectionsKey]: prepareSectionsForSave(sectionsInput, config.defaultSections),
        [config.channelLabelKey]: channelLabelInput.trim(),
        [config.footerTextKey]: footerInput.trim(),
        [config.colorKey]: colorInput
      } as Partial<GuildSettings>,
      "message",
      config.savedMessageText
    );
  }

  function handleMessageReset() {
    setTitleInput(config.defaultTitle);
    setSubtitleInput(config.defaultSubtitle);
    setMessageInput(config.defaultMessage);
    setRulesTitleInput(config.defaultRulesTitle);
    setRulesInput(config.defaultRules);
    setSectionsInput(config.defaultSections.map((section) => ({ ...section })));
    setChannelLabelInput(config.defaultChannelLabel);
    setFooterInput(config.defaultFooterText);
    setColorInput("#f5c542");
  }

  function updateSection(index: number, patch: Partial<MemberPanelSection>) {
    setSectionsInput((current) => current.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section));
  }

  function moveSection(index: number, direction: -1 | 1) {
    setSectionsInput((current) => {
      const next = [...current];
      const targetIndex = index + direction;

      if (targetIndex < 0 || targetIndex >= next.length) {
        return current;
      }

      const currentSection = next[index];
      const targetSection = next[targetIndex];

      if (!currentSection || !targetSection) {
        return current;
      }

      next[index] = targetSection;
      next[targetIndex] = currentSection;
      return next.map((section, sectionIndex) => ({ ...section, order: sectionIndex + 1 }));
    });
  }

  function addSection() {
    setSectionsInput((current) => [
      ...current,
      {
        description: "Descreva este bloco de forma objetiva e acolhedora.",
        emoji: ":prancheta:",
        enabled: true,
        id: `secao-${Date.now()}`,
        order: current.length + 1,
        title: "Nova seção"
      }
    ].slice(0, 8));
  }

  function removeSection(index: number) {
    setSectionsInput((current) => current.filter((_, sectionIndex) => sectionIndex !== index).map((section, sectionIndex) => ({ ...section, order: sectionIndex + 1 })));
  }

  async function handleImageFile(file: File | undefined) {
    if (!file || !guild || !canManage) {
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setStatus(null);
      setError("A imagem precisa ter até 10 MB.");
      return;
    }

    setSaving("image");
    setStatus(null);
    setError(null);

    try {
      const uploadImage = mode === "welcome" ? uploadWelcomeImage : uploadLeaveImage;
      const nextSettings = await uploadImage(guild.id, file, botId);
      onSettingsChange(nextSettings);
      setStatus(config.savedImageText);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleImageUrlSubmit() {
    const nextImageUrl = imageInput.trim();

    if (!nextImageUrl) {
      setStatus(null);
      setError("Cole um link de imagem ou envie um arquivo.");
      return;
    }

    if (!/^https?:\/\//i.test(nextImageUrl)) {
      setStatus(null);
      setError("Use um link com http:// ou https://.");
      return;
    }

    await savePatch({ [config.imageKey]: nextImageUrl } as Partial<GuildSettings>, "imageUrl", config.savedImageText);
  }

  async function handleImageRemove() {
    setImageInput("");
    await savePatch({ [config.imageKey]: null } as Partial<GuildSettings>, "imageUrl", "Imagem removida.");
  }

  async function handleTest() {
    if (!guild || !channelId || !canManage) {
      return;
    }

    setSaving("test");
    setStatus(null);
    setError(null);

    try {
      const testPanel = mode === "welcome" ? testWelcomePanel : testLeavePanel;

      await testPanel(guild.id, botId);
      setStatus(config.testSentText);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(null);
    }
  }

  if (!guild) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-zinc-500">{config.missingGuildText}</CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-5 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {config.loadingText}
        </CardContent>
      </Card>
    );
  }

  if (!settings) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-zinc-500">{config.missingSettingsText}</CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden hover:translate-y-0">
      <CardHeader className="border-b border-zinc-900 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black text-zinc-200">
              <MessageSquareText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle>{config.title}</CardTitle>
              <CardDescription>{config.description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className="text-xs font-medium uppercase text-zinc-500">{enabled ? "Ativo" : "Inativo"}</span>
            <Switch
              checked={enabled}
              disabled={!canManage || saving === "enabled"}
              onCheckedChange={(checked) => {
                void savePatch({ [config.enabledKey]: checked } as Partial<GuildSettings>, "enabled");
              }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <Hash className="h-4 w-4 text-zinc-400" />
                Canal que recebe a mensagem
              </span>
              <select
                className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600 disabled:opacity-50"
                disabled={!canManage || loadingChannels || saving === "channel"}
                onChange={(event) => void handleChannelChange(event.target.value)}
                value={channelId ?? ""}
              >
                <option value="">{loadingChannels ? "Carregando canais..." : "Selecione um canal"}</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2">
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <Link2 className="h-4 w-4 text-zinc-400" />
                Canal que aparece no botão
              </span>
              <select
                className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600 disabled:opacity-50"
                disabled={!canManage || loadingChannels || saving === "displayChannel"}
                onChange={(event) => void handleDisplayChannelChange(event.target.value)}
                value={displayChannelId ?? ""}
              >
                <option value="">{channelId ? "Usar canal de envio" : "Selecione o canal de envio"}</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <MessageSquareText className="h-4 w-4 text-zinc-400" />
                Titulo
              </span>
              <input
                className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
                disabled={!canManage || saving === "message"}
                maxLength={120}
                onChange={(event) => setTitleInput(event.target.value)}
                placeholder={config.defaultTitle}
                value={titleInput}
              />
            </label>
            <label className="block space-y-2">
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <ImageIcon className="h-4 w-4 text-zinc-400" />
                Cor da lateral
              </span>
              <input
                className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600 disabled:opacity-50"
                disabled={!canManage || saving === "message"}
                onChange={(event) => setColorInput(event.target.value)}
                type="color"
                value={colorInput}
              />
            </label>
          </div>

          <label className="block space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <MessageSquareText className="h-4 w-4 text-zinc-400" />
              Subtitulo
            </span>
            <input
              className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
              disabled={!canManage || saving === "message"}
              maxLength={180}
              onChange={(event) => setSubtitleInput(event.target.value)}
              placeholder={config.defaultSubtitle}
              value={subtitleInput}
            />
          </label>

          <label className="block space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <MessageSquareText className="h-4 w-4 text-zinc-400" />
              Descrição
            </span>
            <textarea
              className="min-h-36 w-full resize-y rounded-lg border border-zinc-800 bg-black px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
              disabled={!canManage || saving === "message"}
              maxLength={1000}
              onChange={(event) => setMessageInput(event.target.value)}
              placeholder="Mensagem com {user}"
              value={messageInput}
            />
          </label>

          <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <Smile className="h-4 w-4 text-zinc-400" />
                Seções do painel
              </span>
              <Button disabled={!canManage || saving === "message" || sectionsInput.length >= 8} onClick={addSection} type="button" variant="outline">
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-3">
              {sectionsInput.map((section, index) => (
                <div className="rounded-lg border border-zinc-800 bg-black p-3" key={section.id}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Switch
                        checked={section.enabled}
                        disabled={!canManage || saving === "message"}
                        onCheckedChange={(checked) => updateSection(index, { enabled: checked })}
                      />
                      <span className="truncate text-sm font-medium text-zinc-100">Bloco {index + 1}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button aria-label="Mover para cima" disabled={!canManage || index === 0 || saving === "message"} onClick={() => moveSection(index, -1)} size="icon" type="button" variant="ghost">
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button aria-label="Mover para baixo" disabled={!canManage || index === sectionsInput.length - 1 || saving === "message"} onClick={() => moveSection(index, 1)} size="icon" type="button" variant="ghost">
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button aria-label="Remover seção" disabled={!canManage || sectionsInput.length <= 1 || saving === "message"} onClick={() => removeSection(index)} size="icon" type="button" variant="ghost">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
                    <label className="block space-y-2">
                      <span className="text-xs font-medium uppercase text-zinc-500">Emoji personalizado</span>
                      <select
                        className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600 disabled:opacity-50"
                        disabled={!canManage || saving === "message"}
                        onChange={(event) => updateSection(index, { emoji: event.target.value || null })}
                        value={section.emoji ?? ""}
                      >
                        <option value="">Sem emoji</option>
                        {section.emoji && !emojiOptions.some((emoji) => emojiValue(emoji) === section.emoji) ? (
                          <option value={section.emoji}>{emojiPreviewLabel(section.emoji)}</option>
                        ) : null}
                        {emojiOptions.map((emoji) => {
                          const value = emojiValue(emoji);
                          return (
                            <option key={emoji.key} value={value}>
                              {emoji.label}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label className="block space-y-2">
                      <span className="text-xs font-medium uppercase text-zinc-500">Titulo</span>
                      <input
                        className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
                        disabled={!canManage || saving === "message"}
                        maxLength={120}
                        onChange={(event) => updateSection(index, { title: event.target.value })}
                        value={section.title}
                      />
                    </label>
                  </div>

                  <label className="mt-3 block space-y-2">
                    <span className="text-xs font-medium uppercase text-zinc-500">Descrição</span>
                    <textarea
                      className="min-h-24 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
                      disabled={!canManage || saving === "message"}
                      maxLength={900}
                      onChange={(event) => updateSection(index, { description: event.target.value })}
                      value={section.description}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-zinc-100">Titulo das dicas/regras</span>
              <input
                className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
                disabled={!canManage || saving === "message"}
                maxLength={120}
                onChange={(event) => setRulesTitleInput(event.target.value)}
                placeholder={config.defaultRulesTitle}
                value={rulesTitleInput}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-zinc-100">Texto do canal/botão</span>
              <input
                className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
                disabled={!canManage || saving === "message"}
                maxLength={120}
                onChange={(event) => setChannelLabelInput(event.target.value)}
                placeholder={config.defaultChannelLabel}
                value={channelLabelInput}
              />
            </label>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-100">Dicas/regras</span>
            <textarea
              className="min-h-32 w-full resize-y rounded-lg border border-zinc-800 bg-black px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
              disabled={!canManage || saving === "message"}
              maxLength={1500}
              onChange={(event) => setRulesInput(event.target.value)}
              placeholder={config.defaultRules}
              value={rulesInput}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-100">Rodapé</span>
            <input
              className="h-11 w-full rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
              disabled={!canManage || saving === "message"}
              maxLength={180}
              onChange={(event) => setFooterInput(event.target.value)}
              placeholder={config.defaultFooterText}
              value={footerInput}
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button disabled={!canManage || saving === "message"} onClick={() => void handleMessageSave()} type="button">
              {saving === "message" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </Button>
            <Button disabled={!canManage || saving === "message"} onClick={handleMessageReset} type="button" variant="outline">
              <RotateCcw className="h-4 w-4" />
              Padrão
            </Button>
            <Button disabled={!canManage || !channelId || saving === "test"} onClick={handleTest} type="button" variant="outline">
              {saving === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {config.testButtonText}
            </Button>
          </div>

          <div className="space-y-3 border-t border-zinc-900 pt-5">
            <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <ImageIcon className="h-4 w-4 text-zinc-400" />
              Banner
              {imageUrl ? <ImageTypeBadge imageUrl={imageUrl} /> : null}
            </span>
            <div className="flex flex-col gap-3 lg:flex-row">
              <input
                className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600 disabled:opacity-50"
                disabled={!canManage || saving === "imageUrl"}
                onChange={(event) => setImageInput(event.target.value)}
                placeholder="https://site.com/banner.gif"
                value={imageInput}
              />
              <Button disabled={!canManage || saving === "imageUrl"} onClick={() => void handleImageUrlSubmit()} type="button" variant="outline">
                <Link2 className="h-4 w-4" />
                Link
              </Button>
              <Button disabled={!canManage || saving === "image"} onClick={() => fileInputRef.current?.click()} type="button" variant="outline">
                {saving === "image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Enviar
              </Button>
              <Button disabled={!canManage || !settings?.[config.imageKey] || saving === "imageUrl"} onClick={() => void handleImageRemove()} type="button" variant="outline">
                Remover
              </Button>
            </div>
            <input
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
              className="hidden"
              onChange={(event) => void handleImageFile(event.target.files?.[0])}
              ref={fileInputRef}
              type="file"
            />
            <p className="text-xs text-zinc-500">PNG • JPG • JPEG • WEBP • GIF</p>
          </div>

          {status ? (
            <p className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
              <CheckCircle2 className="h-4 w-4 text-zinc-400" />
              {status}
            </p>
          ) : null}
          {error ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">{error}</p> : null}
        </div>

        <SimplePanelPreview
          channelLabel={channelLabelInput.trim()}
          channelName={displayChannel?.name ?? "canal"}
          color={colorInput}
          footerText={footerInput.trim()}
          imageUrl={imageUrl}
          message={messageInput.trim()}
          rules={rulesInput.trim()}
          rulesTitle={rulesTitleInput.trim()}
          sections={sectionsInput}
          subtitle={subtitleInput.trim()}
          title={titleInput.trim()}
          viewerName={viewerName}
        />
      </CardContent>
    </Card>
  );
}

function SimplePanelPreview({
  channelLabel,
  channelName,
  color,
  footerText,
  imageUrl,
  message,
  rules,
  rulesTitle,
  sections,
  subtitle,
  title,
  viewerName
}: {
  channelLabel: string;
  channelName: string;
  color: string;
  footerText: string;
  imageUrl: string;
  message: string;
  rules: string;
  rulesTitle: string;
  sections: MemberPanelSection[];
  subtitle: string;
  title: string;
  viewerName: string;
}) {
  const ruleItems = formatRuleItems(rules);
  const enabledSections = sections.filter((section) => section.enabled !== false && section.title.trim() && section.description.trim());

  return (
    <aside className="space-y-2 rounded-lg border border-zinc-800 bg-[#313338] p-3">
      <div className="overflow-hidden rounded border-l-4 bg-[#2b2d31]" style={{ borderLeftColor: color }}>
        {imageUrl ? <img alt="" className="mx-auto aspect-[16/9] w-full border-b border-zinc-700/60 object-cover" src={imageUrl} /> : null}
        <div className="space-y-5 p-4">
          {title ? <p className="break-words text-lg font-semibold leading-7 text-white">{title}</p> : null}
          {subtitle ? <p className="break-words text-sm font-semibold leading-6 text-zinc-100">{subtitle}</p> : null}
          {message ? <PanelMessage className="whitespace-pre-line break-words text-sm leading-6 text-zinc-100" message={message} viewerName={viewerName} /> : null}

          {enabledSections.length ? (
            <div className="space-y-4">
              {enabledSections.map((section, index) => (
                <div className="space-y-2 border-t border-zinc-700/60 pt-4" key={section.id}>
                  <p className="break-words text-sm font-semibold text-white">
                    {emojiPreviewLabel(section.emoji)}{section.title}
                  </p>
                  <PanelMessage className="whitespace-pre-line break-words text-sm leading-6 text-zinc-200" message={section.description} viewerName={viewerName} />
                  {index === enabledSections.length - 1 ? null : <div className="h-px bg-zinc-700/40" />}
                </div>
              ))}
            </div>
          ) : rulesTitle || ruleItems.length ? (
            <div className="space-y-2">
              {rulesTitle ? <p className="text-sm font-semibold text-white">{rulesTitle}</p> : null}
              <ol className="space-y-1 text-sm leading-6 text-zinc-200">
                {ruleItems.map((rule, index) => (
                  <li className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-2" key={`${rule}-${index}`}>
                    <span className="font-semibold text-zinc-100">{index + 1}.</span>
                    <span className="break-words">{rule}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {channelLabel ? (
            <div className="flex items-center gap-2 rounded border border-zinc-700/70 bg-[#232428] px-3 py-2 text-sm text-zinc-200">
              <span className="min-w-0 truncate">
                {channelLabel} <span className="font-medium text-zinc-100">#{channelName}</span>
              </span>
            </div>
          ) : null}
        </div>
        {footerText ? <footer className="border-t border-zinc-700/60 px-4 py-3 text-xs text-zinc-400">{footerText}</footer> : null}
      </div>
    </aside>
  );
}

function ImageTypeBadge({ imageUrl }: { imageUrl: string }) {
  const extension = imageUrl.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)?.[1]?.toLowerCase() ?? "";
  const isGif = extension === "gif";
  return (
    <span className="rounded-md border border-zinc-800 bg-black px-2 py-1 text-xs text-zinc-300">
      {isGif ? "GIF animado" : (extension ? extension.toUpperCase() : "Imagem")}
    </span>
  );
}

function normalizeSectionsForEditor(value: MemberPanelSection[] | null | undefined, fallback: MemberPanelSection[]) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return source
    .map((section, index) => ({
      description: section.description ?? "",
      emoji: section.emoji ?? null,
      enabled: section.enabled !== false,
      id: section.id || `secao-${index + 1}`,
      order: section.order || index + 1,
      title: section.title ?? ""
    }))
    .sort((left, right) => left.order - right.order)
    .map((section, index) => ({ ...section, order: index + 1 }));
}

function prepareSectionsForSave(value: MemberPanelSection[], fallback: MemberPanelSection[]) {
  const sections = value
    .map((section, index) => ({
      ...section,
      description: section.description.trim(),
      id: section.id || `secao-${index + 1}`,
      order: index + 1,
      title: section.title.trim()
    }))
    .filter((section) => section.title && section.description)
    .slice(0, 8);

  return sections.length ? sections : fallback.map((section, index) => ({ ...section, order: index + 1 }));
}

function emojiValue(emoji: SystemEmojiConfig) {
  if (/^<a?:[a-zA-Z0-9_]{2,32}:\d{5,32}>$/.test(emoji.preview)) {
    return emoji.preview;
  }

  return emoji.name || `:${emoji.key}:`;
}

function emojiPreviewLabel(value: string | null) {
  if (!value) return "";
  const custom = value.match(/^<a?:([a-zA-Z0-9_]{2,32}):\d{5,32}>$/);
  const alias = value.match(/^:([a-zA-Z0-9_]{2,64}):$/);
  return `${custom?.[1] ?? alias?.[1] ?? value} `;
}

function PanelMessage({ className, message, viewerName }: { className?: string; message: string; viewerName: string }) {
  return (
    <p className={className ?? "whitespace-pre-line"}>
      {message.split(/(\{user\})/gi).map((part, index) => (
        part.toLowerCase() === "{user}"
          ? (
              <span className="rounded bg-white/10 px-1 text-zinc-100" key={`${part}-${index}`}>
                @{viewerName}
              </span>
            )
          : part
      ))}
    </p>
  );
}

function formatRuleItems(rules: string) {
  return rules
    .split(/\r?\n/)
    .map((rule) => rule.replace(/^\s*(?:\d+[.)-]\s*|\*\*\d+[.)-]?\*\*\s*)/, "").trim())
    .filter(Boolean);
}

function resolveAssetUrl(value: string) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const apiOrigin = new URL(API_URL, window.location.origin).origin;
  return `${apiOrigin}${value.startsWith("/") ? value : `/${value}`}`;
}

function readErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Não foi possível concluir a ação.";
  }

  return "Não foi possível concluir a ação.";
}
