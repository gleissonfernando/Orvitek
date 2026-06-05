import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { useAuth } from "./hooks/useAuth";

export function App() {
  const { auth, error, loading, loginDiscord, logout, verify, verifying } = useAuth();

  useEffect(() => {
    if (auth?.access.verified && window.location.pathname !== "/dashboard") {
      window.history.replaceState(null, "", "/dashboard");
    }
  }, [auth]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (!auth || !auth.access.verified) {
    return <Login auth={auth} error={error} onLoginDiscord={loginDiscord} onLogout={logout} onVerify={verify} verifying={verifying} />;
  }

  return <Dashboard auth={auth} onLogout={logout} />;
}

function LoadingScreen() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0f111a] px-4">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(88,101,242,0.24),rgba(124,58,237,0.20)_38%,rgba(15,17,26,1)_76%)]" />
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="relative flex flex-col items-center rounded-lg border border-white/10 bg-white/[0.07] px-8 py-7 text-center shadow-glow backdrop-blur-2xl"
        initial={{ opacity: 0, y: 14 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <Loader2 className="h-8 w-8 animate-spin text-indigo-200" />
        <p className="mt-4 text-sm font-medium text-white">Carregando painel</p>
        <p className="mt-1 text-xs text-indigo-100/70">Sincronizando sessao Discord</p>
      </motion.div>
    </main>
  );
}
