import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export type FivemResourceOption = {
  color?: number;
  disabled?: boolean;
  id: string;
  name: string;
};

export function FivemResourceSelect({
  disabled,
  label,
  onChange,
  options,
  placeholder = "Nao configurado",
  prefix = "",
  value
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string | null) => void;
  options: FivemResourceOption[];
  placeholder?: string;
  prefix?: string;
  value: string | null;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterOptions(options, query, value ? [value] : []), [options, query, value]);

  return (
    <label className="grid gap-2 text-xs font-medium text-zinc-400">
      <span>{label}</span>
      {options.length > 8 ? <SearchInput disabled={disabled} onChange={setQuery} value={query} /> : null}
      <select className="h-11 w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-500/60 disabled:opacity-60" disabled={disabled} onChange={(event) => onChange(event.target.value || null)} value={value ?? ""}>
        <option value="">{placeholder}</option>
        {filtered.map((option) => <option disabled={option.disabled} key={option.id} value={option.id}>{prefix}{option.name}</option>)}
      </select>
    </label>
  );
}

export function FivemResourceMultiSelect({ disabled, label, onChange, options, prefix = "", values }: {
  disabled: boolean;
  label: string;
  onChange: (values: string[]) => void;
  options: FivemResourceOption[];
  prefix?: string;
  values: string[];
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterOptions(options, query, values), [options, query, values]);
  const availableIds = filtered.filter((option) => !option.disabled).map((option) => option.id);
  const allVisibleSelected = availableIds.length > 0 && availableIds.every((id) => values.includes(id));

  function toggle(id: string) {
    onChange(values.includes(id) ? values.filter((value) => value !== id) : [...new Set([...values, id])]);
  }

  function toggleVisible() {
    onChange(allVisibleSelected
      ? values.filter((id) => !availableIds.includes(id))
      : [...new Set([...values, ...availableIds])]);
  }

  return (
    <fieldset className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 disabled:opacity-60" disabled={disabled}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <legend className="text-xs font-medium text-zinc-300">{label} <span className="text-zinc-500">({values.length})</span></legend>
        <button className="text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-50" disabled={!availableIds.length || disabled} onClick={toggleVisible} type="button">{allVisibleSelected ? "Desmarcar visiveis" : "Selecionar visiveis"}</button>
      </div>
      <SearchInput disabled={disabled} onChange={setQuery} value={query} />
      <div className="discord-scrollbar mt-2 max-h-44 space-y-1 overflow-y-auto">
        {filtered.length ? filtered.map((option) => (
          <label className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-sm ${option.disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer text-zinc-300 hover:bg-zinc-900"}`} key={option.id}>
            <input checked={values.includes(option.id)} disabled={disabled || option.disabled} onChange={() => toggle(option.id)} type="checkbox" />
            {option.color !== undefined ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: option.color ? `#${option.color.toString(16).padStart(6, "0")}` : "#71717a" }} /> : null}
            <span className="min-w-0 flex-1 truncate">{prefix}{option.name}</span>
          </label>
        )) : <p className="px-2 py-4 text-center text-xs text-zinc-500">Nenhum resultado.</p>}
      </div>
    </fieldset>
  );
}

function SearchInput({ disabled, onChange, value }: { disabled: boolean; onChange: (value: string) => void; value: string }) {
  return <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" /><input className="h-9 w-full rounded-md border border-zinc-800 bg-black pl-9 pr-9 text-xs text-zinc-200 outline-none focus:border-emerald-500/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder="Buscar por nome..." value={value} />{value ? <button className="absolute right-2 top-2 text-zinc-500 hover:text-white" onClick={() => onChange("")} type="button"><X className="h-4 w-4" /></button> : null}</div>;
}

function filterOptions(options: FivemResourceOption[], query: string, selectedIds: string[]) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  if (!normalized) return options;
  return options.filter((option) => selectedIds.includes(option.id) || option.name.toLocaleLowerCase("pt-BR").includes(normalized));
}
