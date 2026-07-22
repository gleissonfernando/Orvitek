import { useEffect, useMemo, useState } from "react";
import { CreditCard, Plug, QrCode, Save, Trash2 } from "lucide-react";
import {
  deletePaymentGatewayProvider,
  getPaymentGatewayDashboard,
  savePaymentGatewayProvider,
  testPaymentGatewayProvider
} from "../../lib/api";
import type {
  DashboardGuild,
  NexTechSalesDashboard,
  NexTechSalesPaymentProvider,
  SaveNexTechPaymentProviderPayload
} from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type Props = {
  botId: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

const defaultForm: SaveNexTechPaymentProviderPayload = {
  clientId: "",
  clientSecret: "",
  enabled: true,
  environment: "production",
  id: null,
  instructions: "",
  label: "Mercado Pago",
  provider: "mercadopago",
  publicKey: "",
  secret: "",
  webhookSecret: "",
  webhookUrl: ""
};

const gatewayOptions = [
  { description: "Checkout com Pix e cartão pelo Mercado Pago.", label: "Mercado Pago", provider: "mercadopago" as const },
  { description: "Checkout e Pix pela API oficial do PagBank.", label: "PagBank", provider: "pagbank" as const }
];

export function PaymentGatewayPanel({ botId, canManage, guild }: Props) {
  const [dashboard, setDashboard] = useState<NexTechSalesDashboard | null>(null);
  const [form, setForm] = useState<SaveNexTechPaymentProviderPayload>(defaultForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const providers = useMemo(
    () => dashboard?.settings.paymentProviders.filter((provider) => provider.provider === "mercadopago" || provider.provider === "pagbank") ?? [],
    [dashboard]
  );
  const selectedProvider = providers.find((provider) => provider.id === form.id)
    ?? providers.find((provider) => provider.provider === form.provider)
    ?? providers[0]
    ?? null;

  useEffect(() => {
    if (!botId || !guild) return;
    setLoading(true);
    getPaymentGatewayDashboard(guild.id, botId)
      .then((data) => {
        const provider = data.settings.paymentProviders.find((item) => item.enabled && (item.provider === "mercadopago" || item.provider === "pagbank"))
          ?? data.settings.paymentProviders.find((item) => item.provider === "mercadopago" || item.provider === "pagbank")
          ?? null;
        setDashboard(data);
        setForm(provider ? providerToForm(provider) : defaultForm);
      })
      .catch((error) => setMessage(readError(error, "Não foi possível carregar o pagamento automático.")))
      .finally(() => setLoading(false));
  }, [botId, guild]);

  async function save() {
    if (!botId || !guild || !canManage) return;
    setSaving(true);
    setMessage(null);
    try {
      const settings = await savePaymentGatewayProvider(guild.id, botId, form);
      setDashboard((current) => current ? { ...current, settings } : current);
      const provider = settings.paymentProviders.find((item) => item.provider === form.provider && item.label === form.label)
        ?? settings.paymentProviders.find((item) => item.provider === form.provider)
        ?? null;
      setForm(provider ? providerToForm(provider) : defaultForm);
      setMessage("Pagamento automático salvo.");
    } catch (error) {
      setMessage(readError(error, "Não foi possível salvar o pagamento automático."));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!botId || !guild || !canManage) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await testPaymentGatewayProvider(guild.id, botId, form);
      setMessage(`${providerLabel(form.provider)} online: ${result.account.email ?? result.account.name ?? result.account.id ?? "conta validada"}.`);
    } catch (error) {
      setMessage(readError(error, `Não foi possível testar ${providerLabel(form.provider)}.`));
    } finally {
      setSaving(false);
    }
  }

  async function remove(providerId: string) {
    if (!botId || !guild || !canManage) return;
    setSaving(true);
    setMessage(null);
    try {
      const settings = await deletePaymentGatewayProvider(guild.id, botId, providerId);
      setDashboard((current) => current ? { ...current, settings } : current);
      setForm(defaultForm);
      setMessage("Pagamento automático removido.");
    } catch (error) {
      setMessage(readError(error, "Não foi possível remover o pagamento automático."));
    } finally {
      setSaving(false);
    }
  }

  if (!botId || !guild) {
    return <Card><CardContent className="p-6 text-sm text-zinc-500">Selecione um bot e servidor para configurar o pagamento automático.</CardContent></Card>;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-yellow-300" /> Gateway de Pagamentos</CardTitle>
          <CardDescription>Escolha um gateway ativo por vez. Ao ativar Mercado Pago, o PagBank é desativado; ao ativar PagBank, o Mercado Pago é desativado.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {message ? <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm font-semibold text-yellow-100">{message}</div> : null}
          {providers.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {providers.map((provider) => (
                <button
                  className={`rounded-lg border p-3 text-left text-sm transition ${provider.id === form.id ? "border-yellow-400 bg-yellow-500/10 text-white" : "border-zinc-800 bg-black/20 text-zinc-300 hover:border-zinc-600"}`}
                  key={provider.id}
                  onClick={() => setForm(providerToForm(provider))}
                  type="button"
                >
                  <span className="block font-bold">{provider.label}</span>
                  <span className="mt-1 block text-xs text-zinc-500">
                    {provider.enabled ? "Ativo" : "Desativado"} • {provider.environment} • {provider.connectionStatus}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            {gatewayOptions.map((option) => {
              const active = form.provider === option.provider;
              return (
                <button
                  className={`rounded-lg border p-4 text-left transition ${active ? "border-yellow-400 bg-yellow-500/10 text-white" : "border-zinc-800 bg-black/20 text-zinc-300 hover:border-zinc-600"}`}
                  disabled={!canManage || loading}
                  key={option.provider}
                  onClick={() => {
                    const savedProvider = providers.find((provider) => provider.provider === option.provider) ?? null;
                    setForm(savedProvider ? providerToForm(savedProvider) : {
                      ...defaultForm,
                      label: option.label,
                      provider: option.provider
                    });
                  }}
                  type="button"
                >
                  <span className="flex items-center gap-2 font-bold">
                    {option.provider === "pagbank" ? <QrCode className="h-4 w-4 text-yellow-300" /> : <CreditCard className="h-4 w-4 text-yellow-300" />}
                    {option.label}
                  </span>
                  <span className="mt-2 block text-xs text-zinc-500">{option.description}</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field disabled={!canManage || loading} label="Nome da configuração" value={form.label} onChange={(value) => setForm((current) => ({ ...current, label: value }))} />
            <label className="grid gap-2 text-sm font-semibold text-zinc-300">
              Ambiente
              <select
                className="h-11 rounded-lg border border-zinc-800 bg-black/40 px-3 text-sm text-white outline-none"
                disabled={!canManage || loading}
                onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value as "production" | "sandbox" }))}
                value={form.environment}
              >
                <option value="production">Produção</option>
                <option value="sandbox">Sandbox</option>
              </select>
            </label>
            <Field disabled={!canManage || loading} label="Public Key" value={form.publicKey ?? ""} onChange={(value) => setForm((current) => ({ ...current, publicKey: value }))} />
            <Field disabled={!canManage || loading} label={selectedProvider?.secretConfigured ? `${secretLabel(form.provider)} novo (opcional)` : secretLabel(form.provider)} type="password" value={form.secret ?? ""} onChange={(value) => setForm((current) => ({ ...current, secret: value }))} />
            <Field disabled={!canManage || loading} label="Client ID" value={form.clientId ?? ""} onChange={(value) => setForm((current) => ({ ...current, clientId: value }))} />
            <Field disabled={!canManage || loading} label="Client Secret" type="password" value={form.clientSecret ?? ""} onChange={(value) => setForm((current) => ({ ...current, clientSecret: value }))} />
            <Field disabled={!canManage || loading} label="Webhook URL" value={form.webhookUrl ?? ""} onChange={(value) => setForm((current) => ({ ...current, webhookUrl: value }))} />
            <Field disabled={!canManage || loading} label={selectedProvider?.webhookSecretConfigured ? "Webhook Secret novo (opcional)" : "Webhook Secret"} type="password" value={form.webhookSecret ?? ""} onChange={(value) => setForm((current) => ({ ...current, webhookSecret: value }))} />
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black/20 p-3 text-sm font-semibold text-zinc-200">
            Gateway automático ativo
            <Switch checked={Boolean(form.enabled)} disabled={!canManage || loading} onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))} />
          </label>

          <label className="grid gap-2 text-sm font-semibold text-zinc-300">
            Instruções do checkout
            <textarea
              className="min-h-24 rounded-lg border border-zinc-800 bg-black/40 p-3 text-sm text-white outline-none"
              disabled={!canManage || loading}
              onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))}
              value={form.instructions ?? ""}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!canManage || saving || loading} onClick={save}><Save className="mr-2 h-4 w-4" /> Salvar gateway</Button>
            <Button disabled={!canManage || saving || loading} onClick={test} variant="outline"><Plug className="mr-2 h-4 w-4" /> Testar {providerLabel(form.provider)}</Button>
            {form.id ? (
              <Button disabled={!canManage || saving || loading} onClick={() => remove(String(form.id))} variant="outline"><Trash2 className="mr-2 h-4 w-4" /> Remover</Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function providerToForm(provider: NexTechSalesPaymentProvider): SaveNexTechPaymentProviderPayload {
  return {
    clientId: provider.clientId ?? "",
    clientSecret: "",
    enabled: provider.enabled,
    environment: provider.environment,
    id: provider.id,
    instructions: provider.instructions ?? "",
    label: provider.label,
    provider: provider.provider,
    publicKey: provider.publicKey ?? "",
    secret: "",
    webhookSecret: "",
    webhookUrl: provider.webhookUrl ?? ""
  };
}

function providerLabel(provider: SaveNexTechPaymentProviderPayload["provider"]) {
  return provider === "pagbank" ? "PagBank" : "Mercado Pago";
}

function secretLabel(provider: SaveNexTechPaymentProviderPayload["provider"]) {
  return provider === "pagbank" ? "Token PagBank" : "Access Token";
}

function Field({ disabled, label, onChange, type = "text", value }: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-zinc-300">
      {label}
      <input
        className="h-11 rounded-lg border border-zinc-800 bg-black/40 px-3 text-sm text-white outline-none"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function readError(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
