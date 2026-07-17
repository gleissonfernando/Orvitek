import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Gift,
  Link2,
  Loader2,
  Pencil,
  Play,
  Radio,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Square,
  Trophy,
  Users
} from "lucide-react";
import {
  createGiveaway,
  endGiveaway,
  getGiveaways,
  getGuildLiveOptions,
  previewGiveawayLive,
  publishGiveawayPanel,
  startGiveaway,
  syncGiveawayParticipants,
  updateGiveaway
} from "../../lib/api";
import type { DashboardGuild, Giveaway, GiveawayLivePreview, GiveawayParticipantMode, GuildLiveOptions, SaveGiveawayPayload } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type GiveawayPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

type GiveawayForm = {
  allowRepeatWinners: boolean;
  customMessage: string;
  discordChannelId: string;
  endDelayMinutes: number;
  liveUrl: string;
  participantMode: GiveawayParticipantMode;
  prizeName: string;
  startDelayMinutes: number;
  title: string;
  winnerCount: number;
};

const emptyForm: GiveawayForm = {
  allowRepeatWinners: false,
  customMessage: "",
  discordChannelId: "",
  endDelayMinutes: 0,
  liveUrl: "",
  participantMode: "all",
  prizeName: "",
  startDelayMinutes: 0,
  title: "",
  winnerCount: 1
};

export function GiveawayPanel({ botId, canManage, guild }: GiveawayPanelProps) {
  const [giveaways, setGiveaways] = useState<Giveaway[]>([]);
  const [options, setOptions] = useState<GuildLiveOptions | null>(null);
  const [form, setForm] = useState<GiveawayForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [livePreview, setLivePreview] = useState<GiveawayLivePreview | null>(null);
  const [livePreviewError, setLivePreviewError] = useState<string | null>(null);
  const [livePreviewInput, setLivePreviewInput] = useState("");
  const [livePreviewLoading, setLivePreviewLoading] = useState(false);

  const editingGiveaway = useMemo(
    () => giveaways.find((giveaway) => giveaway.id === editingId) ?? null,
    [editingId, giveaways]
  );
  const normalizedLiveUrl = form.liveUrl.trim();
  const livePlatform = livePreviewInput === normalizedLiveUrl ? livePreview?.platform ?? null : detectPlatform(normalizedLiveUrl);
  const liveValidated = Boolean(livePreview && livePreviewInput === normalizedLiveUrl && !livePreviewError);
  const canSubmit = Boolean(
    canManage &&
    form.title.trim() &&
    form.prizeName.trim() &&
    form.discordChannelId &&
    normalizedLiveUrl &&
    liveValidated &&
    !saving
  );
  const panelStats = useMemo(() => {
    const running = giveaways.filter((giveaway) => giveaway.status === "running").length;
    const waiting = giveaways.filter((giveaway) => giveaway.status === "waiting").length;
    const participants = giveaways.reduce((total, giveaway) => total + giveaway.participants.length, 0);
    const winners = giveaways.reduce((total, giveaway) => total + giveaway.winners.length, 0);

    return {
      participants,
      running,
      total: giveaways.length,
      waiting,
      winners
    };
  }, [giveaways]);
  const selectedDiscordChannel = options?.channels.find((channel) => channel.id === form.discordChannelId)?.name ?? null;
  const messageTone = message && /não|erro|falha|inválid|aguarde/i.test(message) ? "danger" : "success";

  useEffect(() => {
    if (!guild) {
      setGiveaways([]);
      setOptions(null);
      setLoading(false);
      return;
    }

    let mounted = true;

    setLoading(true);
    setMessage(null);
    setGiveaways([]);
    setOptions(null);

    Promise.allSettled([
      getGiveaways(guild.id, botId),
      getGuildLiveOptions(guild.id, botId)
    ])
      .then(([giveawaysResult, optionsResult]) => {
        if (!mounted) return;

        const loadErrors: string[] = [];

        if (giveawaysResult.status === "fulfilled") {
          setGiveaways(giveawaysResult.value);

          if (canManage) {
            void syncGiveawayList(giveawaysResult.value);
          }
        } else {
          loadErrors.push(readRequestMessage(giveawaysResult.reason) ?? "Não foi possível carregar os sorteios.");
        }

        if (optionsResult.status === "fulfilled") {
          setOptions(optionsResult.value);
        } else {
          loadErrors.push(readRequestMessage(optionsResult.reason) ?? "Não foi possível carregar os canais do Discord.");
        }

        setMessage(loadErrors[0] ?? null);
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [botId, canManage, guild?.id]);

  useEffect(() => {
    if (!guild || !canManage) {
      return;
    }

    const interval = window.setInterval(() => {
      void syncGiveawayList(giveaways);
    }, 30 * 60 * 1000);

    return () => window.clearInterval(interval);
  }, [botId, canManage, giveaways, guild?.id]);

  function updateForm<K extends keyof GiveawayForm>(key: K, value: GiveawayForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));

    if (key === "liveUrl") {
      setLivePreview(null);
      setLivePreviewError(null);
      setLivePreviewInput("");
      setLivePreviewLoading(false);
    }
  }

  async function handleVerifyLiveChannel(value = form.liveUrl.trim(), options: { quiet?: boolean } = {}) {
    if (!guild || !canManage) {
      return;
    }

    const normalizedInput = value.trim();

    setMessage(null);
    setLivePreview(null);
    setLivePreviewInput("");
    setLivePreviewError(null);

    if (!normalizedInput) {
      setLivePreviewError("Informe a URL do canal Twitch ou Kick.");
      return;
    }

    const platform = detectPlatform(normalizedInput);

    if (platform === "youtube") {
      setLivePreviewError("YouTube ainda não está disponível para sorteios. Use uma URL da Twitch ou Kick.");
      return;
    }

    setLivePreviewLoading(true);

    try {
      const preview = await previewGiveawayLive(guild.id, normalizedInput, botId);

      setLivePreview(preview);
      setLivePreviewInput(normalizedInput);
      setForm((current) => {
        return {
          ...current,
          participantMode: defaultParticipantMode()
        };
      });

      if (!options.quiet) {
        setMessage(`Canal ${platformLabel(preview.platform)} verificado.`);
      }
    } catch (error) {
      setLivePreview(null);
      setLivePreviewError(readRequestMessage(error) ?? "Não foi possível verificar esse canal.");
    } finally {
      setLivePreviewLoading(false);
    }
  }

  async function handleSyncOptions() {
    if (!guild) return;

    setActionId("sync-options");
    setMessage(null);

    try {
      setOptions(await getGuildLiveOptions(guild.id, botId, true));
      setMessage("Canais do Discord sincronizados.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível sincronizar canais.");
    } finally {
      setActionId(null);
    }
  }

  async function syncGiveawayList(items: Giveaway[]) {
    if (!guild || !canManage) {
      return;
    }

    const activeGiveaways = items.filter((giveaway) => giveaway.status !== "ended");
    for (const giveaway of activeGiveaways) {
      const syncedRecently = giveaway.lastSyncedAt && Date.now() - new Date(giveaway.lastSyncedAt).getTime() < 29 * 60 * 1000;

      if (syncedRecently) {
        continue;
      }

      try {
        const updated = await syncGiveawayParticipants(guild.id, giveaway.id, botId);
        setGiveaways((current) => upsertGiveaway(current, updated));
      } catch (error) {
        const syncError = readRequestMessage(error) ?? "Não foi possível sincronizar participantes.";
        setGiveaways((current) => current.map((item) => (
          item.id === giveaway.id
            ? {
                ...item,
                lastSyncError: syncError
              }
            : item
        )));
      }
    }
  }

  async function handleSubmit() {
    if (!guild || !canManage) {
      return;
    }

    const missingMessage = validateFormForSubmit(form, liveValidated, livePreviewLoading);

    if (missingMessage) {
      setMessage(missingMessage);
      return;
    }

    const payload = toPayload(form);

    setSaving(true);
    setMessage(null);

    try {
      const saved = editingId
        ? await updateGiveaway(guild.id, editingId, payload, botId)
        : await createGiveaway(guild.id, payload, botId);

      setGiveaways((current) => upsertGiveaway(current, saved));
      setEditingId(saved.id);
      setMessage(saved.lastSyncError
        ? `${editingId ? "Sorteio atualizado" : "Sorteio criado"}, mas os participantes não foram sincronizados: ${saved.lastSyncError}`
        : `${editingId ? "Sorteio atualizado" : "Sorteio criado"} com ${saved.participants.length} participante(s) sincronizado(s).`);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível salvar o sorteio.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAction(giveaway: Giveaway, action: "panel" | "start" | "end" | "sync") {
    if (!guild || !canManage) {
      return;
    }

    setActionId(`${action}:${giveaway.id}`);
    setMessage(null);

    try {
      const updated = action === "panel"
        ? await publishGiveawayPanel(guild.id, giveaway.id, botId)
        : action === "start"
          ? await startGiveaway(guild.id, giveaway.id, botId)
          : action === "sync"
            ? await syncGiveawayParticipants(guild.id, giveaway.id, botId)
            : await endGiveaway(guild.id, giveaway.id, botId);

      setGiveaways((current) => upsertGiveaway(current, updated));
      setMessage(action === "panel" ? "Painel enviado para o Discord." : action === "start" ? "Sorteio iniciado." : action === "sync" ? "Participantes atualizados." : "Sorteio encerrado.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível executar essa ação.");
    } finally {
      setActionId(null);
    }
  }

  function handleEdit(giveaway: Giveaway) {
    setEditingId(giveaway.id);
    setLivePreview(null);
    setLivePreviewError(null);
    setLivePreviewInput("");
    setForm({
      allowRepeatWinners: giveaway.allowRepeatWinners,
      customMessage: giveaway.customMessage ?? "",
      discordChannelId: giveaway.discordChannelId ?? "",
      endDelayMinutes: giveaway.endDelayMinutes,
      liveUrl: giveaway.liveUrl,
      participantMode: giveaway.participantMode,
      prizeName: giveaway.prizeName,
      startDelayMinutes: giveaway.startDelayMinutes,
      title: giveaway.title,
      winnerCount: giveaway.winnerCount
    });
    void handleVerifyLiveChannel(giveaway.liveUrl, {
      quiet: true
    });
  }

  function handleNew() {
    setEditingId(null);
    setForm(emptyForm);
    setLivePreview(null);
    setLivePreviewError(null);
    setLivePreviewInput("");
    setMessage(null);
  }

  if (!guild) {
    return (
      <Card>
        <CardContent className="flex min-h-36 items-center justify-center p-6 text-sm text-zinc-500">
          Selecione um servidor para configurar sorteios.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-64 items-center justify-center p-6">
          <Loader2 className="h-7 w-7 animate-spin text-zinc-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-5">
      <Card className="overflow-hidden border-zinc-800 bg-zinc-950/85">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 text-[#FFEA70]">
                <Gift className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-bold tracking-normal text-white">Sorteios</h2>
                  <Badge variant={panelStats.running ? "success" : "muted"}>
                    {panelStats.running ? `${panelStats.running} ativo(s)` : "Nenhum ativo"}
                  </Badge>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                  Crie sorteios para Twitch ou Kick, publique o painel no Discord e controle a roleta em tempo real.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={actionId === "sync-options"} onClick={() => void handleSyncOptions()} variant="outline">
                {actionId === "sync-options" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Sincronizar canais
              </Button>
              <Button onClick={handleNew} variant="secondary">
                <Gift className="h-4 w-4" />
                Novo sorteio
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile icon={Gift} label="Sorteios criados" value={String(panelStats.total)} />
            <StatTile icon={Radio} label="Em andamento" value={String(panelStats.running)} tone="success" />
            <StatTile icon={Users} label="Participantes" value={formatNumber(panelStats.participants)} />
            <StatTile icon={Trophy} label="Ganhadores" value={formatNumber(panelStats.winners)} tone="warning" />
          </div>
        </CardContent>
      </Card>

      {message ? (
        <div className={messageTone === "danger"
          ? "rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100"
          : "rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"}
        >
          {message}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
        <Card className="border-zinc-800 bg-zinc-950/80">
          <CardHeader className="border-b border-zinc-900 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">{editingGiveaway ? "Editar sorteio" : "Criar sorteio"}</CardTitle>
                <CardDescription>{editingGiveaway ? editingGiveaway.title : "Configuração principal do painel e da roleta."}</CardDescription>
              </div>
              <Badge variant={editingGiveaway ? "warning" : "default"}>
                {editingGiveaway ? "Editando" : "Novo"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 p-5 sm:p-6 lg:grid-cols-2">
            <FormField label="Nome do sorteio">
              <input
                className="social-input h-11"
                disabled={!canManage}
                onChange={(event) => updateForm("title", event.target.value)}
                placeholder="Sorteio da live"
                value={form.title}
              />
            </FormField>

            <FormField label="Premio">
              <input
                className="social-input h-11"
                disabled={!canManage}
                onChange={(event) => updateForm("prizeName", event.target.value)}
                placeholder="Produto, pix, skin, gift card"
                value={form.prizeName}
              />
            </FormField>

            <FormField className="lg:col-span-2" label="URL da live ou canal">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="social-input h-11"
                  disabled={!canManage}
                  onChange={(event) => updateForm("liveUrl", event.target.value)}
                  placeholder="https://kick.com/canal ou https://www.twitch.tv/canal"
                  value={form.liveUrl}
                />
                <Button
                  className="h-11 shrink-0"
                  disabled={!canManage || livePreviewLoading || !normalizedLiveUrl}
                  onClick={() => void handleVerifyLiveChannel()}
                  type="button"
                  variant="outline"
                >
                  {livePreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Buscar
                </Button>
              </div>
            </FormField>

            <ParticipantModeCard
              onChange={(value) => updateForm("participantMode", value)}
              platform={livePreview?.platform ?? (livePlatform === "youtube" ? null : livePlatform)}
              value={form.participantMode}
            />

            <FormField label="Canal do Discord">
              <select
                className="social-input h-11"
                disabled={!canManage}
                onChange={(event) => updateForm("discordChannelId", event.target.value)}
                value={form.discordChannelId}
              >
                <option value="">Selecione um canal</option>
                {(options?.channels ?? []).map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            </FormField>

            <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
              <FormField label="Ganhadores">
                <input
                  className="social-input h-11"
                  disabled={!canManage}
                  max={50}
                  min={1}
                  onChange={(event) => updateForm("winnerCount", Number(event.target.value))}
                  type="number"
                  value={form.winnerCount}
                />
              </FormField>

              <FormField label="Iniciar em minutos">
                <input
                  className="social-input h-11"
                  disabled={!canManage}
                  min={0}
                  onChange={(event) => updateForm("startDelayMinutes", Number(event.target.value))}
                  type="number"
                  value={form.startDelayMinutes}
                />
              </FormField>

              <FormField label="Encerrar em minutos">
                <input
                  className="social-input h-11"
                  disabled={!canManage}
                  min={0}
                  onChange={(event) => updateForm("endDelayMinutes", Number(event.target.value))}
                  type="number"
                  value={form.endDelayMinutes}
                />
              </FormField>
            </div>

            <FormField className="lg:col-span-2" label="Mensagem personalizada do painel">
              <textarea
                className="social-input min-h-24 resize-none py-3"
                disabled={!canManage}
                onChange={(event) => updateForm("customMessage", event.target.value)}
                placeholder="Mensagem opcional enviada dentro da embed."
                value={form.customMessage}
              />
            </FormField>

            <div className="flex flex-col gap-4 rounded-lg border border-zinc-900 bg-black/35 p-4 sm:flex-row sm:items-center sm:justify-between lg:col-span-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">Permitir ganhador repetido</p>
                <p className="mt-1 text-xs text-zinc-500">Desativado impede o mesmo participante de ganhar mais de uma vez neste sorteio.</p>
              </div>
              <Switch
                checked={form.allowRepeatWinners}
                disabled={!canManage}
                onCheckedChange={(checked) => updateForm("allowRepeatWinners", checked)}
              />
            </div>

            <div className="flex flex-wrap gap-2 lg:col-span-2">
              <Button disabled={!canSubmit} onClick={() => void handleSubmit()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {editingId ? "Salvar alterações" : "Criar sorteio"}
              </Button>
              {editingGiveaway?.rouletteUrl ? (
                <Button onClick={() => window.open(editingGiveaway.rouletteUrl, "_blank", "noopener,noreferrer")} variant="outline">
                  <ExternalLink className="h-4 w-4" />
                  Abrir roleta
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <LivePreviewCard
            error={livePreviewError}
            loading={livePreviewLoading}
            platform={livePlatform}
            preview={livePreviewInput === normalizedLiveUrl ? livePreview : null}
            value={normalizedLiveUrl}
          />

          <Card className="border-zinc-800 bg-zinc-950/80">
            <CardHeader className="border-b border-zinc-900">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#FFEA70]" />
                Resumo
              </CardTitle>
              <CardDescription>Estado atual antes de publicar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              <SummaryLine icon={Gift} label="Premio" value={form.prizeName.trim() || "Pendente"} />
              <SummaryLine icon={Link2} label="Live" value={normalizedLiveUrl || "Pendente"} />
              <SummaryLine icon={Users} label="Participação" value={participantModeLabel(form.participantMode)} />
              <SummaryLine icon={Trophy} label="Ganhadores" value={`${Math.max(1, Number(form.winnerCount) || 1)} vencedor(es)`} />
              <SummaryLine icon={Send} label="Canal Discord" value={selectedDiscordChannel ? `#${selectedDiscordChannel}` : "Pendente"} />
            </CardContent>
          </Card>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Sorteios cadastrados</h3>
            <p className="text-sm text-zinc-500">{panelStats.waiting} aguardando, {panelStats.running} em andamento.</p>
          </div>
        </div>

        {giveaways.length ? giveaways.map((giveaway) => (
          <GiveawayRow
            actionId={actionId}
            canManage={canManage}
            giveaway={giveaway}
            key={giveaway.id}
            onAction={handleAction}
            onEdit={handleEdit}
          />
        )) : (
          <Card>
            <CardContent className="flex min-h-36 items-center justify-center p-6 text-sm text-zinc-500">
              Nenhum sorteio criado ainda.
            </CardContent>
          </Card>
        )}
      </section>
    </section>
  );
}

function StatTile({
  icon: Icon,
  label,
  tone = "default",
  value
}: {
  icon: typeof Gift;
  label: string;
  tone?: "default" | "success" | "warning";
  value: string;
}) {
  const toneClass = tone === "success"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
    : tone === "warning"
      ? "border-[#FFD500]/25 bg-[#FFD500]/10 text-[#FFEA70]"
      : "border-zinc-800 bg-black/30 text-zinc-200";

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <Icon className="h-4 w-4 opacity-80" />
      <p className="mt-3 text-xs font-semibold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

function SummaryLine({ icon: Icon, label, value }: { icon: typeof Gift; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-900 bg-black/35 px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase text-zinc-600">{label}</p>
        <p className="truncate text-sm font-medium text-zinc-100">{value}</p>
      </div>
    </div>
  );
}

function GiveawayRow({
  actionId,
  canManage,
  giveaway,
  onAction,
  onEdit
}: {
  actionId: string | null;
  canManage: boolean;
  giveaway: Giveaway;
  onAction: (giveaway: Giveaway, action: "panel" | "start" | "end" | "sync") => void;
  onEdit: (giveaway: Giveaway) => void;
}) {
  const status = statusMeta(giveaway.status);
  const panelLoading = actionId === `panel:${giveaway.id}`;
  const syncLoading = actionId === `sync:${giveaway.id}`;
  const startLoading = actionId === `start:${giveaway.id}`;
  const endLoading = actionId === `end:${giveaway.id}`;
  const totalTickets = giveaway.participants.reduce((total, participant) => total + Math.max(1, participant.tickets ?? 1), 0);

  return (
    <Card className="overflow-hidden border-zinc-800 bg-zinc-950/75">
      <CardContent className="p-0">
        <div className={`h-1 w-full ${status.barClassName}`} />
        <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-white">{giveaway.title}</h3>
              <Badge className={status.className} variant="muted">{status.label}</Badge>
              <span className={platformPillClass(giveaway.livePlatform)}>{platformLabel(giveaway.livePlatform)}</span>
            </div>
            <p className="mt-1 truncate text-xs text-zinc-500">{giveaway.liveName} - {participantModeLabel(giveaway.participantMode)}</p>
            <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2 xl:grid-cols-4">
              <InfoPill icon={Gift} label={giveaway.prizeName} />
              <InfoPill icon={Users} label={`${giveaway.participants.length} participante(s) / ${totalTickets} ticket(s)`} />
              <InfoPill icon={Trophy} label={`${giveaway.winners.length}/${giveaway.winnerCount} ganhador(es)`} />
              <InfoPill icon={Clock} label={giveaway.scheduledStartAt ? `Inicia ${formatDate(giveaway.scheduledStartAt)}` : giveaway.scheduledEndAt ? `Encerra ${formatDate(giveaway.scheduledEndAt)}` : formatDate(giveaway.createdAt)} />
            </div>
            {giveaway.schedulerError || giveaway.lastSyncError ? (
              <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{giveaway.schedulerError ?? giveaway.lastSyncError}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 lg:max-w-[470px] lg:justify-end">
            <Button onClick={() => onEdit(giveaway)} size="sm" variant="outline">
              <Pencil className="h-4 w-4" />
              Editar
            </Button>
            <Button disabled={!canManage || panelLoading} onClick={() => onAction(giveaway, "panel")} size="sm" variant="outline">
              {panelLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Painel
            </Button>
            <Button disabled={!canManage || syncLoading || giveaway.status === "ended"} onClick={() => onAction(giveaway, "sync")} size="sm" variant="outline">
              {syncLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
            <Button disabled={!canManage || giveaway.status !== "waiting" || startLoading} onClick={() => onAction(giveaway, "start")} size="sm">
              {startLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Iniciar
            </Button>
            <Button disabled={!canManage || giveaway.status === "ended" || endLoading} onClick={() => onAction(giveaway, "end")} size="sm" variant="destructive">
              {endLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              Encerrar
            </Button>
            <Button onClick={() => window.open(giveaway.rouletteUrl, "_blank", "noopener,noreferrer")} size="icon" title="Abrir roleta" variant="outline">
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LivePreviewCard({
  className = "",
  error,
  loading,
  platform,
  preview,
  value
}: {
  className?: string;
  error: string | null;
  loading: boolean;
  platform: "twitch" | "kick" | "youtube" | null;
  preview: GiveawayLivePreview | null;
  value: string;
}) {
  if (!value) {
    return null;
  }

  if (loading) {
    return (
      <div className={`rounded-lg border border-zinc-900 bg-black/35 p-4 ${className}`}>
        <div className="flex items-center gap-3 text-sm text-zinc-300">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
          Buscando canal...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-lg border border-red-500/25 bg-red-500/10 p-4 ${className}`}>
        <div className="flex items-start gap-3 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className={`rounded-lg border border-zinc-900 bg-black/35 p-4 ${className}`}>
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <Radio className="h-4 w-4 text-zinc-500" />
          <span>{platform ? `Plataforma detectada: ${platformLabel(platform)}. Clique em Buscar para verificar o canal.` : "Clique em Buscar para verificar o canal."}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-zinc-800 bg-black/35 p-4 ${className}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
            {preview.avatar ? (
              <img alt="" className="h-full w-full object-cover" src={preview.avatar} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-zinc-500">
                {preview.displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-white">@{preview.channelName}</p>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${platformClass(preview.platform)}`}>
                {platformLabel(preview.platform)}
              </span>
              <span className={preview.isLive ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300" : "rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-medium text-zinc-400"}>
                {preview.isLive ? "Online" : "Offline"}
              </span>
            </div>
            <a className="mt-1 block truncate text-xs text-zinc-500 hover:text-white" href={preview.url} rel="noreferrer" target="_blank">
              {preview.url}
            </a>
            <p className="mt-1 truncate font-mono text-[11px] text-zinc-600">ID: {preview.platformUserId}</p>
          </div>
        </div>

        <div className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-3 md:min-w-[420px]">
          <PreviewFact label="Status" value={preview.isLive ? "Online" : "Offline"} />
          <PreviewFact label="Viewers" value={preview.viewerCount === null ? "Não informado" : formatNumber(preview.viewerCount)} />
          <PreviewFact label="Seguidores" value={preview.followers === null ? "Não informado" : formatNumber(preview.followers)} />
        </div>
        <CheckCircle2 className="hidden h-5 w-5 shrink-0 text-emerald-400 md:block" />
      </div>

      {preview.title || preview.category ? (
        <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-2">
          <PreviewFact label="Titulo" value={preview.title ?? "Sem titulo detectado"} />
          <PreviewFact label="Categoria" value={preview.category ?? "Sem categoria"} />
        </div>
      ) : null}

      {preview.warning ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs leading-5 text-yellow-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{preview.warning}</span>
        </div>
      ) : null}
    </div>
  );
}

function ParticipantModeCard({
  onChange,
  platform,
  value
}: {
  onChange: (value: GiveawayParticipantMode) => void;
  platform: "twitch" | "kick" | null;
  value: GiveawayParticipantMode;
}) {
  const options = participantModeOptions(platform);

  return (
    <div className="rounded-lg border border-zinc-900 bg-black/35 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Users className="h-4 w-4 text-emerald-300" />
          <div>
            <p className="text-sm font-medium text-white">Modo de participação</p>
            <p className="mt-1 text-xs text-zinc-500">{platform ? `${platformLabel(platform)} detectado` : "Aguardando canal verificado"}</p>
          </div>
        </div>
        <select
          className="social-input h-11"
          onChange={(event) => onChange(event.target.value as GiveawayParticipantMode)}
          value={options.some((option) => option.value === value) ? value : options[0]?.value ?? "all"}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function participantModeOptions(platform: "twitch" | "kick" | null): Array<{ label: string; value: GiveawayParticipantMode }> {
  if (platform === "kick") {
    return [
      { label: "Todos do chat/eventos Kick", value: "all" },
      { label: "Somente subs Kick", value: "kick_subs" },
      { label: "Somente seguidores Kick", value: "kick_followers" }
    ];
  }

  return [
    { label: "Todos elegiveis", value: "all" },
    { label: "Somente subs Twitch", value: "twitch_subs" },
    { label: "Somente seguidores Twitch", value: "twitch_followers" },
    { label: "Subs + seguidores Twitch", value: "twitch_subs_followers" },
    { label: "Unificado Twitch + Kick", value: "twitch_kick" }
  ];
}

function PreviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-900 bg-zinc-950/70 p-3">
      <p>{label}</p>
      <p className="mt-1 truncate font-medium text-zinc-200">{value}</p>
    </div>
  );
}

function InfoPill({ icon: Icon, label }: { icon: typeof Gift; label: string }) {
  return (
    <span className="flex min-h-8 items-center gap-2 rounded-md border border-zinc-900 bg-black/30 px-2.5 py-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function FormField({
  children,
  className = "",
  label
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={`block space-y-2 ${className}`}>
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      {children}
    </label>
  );
}

function toPayload(form: GiveawayForm): SaveGiveawayPayload {
  return {
    allowRepeatWinners: form.allowRepeatWinners,
    customMessage: form.customMessage.trim() || null,
    discordChannelId: form.discordChannelId || null,
    endDelayMinutes: Math.max(0, Number(form.endDelayMinutes) || 0),
    liveUrl: form.liveUrl.trim(),
    participantMode: form.participantMode,
    prizeName: form.prizeName.trim(),
    startDelayMinutes: Math.max(0, Number(form.startDelayMinutes) || 0),
    title: form.title.trim(),
    winnerCount: Math.max(1, Math.min(50, Number(form.winnerCount) || 1))
  };
}

function validateFormForSubmit(form: GiveawayForm, liveValidated: boolean, livePreviewLoading: boolean) {
  if (!form.title.trim()) {
    return "Informe o nome do sorteio.";
  }

  if (!form.prizeName.trim()) {
    return "Informe o premio do sorteio.";
  }

  if (!form.liveUrl.trim()) {
    return "Informe uma URL válida da Twitch ou Kick.";
  }

  if (!form.discordChannelId) {
    return "Selecione um canal do Discord antes de criar o sorteio.";
  }

  if (livePreviewLoading) {
    return "Aguarde a verificação do canal antes de criar o sorteio.";
  }

  if (!liveValidated) {
    return "Busque e verifique uma URL válida da Twitch ou Kick antes de criar o sorteio.";
  }

  return null;
}

function detectPlatform(value: string): "twitch" | "kick" | "youtube" | null {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (/(^|\/\/|www\.)kick\.com\//i.test(normalized) || /^kick\.com\//i.test(normalized)) {
    return "kick";
  }

  if (/(^|\/\/|www\.)twitch\.tv\//i.test(normalized) || /^twitch\.tv\//i.test(normalized)) {
    return "twitch";
  }

  if (/(^|\/\/|www\.)(youtube\.com|youtu\.be)\//i.test(normalized) || /^(youtube\.com|youtu\.be)\//i.test(normalized)) {
    return "youtube";
  }

  return "twitch";
}

function defaultParticipantMode(): GiveawayParticipantMode {
  return "all";
}

function platformLabel(platform: "twitch" | "kick" | "youtube" | "multi") {
  if (platform === "kick") return "Kick";
  if (platform === "multi") return "Twitch + Kick";
  if (platform === "youtube") return "YouTube";
  return "Twitch";
}

function platformPillClass(platform: Giveaway["livePlatform"]) {
  if (platform === "kick") return "rounded-full border border-[#53fc18]/30 bg-[#53fc18]/10 px-2 py-0.5 text-xs font-bold text-[#53fc18]";
  if (platform === "multi") return "rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-xs font-bold text-cyan-200";
  return "rounded-full border border-[#9146ff]/35 bg-[#9146ff]/15 px-2 py-0.5 text-xs font-bold text-[#d2b8ff]";
}

function platformClass(platform: "twitch" | "kick") {
  return platform === "kick"
    ? "border-[#53fc18]/30 bg-[#53fc18]/10 text-[#53fc18]"
    : "border-[#9146ff]/30 bg-[#9146ff]/10 text-[#c4a0ff]";
}

function participantModeLabel(mode: GiveawayParticipantMode) {
  const labels: Record<GiveawayParticipantMode, string> = {
    all: "Todos elegiveis",
    kick_followers: "Seguidores Kick",
    kick_subs: "Subs Kick",
    twitch_followers: "Seguidores Twitch",
    twitch_kick: "Twitch + Kick",
    twitch_subs: "Subs Twitch",
    twitch_subs_followers: "Subs + seguidores Twitch"
  };

  return labels[mode] ?? "Personalizado";
}

function formatNumber(value: number) {
  return value.toLocaleString("pt-BR");
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Não registrado";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(new Date(value));
}

function upsertGiveaway(giveaways: Giveaway[], giveaway: Giveaway) {
  return [giveaway, ...giveaways.filter((item) => item.id !== giveaway.id)]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function statusMeta(status: Giveaway["status"]) {
  if (status === "running") {
    return {
      barClassName: "bg-emerald-400",
      className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
      label: "Em andamento"
    };
  }

  if (status === "ended") {
    return {
      barClassName: "bg-red-400",
      className: "border-red-500/25 bg-red-500/10 text-red-300",
      label: "Encerrado"
    };
  }

  return {
    barClassName: "bg-[#FFD500]",
    className: "border-yellow-500/25 bg-yellow-500/10 text-yellow-200",
    label: "Aguardando"
  };
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? friendlyErrorMessage(response.data.message) : null;
}

function friendlyErrorMessage(message: string) {
  if (message.includes("liveUrl") || message.includes("String must contain")) {
    return "Informe uma URL válida da Twitch ou Kick.";
  }

  if (message.includes("prizeName")) {
    return "Informe o premio do sorteio.";
  }

  if (message.includes("title")) {
    return "Informe o nome do sorteio.";
  }

  if (message.includes("discordChannelId")) {
    return "Selecione um canal do Discord antes de criar o sorteio.";
  }

  return message;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}
