import { AlertCircle, Bot, CheckCircle2, Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { getBotRegistrationStatus, verifyAndRegisterBot } from "../lib/api";
import type { BotCredential, PlanSubscription, PlanWorkspace } from "../types";

type RegistrationStatus = {
  activeSubscription: PlanSubscription | null;
  canRegister: boolean;
  dashboardBaseUrl: string;
  message: string | null;
  workspace: PlanWorkspace | null;
};

export function BotRegistrationPage() {
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [guildId, setGuildId] = useState("");
  const [slug, setSlug] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{ bot: BotCredential; dashboardUrl: string; server: { iconUrl: string | null; id: string; name: string } } | null>(null);

  useEffect(() => {
    getBotRegistrationStatus()
      .then(setStatus)
      .catch((requestError) => {
        const response = requestError as { response?: { status?: number } };
        if (response.response?.status === 401 || response.response?.status === 403) {
          window.location.assign("/auth/discord/dashboard");
          return;
        }
        setError(readError(requestError, "Nao foi possivel carregar sua assinatura."));
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verifying) return;
    setError(null);
    setVerifying(true);

    try {
      const next = await verifyAndRegisterBot({ guildId, slug: slug || null, token });
      setToken("");
      setResult(next);
    } catch (requestError) {
      setError(readError(requestError, "Nao foi possivel verificar o bot."));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4">
          <a className="flex items-center gap-2 text-[#FFD500]" href="/planos"><span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#FFD500]/30 bg-[#FFD500]/10"><Bot className="h-5 w-5" /></span><strong className="text-xl">Nex Tech</strong></a>
          <a className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-[#FFD500]/40" href="/planos">Planos</a>
        </header>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1fr_24rem]">
          <div className="rounded-lg border border-[#FFD500]/20 bg-[#111113]/95 p-6 shadow-[0_18px_70px_rgba(0,0,0,0.36)]">
            <span className="inline-flex items-center gap-2 rounded-lg border border-[#FFD500]/20 bg-[#FFD500]/10 px-3 py-1 text-sm font-bold text-[#FFEA70]"><ShieldCheck className="h-4 w-4" />Cadastre o seu bot</span>
            <h1 className="mt-5 text-3xl font-black tracking-tight sm:text-4xl">Valide o bot e gere sua dashboard individual</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">O token e validado apenas no backend, criptografado antes de salvar e nunca volta para o navegador.</p>

            {loading ? <div className="mt-8 flex items-center gap-2 text-sm text-zinc-300"><Loader2 className="h-4 w-4 animate-spin text-[#FFD500]" />Carregando assinatura...</div> : null}
            {error ? <Alert tone="error" message={error} /> : null}

            {!loading && status && !status.canRegister && !result ? (
              <div className="mt-8 rounded-lg border border-zinc-800 bg-black/25 p-5">
                <p className="font-semibold text-white">{status.message ?? "Nenhum plano aprovado foi encontrado para sua conta."}</p>
                <a className="mt-4 inline-flex h-11 items-center justify-center rounded-lg bg-[#FFD500] px-4 text-sm font-bold text-black" href="/planos">Voltar aos planos</a>
              </div>
            ) : null}

            {!loading && status?.canRegister && !result ? (
              <form className="mt-8 grid gap-4" onSubmit={handleSubmit}>
                <label className="grid gap-1 text-sm">
                  <span className="text-zinc-300">Token do bot</span>
                  <div className="flex rounded-lg border border-zinc-800 bg-black focus-within:border-[#FFD500]/50">
                    <input autoComplete="off" className="h-12 min-w-0 flex-1 bg-transparent px-3 text-white outline-none" onChange={(event) => setToken(event.target.value)} type={showToken ? "text" : "password"} value={token} />
                    <button className="flex w-12 items-center justify-center text-zinc-400 hover:text-[#FFD500]" onClick={() => setShowToken((value) => !value)} type="button" title={showToken ? "Ocultar token" : "Mostrar token"}>
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-zinc-300">ID do servidor</span>
                  <input className="h-12 rounded-lg border border-zinc-800 bg-black px-3 text-white outline-none focus:border-[#FFD500]/50" inputMode="numeric" onChange={(event) => setGuildId(event.target.value.replace(/\D/g, ""))} value={guildId} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-zinc-300">Nome da URL</span>
                  <input className="h-12 rounded-lg border border-zinc-800 bg-black px-3 text-white outline-none focus:border-[#FFD500]/50" onChange={(event) => setSlug(event.target.value)} placeholder="meu-bot" value={slug} />
                </label>
                <button className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#FFD500] px-4 text-sm font-bold text-black transition hover:bg-[#FFEA70] disabled:cursor-not-allowed disabled:opacity-70" disabled={verifying || !token || !guildId} type="submit">
                  {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  {verifying ? "Verificando bot..." : "Verificar"}
                </button>
              </form>
            ) : null}

            {result ? (
              <div className="mt-8 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-5">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-emerald-300" />
                  <div>
                    <p className="font-bold text-emerald-100">Bot cadastrado com sucesso</p>
                    <p className="text-sm text-emerald-100/75">Token configurado com segurança</p>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <SummaryCard image={result.bot.avatarUrl ?? null} label="Bot" title={result.bot.botName} />
                  <SummaryCard image={result.server.iconUrl} label="Servidor" title={result.server.name} />
                </div>
                <a className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-[#FFD500] px-4 text-sm font-bold text-black" href={result.dashboardUrl}>Acessar minha dashboard</a>
              </div>
            ) : null}
          </div>

          <aside className="rounded-lg border border-zinc-800 bg-[#101013] p-5">
            <p className="text-sm font-bold uppercase text-zinc-500">Assinatura</p>
            <p className="mt-3 text-xl font-black text-white">{status?.activeSubscription?.plan?.name ?? "Aguardando plano"}</p>
            <p className="mt-2 text-sm text-zinc-400">{status?.workspace ? `${status.workspace.botCount} de ${status.activeSubscription?.botLimit ?? 0} bots usados` : "Faça login com a conta Discord usada no checkout."}</p>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Alert({ message, tone }: { message: string; tone: "error" }) {
  return <div className="mt-5 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"><AlertCircle className="h-4 w-4" />{message}</div>;
}

function SummaryCard({ image, label, title }: { image: string | null; label: string; title: string }) {
  return <div className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-800 bg-black/25 p-3">{image ? <img alt="" className="h-10 w-10 rounded-lg" src={image} /> : <div className="h-10 w-10 rounded-lg bg-zinc-800" />}<div className="min-w-0"><p className="text-xs font-bold uppercase text-zinc-500">{label}</p><p className="truncate text-sm font-semibold text-white">{title}</p></div></div>;
}

function readError(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { message?: string } }; message?: string };
  return candidate.response?.data?.message || candidate.message || fallback;
}
