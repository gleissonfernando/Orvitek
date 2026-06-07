import { useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { getGuildLiveOptions, patchGuildSettings } from "../../lib/api";
import type { DashboardGuild, GuildRoleOption, GuildSettings } from "../../types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type SiteAccessPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
  loading?: boolean;
  onSettingsChange: (settings: GuildSettings) => void;
  settings: GuildSettings | null;
};

export function SiteAccessPanel({
  botId,
  canManage,
  guild,
  loading = false,
  onSettingsChange,
  settings
}: SiteAccessPanelProps) {
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedRoleIds = settings ? selectedVerificationRoleIds(settings) : [];

  useEffect(() => {
    if (!guild || !canManage) {
      setRoles([]);
      return;
    }

    setLoadingRoles(true);
    getGuildLiveOptions(guild.id, botId)
      .then((options) => setRoles(options.roles.filter((role) => role.id !== guild.id && !role.managed)))
      .catch(() => setRoles([]))
      .finally(() => setLoadingRoles(false));
  }, [botId, canManage, guild]);

  async function saveAccess(payload: Partial<GuildSettings>, successText: string) {
    if (!guild || !settings || !canManage) {
      return;
    }

    setSaving(true);
    setStatus(null);
    setError(null);

    try {
      const nextSettings = await patchGuildSettings(guild.id, payload, botId);
      onSettingsChange(nextSettings);
      setStatus(successText);
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function handleEnabledChange(checked: boolean) {
    if (checked && !selectedRoleIds.length) {
      setError("Selecione primeiro pelo menos um cargo que tera acesso ao site.");
      return;
    }

    void saveAccess(
      {
        verificationEnabled: checked
      },
      checked ? "Acesso por cargo ativado." : "Acesso por cargo desativado."
    );
  }

  function handleRoleToggle(roleId: string, checked: boolean) {
    const nextRoleIds = checked
      ? [...new Set([...selectedRoleIds, roleId])]
      : selectedRoleIds.filter((selectedRoleId) => selectedRoleId !== roleId);

    void saveAccess(
      {
        verificationRoleId: nextRoleIds[0] ?? null,
        verificationRoleIds: nextRoleIds,
        verificationEnabled: Boolean(nextRoleIds.length)
      },
      nextRoleIds.length ? "Cargos de acesso salvos e ativados." : "Cargos de acesso removidos."
    );
  }

  const disabled = !canManage || !settings || loading || loadingRoles || saving;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-black">
              <ShieldCheck className="h-5 w-5 text-zinc-300" />
            </div>
            <div>
              <CardTitle>Acesso ao site por cargo</CardTitle>
              <CardDescription>
                Somente membros com um dos cargos selecionados podem verificar e abrir este painel.
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={Boolean(settings?.verificationEnabled)}
            disabled={disabled}
            onCheckedChange={handleEnabledChange}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-zinc-100">Cargos liberados</span>
            <span className="text-xs text-zinc-500">{selectedRoleIds.length} selecionado(s)</span>
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {loadingRoles ? (
              <p className="flex items-center gap-2 rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando cargos...
              </p>
            ) : roles.length ? (
              roles.map((role) => {
                const checked = selectedRoleIds.includes(role.id);

                return (
                  <label
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-100 transition hover:border-zinc-700 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
                    key={role.id}
                  >
                    <input
                      checked={checked}
                      className="peer sr-only"
                      disabled={disabled}
                      onChange={(event) => handleRoleToggle(role.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-950 text-black transition peer-checked:border-emerald-400 peer-checked:bg-emerald-400">
                      {checked ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">@{role.name}</span>
                  </label>
                );
              })
            ) : (
              <p className="rounded-lg border border-zinc-900 bg-black px-3 py-2 text-sm text-zinc-500">
                Nenhum cargo disponivel.
              </p>
            )}
          </div>
        </div>

        <p className="text-xs leading-5 text-zinc-500">
          Todos os usuarios, incluindo dono e administradores do servidor, precisam possuir pelo menos um cargo escolhido.
          Somente o Dev entra sem cargo. A configuracao vale apenas para este bot e este servidor.
        </p>

        {saving ? (
          <p className="flex items-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Salvando configuracao...
          </p>
        ) : null}
        {status ? <p className="text-xs text-emerald-400">{status}</p> : null}
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function selectedVerificationRoleIds(settings: GuildSettings) {
  const roleIds = settings.verificationRoleIds?.length
    ? settings.verificationRoleIds
    : settings.verificationRoleId
      ? [settings.verificationRoleId]
      : [];

  return [...new Set(roleIds.filter(Boolean))];
}

function readErrorMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return "Nao foi possivel salvar o cargo de acesso.";
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string"
    ? response.data.message
    : "Nao foi possivel salvar o cargo de acesso.";
}
