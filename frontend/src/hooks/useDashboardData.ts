import { useCallback, useEffect, useRef, useState } from "react";
import { useCachedData, deduplicatedFetch, apiCache } from "../lib/cache";
import { useDebouncedValue } from "./usePerformance";

/**
 * Hook otimizado para gerenciar dados da dashboard
 * Combina cache, deduplicação, debounce e lazy loading
 */
export function useDashboardData() {
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);

  // Debounce para evitar requisições enquanto usuário escolhe
  const debouncedBotId = useDebouncedValue(selectedBotId, 200);
  const debouncedGuildId = useDebouncedValue(selectedGuildId, 200);

  // Cache de dados principais
  const botsCache = useRef(new Map());
  const guildsCache = useRef(new Map());
  const settingsCache = useRef(new Map());

  // Invalidar cache quando necessário
  const invalidateCache = useCallback((key: string) => {
    apiCache.delete(key);
    botsCache.current.delete(key);
    guildsCache.current.delete(key);
    settingsCache.current.delete(key);
  }, []);

  // Invalidar tudo
  const invalidateAll = useCallback(() => {
    apiCache.clear();
    botsCache.current.clear();
    guildsCache.current.clear();
    settingsCache.current.clear();
  }, []);

  return {
    selectedBotId,
    setSelectedBotId,
    selectedGuildId,
    setSelectedGuildId,
    debouncedBotId,
    debouncedGuildId,
    invalidateCache,
    invalidateAll
  };
}

/**
 * Hook para carregar dados de bot com cache
 */
export function useBotData(botId: string | null, enabled = true) {
  return useCachedData(
    `bot:${botId}`,
    async () => {
      if (!botId) return null;
      return deduplicatedFetch(`bot:${botId}`, async () => {
        // Simular chamada à API
        return null;
      });
    },
    60000 // Cache por 1 minuto
  );
}

/**
 * Hook para carregar configurações de guild com cache
 */
export function useGuildSettings(guildId: string | null, botId: string | null) {
  return useCachedData(
    `guild:${guildId}:bot:${botId}:settings`,
    async () => {
      if (!guildId || !botId) return null;
      return deduplicatedFetch(
        `guild:${guildId}:bot:${botId}:settings`,
        async () => {
          // Simular chamada à API
          return null;
        }
      );
    },
    90000 // Cache por 1.5 minutos
  );
}

/**
 * Hook para batch loading de múltiplos dados
 * Carrega em paralelo e deduplica automaticamente
 */
export function useBatchDashboardData(
  botId: string | null,
  guildId: string | null,
  enabled = true
) {
  const [allData, setAllData] = useState<{
    bot: unknown;
    guild: unknown;
    settings: unknown;
    loading: boolean;
    error: Error | null;
  }>({
    bot: null,
    guild: null,
    settings: null,
    loading: enabled,
    error: null
  });

  useEffect(() => {
    if (!enabled || !botId || !guildId) {
      setAllData((prev) => ({ ...prev, loading: false }));
      return;
    }

    let mounted = true;
    setAllData((prev) => ({ ...prev, loading: true, error: null }));

    // Batch load com Promise.allSettled
    Promise.allSettled([
      deduplicatedFetch(`bot:${botId}`, async () => null),
      deduplicatedFetch(`guild:${guildId}`, async () => null),
      deduplicatedFetch(`guild:${guildId}:bot:${botId}:settings`, async () => null)
    ])
      .then(([botResult, guildResult, settingsResult]) => {
        if (!mounted) return;

        setAllData({
          bot: botResult.status === "fulfilled" ? botResult.value : null,
          guild: guildResult.status === "fulfilled" ? guildResult.value : null,
          settings: settingsResult.status === "fulfilled" ? settingsResult.value : null,
          loading: false,
          error: botResult.status === "rejected" ? botResult.reason : null
        });
      });

    return () => {
      mounted = false;
    };
  }, [botId, guildId, enabled]);

  return allData;
}
