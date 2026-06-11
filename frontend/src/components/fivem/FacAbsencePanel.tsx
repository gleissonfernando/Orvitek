import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarClock,
  Hash,
  Loader2,
  MessageSquareText,
  Send,
  ShieldCheck,
  UserCheck
} from "lucide-react";
import {
  getFivemFac,
  getGuildLiveOptions,
  publishFivemFacPanel,
  saveFivemFacSettings
} from "../../lib/api";
import type {
  DashboardGuild,
  FivemFacAbsence,
  FivemFacAbsenceStatus,
  FivemFacMessages,
  FivemFacSettings,
  GuildChannelOption,
  GuildRoleOption
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type FacAbsencePanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

const defaultMessages: FivemFacMessages = {
  panelTitle: "FAC - Sistema de Ausencia",
  panelDescription: "Solicite sua ausencia de faccao ou organizacao informando motivo e datas.",
  requestCreated: "Sua solicitacao de ausencia foi enviada para analise.",
  approved: "Sua ausencia foi aprovada.",
  rejected: "Sua ausencia foi reprovada.",
  started: "Sua ausencia foi iniciada e o cargo configurado foi aplicado.",
  finished: "Sua ausencia foi finalizada e o cargo configurado foi removido."
};

const emptySettings: FivemFacSettings = {
  id: "",
  botId: "",
  guildId: "",
  enabled: false,
  panelChannelId: null,
  panelMessageId: null,
  absenceRoleId: null,
  viewerRoleIds: [],
  approverRoleIds: [],
  logChannelId: null,
  messages: defaultMessages,
  lastPanelRequestedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

export function FacAbsencePanel({ botId, canManage, guild }: FacAbsencePanelProps) {
  const [settings, setSettings] = useState<FivemFacSettings>(emptySettings);
  const [absences, setAbsences] = useState<FivemFacAbsence[]>([]);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canUse = Boolean(botId && guild);
  const assignableRoles = useMemo(() => roles.filter((role) => role.assignable), [roles]);
  const regularRoles = useMemo(() => roles.filter((role) => role.id !== guild?.id), [roles, guild?.id]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!botId || !guild) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setMessage(null);

      const [fac, options] = await Promise.all([
        getFivemFac(guild.id, botId),
        getGuildLiveOptions(guild.id, botId)
      ]);

      if (!mounted) return;

      setSettings(fac.settings);
      setAbsences(fac.absences);
      setChannels(options.channels);
      setRoles(options.roles);
    }

    load()
      .catch((error) => {
        if (mounted) {
          setMessage(readRequestMessage(error) ?? "Nao foi possivel carregar o FAC.");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [botId, guild?.id]);

  function updateSetting<K extends keyof FivemFacSettings>(key: K, value: FivemFacSettings[K]) {
    setSettings((current) => ({
      ...current,
      [key]: value
    }));
  }

  function updateMessage(key: keyof FivemFacMessages, value: string) {
    setSettings((current) => ({
      ...current,
      messages: {
        ...current.messages,
        [key]: value
      }
    }));
  }

  function toggleRole(key: "viewerRoleIds" | "approverRoleIds", roleId: string) {
    setSettings((current) => {
      const selected = new Set(current[key]);

      if (selected.has(roleId)) {
        selected.delete(roleId);
      } else {
        selected.add(roleId);
      }

      return {
        ...current,
        [key]: [...selected]
      };
    });
  }

  async function handleSave() {
    if (!botId || !guild) return;

    setSaving(true);
    setMessage(null);

    try {
      const saved = await saveFivemFacSettings(guild.id, botId, {
        absenceRoleId: settings.absenceRoleId,
        approverRoleIds: settings.approverRoleIds,
        enabled: settings.enabled,
        logChannelId: settings.logChannelId,
        messages: settings.messages,
        panelChannelId: settings.panelChannelId,
        viewerRoleIds: settings.viewerRoleIds
      });
      setSettings(saved);
      setMessage("Configuracao do FAC salva.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel salvar o FAC.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishPanel() {
    if (!botId || !guild) return;

    setPublishing(true);
    setMessage(null);

    try {
      const saved = await publishFivemFacPanel(guild.id, botId);
      setSettings(saved);
      setMessage("Publicacao do painel solicitada ao bot.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel publicar o painel FAC.");
    } finally {
      setPublishing(false);
    }
  }

  if (!canUse) {
    return (
      <Card>
        <CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">
          Selecione um bot e um servidor para configurar o FiveM FAC.
        </CardContent>
      </Card>
    );
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
    <div className="space-y-5">
      {message ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100">
          {message}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <Card className="hover:translate-y-0">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-zinc-300" />
                  FiveM FAC
                </CardTitle>
                <CardDescription>Ausencias para faccoes e organizacoes.</CardDescription>
              </div>
              <Switch
                checked={settings.enabled}
                disabled={!canManage || saving}
                onCheckedChange={(checked) => updateSetting("enabled", checked)}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                disabled={!canManage}
                icon={Hash}
                label="Canal do painel"
                onChange={(value) => updateSetting("panelChannelId", value)}
                options={channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))}
                value={settings.panelChannelId}
              />
              <SelectField
                disabled={!canManage}
                icon={ShieldCheck}
                label="Cargo de ausencia"
                onChange={(value) => updateSetting("absenceRoleId", value)}
                options={assignableRoles.map((role) => ({ label: role.name, value: role.id }))}
                value={settings.absenceRoleId}
              />
              <SelectField
                disabled={!canManage}
                icon={MessageSquareText}
                label="Canal de logs"
                onChange={(value) => updateSetting("logChannelId", value)}
                options={channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))}
                value={settings.logChannelId}
              />
            </div>

            <RoleChecklist
              disabled={!canManage}
              label="Cargos que visualizam canais"
              onToggle={(roleId) => toggleRole("viewerRoleIds", roleId)}
              roles={regularRoles}
              selectedRoleIds={settings.viewerRoleIds}
            />

            <RoleChecklist
              disabled={!canManage}
              label="Cargos aprovadores"
              onToggle={(roleId) => toggleRole("approverRoleIds", roleId)}
              roles={regularRoles}
              selectedRoleIds={settings.approverRoleIds}
            />

            <div className="grid gap-3">
              <TextField disabled={!canManage} label="Titulo do painel" onChange={(value) => updateMessage("panelTitle", value)} value={settings.messages.panelTitle} />
              <TextareaField disabled={!canManage} label="Descricao do painel" onChange={(value) => updateMessage("panelDescription", value)} value={settings.messages.panelDescription} />
              <div className="grid gap-3 md:grid-cols-2">
                <TextField disabled={!canManage} label="Mensagem aprovada" onChange={(value) => updateMessage("approved", value)} value={settings.messages.approved} />
                <TextField disabled={!canManage} label="Mensagem reprovada" onChange={(value) => updateMessage("rejected", value)} value={settings.messages.rejected} />
                <TextField disabled={!canManage} label="Mensagem iniciada" onChange={(value) => updateMessage("started", value)} value={settings.messages.started} />
                <TextField disabled={!canManage} label="Mensagem finalizada" onChange={(value) => updateMessage("finished", value)} value={settings.messages.finished} />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-zinc-900 pt-4">
              <Button disabled={!canManage || saving} onClick={() => void handleSave()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Salvar FAC
              </Button>
              <Button disabled={!canManage || publishing || !settings.enabled || !settings.panelChannelId} onClick={() => void handlePublishPanel()} variant="outline">
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar painel
              </Button>
              {settings.panelMessageId ? <Badge variant="success">Painel publicado</Badge> : <Badge variant="muted">Painel nao publicado</Badge>}
            </div>
          </CardContent>
        </Card>

        <Card className="hover:translate-y-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-zinc-300" />
              Ausencias
            </CardTitle>
            <CardDescription>{absences.length} registro(s) recentes.</CardDescription>
          </CardHeader>
          <CardContent>
            {absences.length ? (
              <div className="space-y-3">
                {absences.map((absence) => (
                  <AbsenceRow absence={absence} key={absence.id} />
                ))}
              </div>
            ) : (
              <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 text-sm text-zinc-500">
                Nenhuma ausencia registrada.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function SelectField({
  disabled,
  icon: Icon,
  label,
  onChange,
  options,
  value
}: {
  disabled: boolean;
  icon: typeof Hash;
  label: string;
  onChange: (value: string | null) => void;
  options: Array<{ label: string; value: string }>;
  value: string | null;
}) {
  return (
    <label className="space-y-2">
      <span className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        <Icon className="h-4 w-4 text-zinc-500" />
        {label}
      </span>
      <select
        className="social-input h-12"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        value={value ?? ""}
      >
        <option value="">Nao selecionado</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function RoleChecklist({
  disabled,
  label,
  onToggle,
  roles,
  selectedRoleIds
}: {
  disabled: boolean;
  label: string;
  onToggle: (roleId: string) => void;
  roles: GuildRoleOption[];
  selectedRoleIds: string[];
}) {
  const selected = new Set(selectedRoleIds);

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        <UserCheck className="h-4 w-4 text-zinc-500" />
        {label}
      </p>
      <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-zinc-900 bg-zinc-950/70 p-3 sm:grid-cols-2">
        {roles.length ? roles.map((role) => (
          <label className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-zinc-300 hover:bg-zinc-900" key={role.id}>
            <input
              checked={selected.has(role.id)}
              disabled={disabled}
              onChange={() => onToggle(role.id)}
              type="checkbox"
            />
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "#71717a" }} />
            <span className="min-w-0 flex-1 truncate">{role.name}</span>
          </label>
        )) : (
          <span className="px-2 py-3 text-sm text-zinc-500">Nenhum cargo disponivel.</span>
        )}
      </div>
    </div>
  );
}

function TextField({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <input className="social-input h-11" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function TextareaField({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <textarea className="social-input min-h-24 resize-y" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function AbsenceRow({ absence }: { absence: FivemFacAbsence }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{absence.username ?? absence.userId}</p>
          <p className="mt-1 truncate text-xs text-zinc-500">{absence.reason}</p>
        </div>
        <Badge variant={statusVariant(absence.status)}>{statusLabel(absence.status)}</Badge>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
        <span>Inicio: {formatDateOnly(absence.startDate)}</span>
        <span>Termino: {formatDateOnly(absence.endDate)}</span>
      </div>
    </div>
  );
}

function statusVariant(status: FivemFacAbsenceStatus) {
  if (status === "active" || status === "approved") return "success";
  if (status === "rejected") return "danger";
  return "muted";
}

function statusLabel(status: FivemFacAbsenceStatus) {
  const labels: Record<FivemFacAbsenceStatus, string> = {
    active: "Ativa",
    approved: "Aprovada",
    closed: "Encerrada",
    finished: "Finalizada",
    pending: "Pendente",
    rejected: "Reprovada"
  };

  return labels[status];
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}
