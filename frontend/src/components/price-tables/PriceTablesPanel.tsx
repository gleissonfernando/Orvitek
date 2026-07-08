import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Send, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import {
  createPriceTable,
  deletePriceTableApi,
  getPriceTablesDashboard,
  publishPriceTable,
  updatePriceTable
} from "../../lib/api";
import type { DashboardGuild, PriceTable, PriceTableItem, PriceTableRequest, SavePriceTablePayload } from "../../types";

type Props = {
  botId: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

const emptyItem = (order: number): PriceTableItem => ({
  active: true,
  billingText: null,
  billingType: "one_time",
  description: "",
  highlight: false,
  id: crypto.randomUUID(),
  name: "Novo item",
  order,
  price: 0,
  priceText: null
});

export function PriceTablesPanel({ botId, canManage, guild }: Props) {
  const [tables, setTables] = useState<PriceTable[]>([]);
  const [requests, setRequests] = useState<PriceTableRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SavePriceTablePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selected = useMemo(() => tables.find((table) => table.id === selectedId) ?? null, [selectedId, tables]);
  const preview = { ...selected, ...draft } as PriceTable | null;

  useEffect(() => {
    if (!botId || !guild) return;
    setLoading(true);
    getPriceTablesDashboard(botId, guild.id)
      .then((data) => {
        setTables(data.tables);
        setRequests(data.requests);
        const first = data.tables[0] ?? null;
        setSelectedId(first?.id ?? null);
        setDraft(first ? toPayload(first) : null);
      })
      .catch((error) => setMessage(readError(error, "Nao foi possivel carregar as tabelas.")))
      .finally(() => setLoading(false));
  }, [botId, guild]);

  function selectTable(table: PriceTable) {
    setSelectedId(table.id);
    setDraft(toPayload(table));
    setMessage(null);
  }

  async function createNewTable() {
    if (!botId || !guild) return;
    setSaving(true);
    try {
      const table = await createPriceTable(botId, guild.id, {});
      setTables((current) => [table, ...current]);
      selectTable(table);
      setMessage("Tabela criada.");
    } catch (error) {
      setMessage(readError(error, "Nao foi possivel criar a tabela."));
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (!botId || !guild || !draft) return;
    setSaving(true);
    try {
      const table = selectedId
        ? await updatePriceTable(botId, guild.id, selectedId, draft)
        : await createPriceTable(botId, guild.id, draft);
      setTables((current) => [table, ...current.filter((item) => item.id !== table.id)]);
      setSelectedId(table.id);
      setDraft(toPayload(table));
      setMessage("Tabela salva.");
    } catch (error) {
      setMessage(readError(error, "Nao foi possivel salvar a tabela."));
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected() {
    if (!botId || !guild || !selectedId) return;
    setSaving(true);
    try {
      await deletePriceTableApi(botId, guild.id, selectedId);
      const next = tables.filter((table) => table.id !== selectedId);
      setTables(next);
      setSelectedId(next[0]?.id ?? null);
      setDraft(next[0] ? toPayload(next[0]) : null);
      setMessage("Tabela excluida.");
    } catch (error) {
      setMessage(readError(error, "Nao foi possivel excluir a tabela."));
    } finally {
      setSaving(false);
    }
  }

  async function publishSelected() {
    if (!botId || !guild || !selectedId) return;
    setSaving(true);
    try {
      await saveDraft();
      await publishPriceTable(botId, guild.id, selectedId);
      setMessage("Publicacao enviada ao bot.");
    } catch (error) {
      setMessage(readError(error, "Nao foi possivel publicar a tabela."));
    } finally {
      setSaving(false);
    }
  }

  function patch(patchValue: SavePriceTablePayload) {
    setDraft((current) => ({ ...(current ?? {}), ...patchValue }));
  }

  function patchItem(itemId: string, patchValue: Partial<PriceTableItem>) {
    const items = [...(draft?.items ?? [])].map((item) => item.id === itemId ? { ...item, ...patchValue } : item);
    patch({ items });
  }

  function moveItem(itemId: string, direction: -1 | 1) {
    const items = [...(draft?.items ?? [])].sort((a, b) => a.order - b.order);
    const index = items.findIndex((item) => item.id === itemId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const current = items[index];
    const next = items[target];
    if (!current || !next) return;
    items[index] = next;
    items[target] = current;
    patch({ items: items.map((item, order) => ({ ...item, order })) });
  }

  if (!botId || !guild) {
    return <Card><CardContent className="p-6 text-sm text-zinc-500">Selecione um bot e servidor para gerenciar a tabela de precos.</CardContent></Card>;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Tabela de Preco</CardTitle>
          <CardDescription>{loading ? "Carregando..." : `${tables.length} tabela(s) cadastrada(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" disabled={!canManage || saving} onClick={() => void createNewTable()} type="button"><Plus className="mr-2 h-4 w-4" />Criar nova tabela</Button>
          {tables.map((table) => (
            <button className={`w-full rounded-lg border p-3 text-left text-sm ${selectedId === table.id ? "border-[#FFD500]/50 bg-[#FFD500]/10 text-white" : "border-zinc-800 bg-zinc-950 text-zinc-400"}`} key={table.id} onClick={() => selectTable(table)} type="button">
              <span className="block truncate font-semibold">{table.name}</span>
              <span className="mt-1 block text-xs">{table.isActive ? "Ativa" : "Inativa"} · {table.items.length} item(s)</span>
            </button>
          ))}
          {message ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">{message}</p> : null}
        </CardContent>
      </Card>

      {draft && preview ? (
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card>
            <CardHeader>
              <CardTitle>Editar tabela</CardTitle>
              <CardDescription>Textos, moeda, imagem, canal e itens publicados no painel.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nome da tabela" value={draft.name ?? ""} onChange={(value) => patch({ name: value })} disabled={!canManage} />
                <Field label="Titulo principal" value={draft.title ?? ""} onChange={(value) => patch({ title: value })} disabled={!canManage} />
                <Field label="Canal Discord" value={draft.discordChannelId ?? ""} onChange={(value) => patch({ discordChannelId: value || null })} disabled={!canManage} />
                <Field label="Categoria atendimento" value={draft.supportCategoryId ?? ""} onChange={(value) => patch({ supportCategoryId: value || null })} disabled={!canManage} />
                <Field label="URL do banner" value={draft.imageUrl ?? ""} onChange={(value) => patch({ imageUrl: value || null })} disabled={!canManage} />
                <Field label="Cor destaque" value={draft.color ?? "#FFD500"} onChange={(value) => patch({ color: value })} disabled={!canManage} />
              </div>
              <Textarea label="Descricao" value={draft.description ?? ""} onChange={(value) => patch({ description: value })} disabled={!canManage} />
              <Textarea label="Observacoes" value={draft.footerText ?? ""} onChange={(value) => patch({ footerText: value })} disabled={!canManage} />
              <div className="grid gap-3 md:grid-cols-4">
                <Select label="Moeda" value={draft.currency ?? "BRL"} onChange={(value) => patch({ currency: value as PriceTable["currency"] })} options={["BRL", "USD", "EUR", "CUSTOM"]} disabled={!canManage} />
                <Select label="Imagem" value={draft.imagePosition ?? "top"} onChange={(value) => patch({ imagePosition: value as PriceTable["imagePosition"] })} options={["top", "bottom", "thumbnail", "none"]} disabled={!canManage} />
                <Field label="Botao orcamento" value={draft.buttonText?.quote ?? ""} onChange={(value) => patch({ buttonText: { ...(draft.buttonText ?? preview.buttonText), quote: value } })} disabled={!canManage} />
                <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3">
                  <span className="text-sm text-zinc-300">Ativa</span>
                  <Switch checked={draft.isActive ?? true} disabled={!canManage} onCheckedChange={(checked) => patch({ isActive: checked })} />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">Itens da tabela</h3>
                  <Button disabled={!canManage} onClick={() => patch({ items: [...(draft.items ?? []), emptyItem(draft.items?.length ?? 0)] })} size="sm" type="button"><Plus className="mr-2 h-4 w-4" />Adicionar</Button>
                </div>
                {(draft.items ?? []).sort((a, b) => a.order - b.order).map((item) => (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3" key={item.id}>
                    <div className="grid gap-3 md:grid-cols-[1fr_120px_140px_auto]">
                      <Field label="Nome" value={item.name} onChange={(value) => patchItem(item.id, { name: value })} disabled={!canManage} />
                      <Field label="Valor" type="number" value={String(item.price)} onChange={(value) => patchItem(item.id, { price: Number(value) })} disabled={!canManage} />
                      <Select label="Cobranca" value={item.billingType} onChange={(value) => patchItem(item.id, { billingType: value as PriceTableItem["billingType"] })} options={["one_time", "monthly", "weekly", "custom"]} disabled={!canManage} />
                      <div className="flex items-end gap-2">
                        <IconButton disabled={!canManage} icon={ArrowUp} onClick={() => moveItem(item.id, -1)} />
                        <IconButton disabled={!canManage} icon={ArrowDown} onClick={() => moveItem(item.id, 1)} />
                        <IconButton disabled={!canManage} icon={Trash2} onClick={() => patch({ items: (draft.items ?? []).filter((current) => current.id !== item.id).map((current, order) => ({ ...current, order })) })} />
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_140px_120px_120px]">
                      <Field label="Descricao curta" value={item.description ?? ""} onChange={(value) => patchItem(item.id, { description: value })} disabled={!canManage} />
                      <Field label="Texto valor" value={item.priceText ?? ""} onChange={(value) => patchItem(item.id, { priceText: value || null })} disabled={!canManage} />
                      <Toggle label="Destaque" checked={item.highlight} disabled={!canManage} onChange={(checked) => patchItem(item.id, { highlight: checked })} />
                      <Toggle label="Ativo" checked={item.active} disabled={!canManage} onChange={(checked) => patchItem(item.id, { active: checked })} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button disabled={!canManage || saving} onClick={() => void saveDraft()} type="button"><Save className="mr-2 h-4 w-4" />Salvar</Button>
                <Button disabled={!canManage || saving || !selectedId} onClick={() => void publishSelected()} type="button" variant="secondary"><Send className="mr-2 h-4 w-4" />Publicar no Discord</Button>
                <Button disabled={!canManage || saving || !selectedId} onClick={() => void removeSelected()} type="button" variant="destructive"><Trash2 className="mr-2 h-4 w-4" />Excluir</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pre-visualizacao</CardTitle>
              <CardDescription>{preview.discordChannelId ? `Canal ${preview.discordChannelId}` : "Canal nao configurado"}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                {preview.imageUrl && preview.imagePosition !== "none" ? <img alt="" className="h-36 w-full object-cover" src={preview.imageUrl} /> : null}
                <div className="space-y-4 p-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">{preview.title}</h3>
                    <p className="mt-1 text-sm text-zinc-400">{preview.description}</p>
                  </div>
                  <div className="space-y-2">
                    {preview.items.filter((item) => item.active).sort((a, b) => a.order - b.order).map((item) => (
                      <div className={`rounded-lg border p-3 ${item.highlight ? "border-[#FFD500]/40 bg-[#FFD500]/10" : "border-zinc-800 bg-zinc-900/60"}`} key={item.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{item.name}</p>
                            <p className="mt-1 text-xs text-zinc-500">{item.description}</p>
                          </div>
                          <p className="shrink-0 text-sm font-bold text-emerald-300">{formatPrice(preview, item)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {preview.footerText ? <p className="text-xs text-zinc-500">{preview.footerText}</p> : null}
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <h3 className="text-sm font-semibold text-white">Solicitacoes recentes</h3>
                {requests.slice(0, 5).map((request) => <p className="rounded-lg bg-zinc-950 p-3 text-xs text-zinc-400" key={request.id}>{request.userName} pediu {request.itemName}</p>)}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card><CardContent className="p-6 text-sm text-zinc-500">Crie uma tabela para comecar.</CardContent></Card>
      )}
    </div>
  );
}

function Field({ disabled, label, onChange, type = "text", value }: { disabled?: boolean; label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<input className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} type={type} value={value} /></label>;
}

function Textarea({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<textarea className="mt-1 min-h-24 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function Select({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<select className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <div className="flex h-10 items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3"><span className="text-xs text-zinc-400">{label}</span><Switch checked={checked} disabled={disabled} onCheckedChange={onChange} /></div>;
}

function IconButton({ disabled, icon: Icon, onClick }: { disabled?: boolean; icon: typeof ArrowUp; onClick: () => void }) {
  return <button className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition hover:border-[#FFD500]/40 hover:text-white disabled:opacity-50" disabled={disabled} onClick={onClick} type="button"><Icon className="h-4 w-4" /></button>;
}

function toPayload(table: PriceTable): SavePriceTablePayload {
  const { botId: _botId, createdAt: _createdAt, createdBy: _createdBy, guildId: _guildId, id: _id, messageId: _messageId, updatedAt: _updatedAt, updatedBy: _updatedBy, ...payload } = table;
  return payload;
}

function formatPrice(table: PriceTable, item: PriceTableItem) {
  if (item.priceText) return item.priceText;
  if (table.currency === "BRL") return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(item.price);
  if (table.currency === "USD") return new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" }).format(item.price);
  if (table.currency === "EUR") return new Intl.NumberFormat("de-DE", { currency: "EUR", style: "currency" }).format(item.price);
  return `${table.currencyFormat}${item.price.toFixed(2)}`;
}

function readError(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
