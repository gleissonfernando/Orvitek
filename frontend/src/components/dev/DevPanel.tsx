import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, KeyRound, Loader2, Plus, Power, Trash2, XCircle } from "lucide-react";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import {
  createDevBot,
  deleteDevBot,
  getDevBots,
  getDevModules,
  restartDevBot,
  testDevBotConnection,
  updateDevBotModules
} from "../../lib/api";
import type {
  AuthUser,
  BotConnectionTest,
  CreateDevBotPayload,
  DashboardMeGuild,
  DevBot,
  DevBotStatus,
  DevModuleDefinition
} from "../../types";

const fallbackModules: DevModuleDefinition[] = [
  { id: "live", label: "Sistema de Live" },
  { id: "clips", label: "Sistema de Clipes" },
  { id: "avisos", label: "Sistema de Avisos" },
  { id: "verification", label: "Sistema de Verificacao" },
  { id: "welcome", label: "Sistema de Boas-vindas" },
  { id: "leave", label: "Sistema de Saida" },
  { id: "logs", label: "Sistema de Logs" },
  { id: "roles", label: "Sistema de Cargos" },
  { id: "tickets", label: "Sistema de Tickets" },
  { id: "moderation", label: "Sistema de Moderacao" },
  { id: "noc_magnatas", label: "Sistema de NOC Magnatas" },
  { id: "maintenance", label: "Sistema de Manutencao" },
  { id: "bot_api", label: "Sistema de API do Bot" }
];

const emptyForm: CreateDevBotPayload = {
  name: "",
  clientId: "",
  token: "",
  secret: "",
  avatarUrl: "",
  ownerName: "",
  ownerId: "",
  mainGuildId: "",
  enabledModules: ["live"]
};

type DevPanelProps = {
  guilds?: DashboardMeGuild[];
  selectedGuildId?: string | null;
  user?: AuthUser;
};

export function DevPanel({ guilds = [], selectedGuildId, user }: DevPanelProps) {
  const [bots, setBots] = useState<DevBot[]>([]);
  const [modules, setModules] = useState<DevModuleDefinition[]>(fallbackModules);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateDevBotPayload>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<BotConnectionTest | null>(null);

  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? bots[0] ?? null;
  const guildNameById = useMemo(() => new Map(guilds.map((guild) => [guild.id, guild.name])), [guilds]);
  const stats = useMemo(
    () => ({
      total: bots.length,
      online: bots.filter((bot) => bot.status === "online").length,
      offline: bots.filter((bot) => bot.status === "offline").length,
      errors: bots.filter((bot) => bot.status === "error" || bot.status === "invalid_token").length
    }),
    [bots]
  );

  useEffect(() => {
    let mounted = true;

    Promise.all([getDevModules(), getDevBots()])
      .then(([moduleData, botData]) => {
        if (!mounted) return;
        setModules(moduleData.length ? moduleData : fallbackModules);
        setBots(botData);
        setSelectedBotId((current) => current ?? botData[0]?.id ?? null);
      })
      .catch(() => {
        if (mounted) setMessage("Nao foi possivel carregar a aba Dev.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      ownerName: current.ownerName || user?.globalName || user?.username || "",
      ownerId: current.ownerId || user?.discordId || "",
      mainGuildId: current.mainGuildId || selectedGuildId || guilds[0]?.id || ""
    }));
  }, [guilds, selectedGuildId, user]);

  function updateForm<K extends keyof CreateDevBotPayload>(key: K, value: CreateDevBotPayload[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  async function handleTestToken() {
    if (!form.token.trim()) {
      setMessage("Informe o token para testar.");
      return;
    }

    setTesting(true);
    setMessage(null);
    setTestResult(null);

    try {
      const result = await testDevBotConnection(form.token);
      setTestResult(result);
      setMessage(result.message);
      if (result.avatarUrl && !form.avatarUrl) {
        updateForm("avatarUrl", result.avatarUrl);
      }
    } catch {
      setMessage("Nao foi possivel testar o token.");
    } finally {
      setTesting(false);
    }
  }

  async function handleCreateBot() {
    setSaving(true);
    setMessage(null);

    try {
      const bot = await createDevBot({
        ...form,
        avatarUrl: form.avatarUrl || null,
        secret: form.secret || null
      });
      setBots((current) => [bot, ...current]);
      setSelectedBotId(bot.id);
      setForm(emptyForm);
      setTestResult(null);
      setMessage("Bot cadastrado com sucesso.");
    } catch {
      setMessage("Nao foi possivel salvar o bot. Confira os campos obrigatorios.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleModule(bot: DevBot, moduleId: string, checked: boolean) {
    const nextModules = checked
      ? [...new Set([...bot.enabledModules, moduleId])]
      : bot.enabledModules.filter((item) => item !== moduleId);

    setBots((current) => current.map((item) => (item.id === bot.id ? { ...item, enabledModules: nextModules } : item)));

    try {
      const updated = await updateDevBotModules(bot.id, nextModules);
      setBots((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setMessage("Modulos atualizados.");
    } catch {
      setBots((current) => current.map((item) => (item.id === bot.id ? bot : item)));
      setMessage("Nao foi possivel atualizar os modulos.");
    }
  }

  async function handleRestart(bot: DevBot) {
    setMessage(null);

    try {
      const updated = await restartDevBot(bot.id);
      setBots((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setMessage(updated.statusMessage ?? "Bot sincronizado.");
    } catch {
      setMessage("Nao foi possivel reiniciar/testar esse bot.");
    }
  }

  async function handleDelete(bot: DevBot) {
    if (!window.confirm(`Excluir ${bot.name}?`)) {
      return;
    }

    try {
      await deleteDevBot(bot.id);
      setBots((current) => current.filter((item) => item.id !== bot.id));
      setSelectedBotId((current) => (current === bot.id ? null : current));
      setMessage("Bot removido.");
    } catch {
      setMessage("Nao foi possivel excluir o bot.");
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-48 items-center justify-center p-6">
          <Loader2 className="h-7 w-7 animate-spin text-zinc-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DevStatCard label="Bots cadastrados" value={String(stats.total)} />
        <DevStatCard label="Bots online" value={String(stats.online)} />
        <DevStatCard label="Bots offline" value={String(stats.offline)} />
        <DevStatCard label="Com erro" value={String(stats.errors)} />
      </section>

      {message ? (
        <div className="rounded-lg border border-purple-500/25 bg-purple-500/10 px-4 py-3 text-sm text-purple-100">{message}</div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>Gerenciar Bots</CardTitle>
            <CardDescription>Cadastre o bot, teste o token e defina o dono do painel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <DevInput label="Nome do bot" value={form.name} onChange={(value) => updateForm("name", value)} />
              <DevInput label="Client ID" value={form.clientId} onChange={(value) => updateForm("clientId", value)} />
              <DevInput label="Token do bot" type="password" value={form.token} onChange={(value) => updateForm("token", value)} />
              <DevInput label="Secret" type="password" value={form.secret ?? ""} onChange={(value) => updateForm("secret", value)} />
              <DevInput label="Avatar URL" value={form.avatarUrl ?? ""} onChange={(value) => updateForm("avatarUrl", value)} />
              {guilds.length ? (
                <DevSelect
                  label="Servidor principal"
                  onChange={(value) => updateForm("mainGuildId", value)}
                  options={guilds.map((guild) => ({
                    label: guild.name,
                    value: guild.id
                  }))}
                  value={form.mainGuildId}
                />
              ) : (
                <DevInput label="Servidor principal" value={form.mainGuildId} onChange={(value) => updateForm("mainGuildId", value)} />
              )}
              <DevInput label="Nome do dono" value={form.ownerName} onChange={(value) => updateForm("ownerName", value)} />
              <DevInput label="ID do dono" value={form.ownerId} onChange={(value) => updateForm("ownerId", value)} />
            </div>

            <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Modulos liberados</p>
                  <p className="text-xs text-zinc-500">Esses modulos aparecem para o bot cadastrado.</p>
                </div>
                <Badge variant="muted">{form.enabledModules.length}</Badge>
              </div>
              <ModuleSwitchGrid enabledModules={form.enabledModules} modules={modules} onToggle={(moduleId, checked) => {
                updateForm(
                  "enabledModules",
                  checked
                    ? [...new Set([...form.enabledModules, moduleId])]
                    : form.enabledModules.filter((item) => item !== moduleId)
                );
              }} />
            </div>

            {testResult ? (
              <div className="rounded-lg border border-zinc-800 bg-black/35 px-4 py-3 text-sm text-zinc-200">
                Teste: <span className={statusTextClass(testResult.status)}>{statusLabel(testResult.status)}</span>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button disabled={testing || !form.token.trim()} onClick={handleTestToken} variant="outline">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Testar conexao
              </Button>
              <Button disabled={saving} onClick={handleCreateBot}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Salvar bot
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bots cadastrados</CardTitle>
            <CardDescription>Token protegido no backend. O painel nunca mostra o valor completo.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {bots.length ? (
                bots.map((bot) => (
                  <button
                    className={`w-full rounded-lg border px-4 py-3 text-left transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-900 ${
                      selectedBot?.id === bot.id ? "border-purple-500/50 bg-purple-500/10" : "border-zinc-900 bg-zinc-950/60"
                    }`}
                    key={bot.id}
                    onClick={() => setSelectedBotId(bot.id)}
                    type="button"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="h-11 w-11 rounded-full border border-red-500/50" fallback={bot.name} src={bot.avatarUrl} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-white">{bot.name}</p>
                            <StatusBadge status={bot.status} />
                          </div>
                          <p className="truncate text-xs text-zinc-500">
                            Servidor {guildNameById.get(bot.mainGuildId) ?? "Servidor configurado"}
                          </p>
                          <p className="truncate text-xs text-zinc-600">Dono {bot.ownerName}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="muted">{bot.enabledModules.length} modulos</Badge>
                        <Button onClick={(event) => {
                          event.stopPropagation();
                          void handleRestart(bot);
                        }} size="icon" title="Reiniciar bot" variant="outline">
                          <Power className="h-4 w-4" />
                        </Button>
                        <Button onClick={(event) => {
                          event.stopPropagation();
                          void handleDelete(bot);
                        }} size="icon" title="Excluir bot" variant="destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center">
                  <Bot className="mb-3 h-7 w-7 text-zinc-500" />
                  <p className="text-sm font-medium text-zinc-500">Nenhum bot cadastrado</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {selectedBot ? (
        <Card>
          <CardHeader>
            <CardTitle>Modulos do bot {selectedBot.name}</CardTitle>
            <CardDescription>Ative ou desative o que esse bot pode usar no dashboard e na API interna.</CardDescription>
          </CardHeader>
          <CardContent>
            <ModuleSwitchGrid
              enabledModules={selectedBot.enabledModules}
              modules={modules}
              onToggle={(moduleId, checked) => void handleToggleModule(selectedBot, moduleId, checked)}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function DevStatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-800 bg-black text-zinc-200">
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-500">{label}</p>
          <p className="text-2xl font-semibold text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DevInput({ label, onChange, type = "text", value }: { label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <input className="social-input" onChange={(event) => onChange(event.target.value)} type={type} value={value} />
    </label>
  );
}

function DevSelect({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <select className="social-input" onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ModuleSwitchGrid({
  enabledModules,
  modules,
  onToggle
}: {
  enabledModules: string[];
  modules: DevModuleDefinition[];
  onToggle: (moduleId: string, checked: boolean) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {modules.map((module) => {
        const enabled = enabledModules.includes(module.id);

        return (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-black/35 px-3 py-2" key={module.id}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-100">{module.label}</p>
              <p className="text-xs text-zinc-500">{enabled ? "Ativado" : "Desativado"}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={(checked) => onToggle(module.id, checked)} />
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: DevBotStatus }) {
  const connected = status === "online";

  return (
    <Badge variant={connected ? "success" : status === "invalid_token" || status === "error" ? "danger" : "muted"}>
      {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {statusLabel(status)}
    </Badge>
  );
}

function statusLabel(status: DevBotStatus) {
  const labels: Record<DevBotStatus, string> = {
    online: "Online",
    offline: "Offline",
    invalid_token: "Token invalido",
    error: "Erro"
  };

  return labels[status];
}

function statusTextClass(status: DevBotStatus) {
  return status === "online" ? "text-emerald-300" : status === "offline" ? "text-zinc-300" : "text-red-300";
}
