import { useEffect, useMemo, useState } from "react";
import { EyeOff, Loader2, Save, Trash2 } from "lucide-react";
import { getGuildLiveOptions, getPoliceHiddenChannelDashboard, removePoliceHiddenChannelSettings, savePoliceHiddenChannelSettings } from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type { DashboardGuild, GuildChannelOption, GuildRoleOption, PoliceHiddenChannelDashboard, PoliceHiddenChannelSettings } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { FivemResourceSelect } from "./FivemResourceSelect";

export function PoliceHiddenChannelPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [data, setData] = useState<PoliceHiddenChannelDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!botId || !guild) {
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    Promise.all([getPoliceHiddenChannelDashboard(guild.id, botId), getGuildLiveOptions(guild.id, botId)])
      .then(([dashboard, options]) => {
        if (!mounted) return;
        setData(dashboard);
        setChannels(options.channels);
        setRoles(options.roles);
      })
      .catch((error) => mounted && setMessage(readMessage(error)))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!botId || !guild) return;
    const socket = createDashboardSocket();
    const refresh = () => {
      void getPoliceHiddenChannelDashboard(guild.id, botId).then(setData).catch(() => undefined);
    };

    socket.on("police-hidden-channel:settings_updated", refresh);
    socket.on("police-hidden-channel:log_created", refresh);

    return () => {
      socket.off("police-hidden-channel:settings_updated", refresh);
      socket.off("police-hidden-channel:log_created", refresh);
      socket.disconnect();
    };
  }, [botId, guild?.id]);

  const stats = useMemo(() => {
    const logs = data?.logs ?? [];
    return {
      failures: logs.filter((item) => item.status === "failed").length,
      relayed: logs.filter((item) => item.status === "relayed").length,
      total: logs.length
    };
  }, [data]);

  if (!botId || !guild) return <Empty text="Selecione um bot e servidor para configurar o Canal Oculto." />;
  if (loading || !data) return <Empty loading text="Carregando Canal Oculto..." />;

  const patch = (next: Partial<PoliceHiddenChannelSettings>) => setData((current) => current ? { ...current, settings: { ...current.settings, ...next } } : current);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const settings = await savePoliceHiddenChannelSettings(guild!.id, botId!, data!.settings);
      setData((current) => current ? { ...current, settings } : current);
      setMessage("Canal Oculto salvo e sincronizado com o bot.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Remover a configuração do Canal Oculto?")) return;
    setSaving(true);
    setMessage(null);
    try {
      const settings = await removePoliceHiddenChannelSettings(guild!.id, botId!);
      setData((current) => current ? { ...current, settings } : current);
      setMessage("Configuração removida.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const ready = Boolean(data.settings.enabled && data.settings.channelId && data.settings.allowedRoleId && data.settings.logChannelId);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><EyeOff className="h-5 w-5 text-emerald-300" />Canal Oculto</CardTitle>
          <CardDescription>Mensagens de policiais autorizados são apagadas e retransmitidas pelo bot sem identificar o autor no canal.</CardDescription>
        </CardHeader>
      </Card>

      {message ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-white">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Status" value={ready ? "Pronto" : "Pendente"} />
        <Metric label="Retransmitidas" value={stats.relayed} />
        <Metric label="Falhas" value={stats.failures} />
        <Metric label="Histórico" value={stats.total} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuração</CardTitle>
          <CardDescription>As alterações são salvas no banco e aplicadas no bot sem reiniciar.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <FivemResourceSelect disabled={!canManage} label="Canal oculto" options={channels} value={data.settings.channelId} onChange={(channelId) => patch({ channelId })} />
          <FivemResourceSelect disabled={!canManage} label="Cargo autorizado" options={roles} value={data.settings.allowedRoleId} onChange={(allowedRoleId) => patch({ allowedRoleId })} />
          <FivemResourceSelect disabled={!canManage} label="Canal de logs administrativos" options={channels} value={data.settings.logChannelId} onChange={(logChannelId) => patch({ logChannelId })} />
          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 p-3">
            <div>
              <p className="text-sm font-medium text-white">Sistema ativo</p>
              <p className="text-xs text-zinc-500">Desative para pausar a retransmissão sem perder a configuração.</p>
            </div>
            <Switch checked={data.settings.enabled} disabled={!canManage} onCheckedChange={(enabled) => patch({ enabled })} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:col-span-2">
            <Button disabled={!canManage || saving} onClick={() => void save()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar</Button>
            <Button disabled={!canManage || saving} onClick={() => void remove()} variant="destructive"><Trash2 className="h-4 w-4" />Remover configuração</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de alterações e mensagens</CardTitle>
          <CardDescription>Auditoria administrativa das retransmissões feitas pelo bot.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.logs.map((log) => (
            <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between" key={log.id}>
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{log.authorTag} · <span className="text-zinc-400">{log.authorId}</span></p>
                <p className="mt-1 truncate text-xs text-zinc-500">{log.content || `${log.attachmentUrls.length} arquivo(s), ${log.embedCount} embed(s)`}</p>
                <p className="mt-1 text-xs text-zinc-600">{new Date(log.createdAt).toLocaleString("pt-BR")} · Canal {log.channelId}</p>
              </div>
              <Badge variant={log.status === "relayed" ? "success" : "danger"}>{log.status === "relayed" ? "Retransmitida" : "Falhou"}</Badge>
            </div>
          ))}
          {!data.logs.length ? <p className="py-8 text-center text-zinc-500">Nenhum registro do Canal Oculto.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Empty({ text, loading = false }: { text: string; loading?: boolean }) {
  return <Card><CardContent className="flex min-h-48 items-center justify-center gap-2 text-zinc-400">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{text}</CardContent></Card>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-xl font-bold text-white">{value}</p></CardContent></Card>;
}

function readMessage(error: unknown) {
  return (error as any)?.response?.data?.message ?? "Não foi possível concluir a operação.";
}
