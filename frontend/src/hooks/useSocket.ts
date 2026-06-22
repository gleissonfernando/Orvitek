import { useEffect, useCallback, useRef } from "react";
import type { Socket } from "socket.io-client";

/**
 * Hook otimizado para socket listeners
 * Evita listeners duplicadas e garante cleanup
 */
export function useSocketListener<T>(
  socket: Socket | null,
  event: string,
  handler: (data: T) => void,
  enabled = true
) {
  const handlerRef = useRef(handler);

  // Atualiza ref sem re-registrar listener
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!socket || !enabled) return;

    const wrappedHandler = (data: T) => handlerRef.current(data);
    
    // Remove listener antigo se existir (evita duplicatas)
    socket.off(event, wrappedHandler);
    socket.on(event, wrappedHandler);

    return () => {
      socket.off(event, wrappedHandler);
    };
  }, [socket, event, enabled]);
}

/**
 * Hook para múltiplos listeners de uma vez
 */
export function useSocketListeners(
  socket: Socket | null,
  listeners: Array<{
    event: string;
    handler: (data: unknown) => void;
  }>,
  enabled = true
) {
  const handlersRef = useRef<Map<string, (data: unknown) => void>>(new Map());

  useEffect(() => {
    // Atualiza todos os handlers
    listeners.forEach(({ event, handler }) => {
      handlersRef.current.set(event, handler);
    });
  }, [listeners]);

  useEffect(() => {
    if (!socket || !enabled) return;

    const eventMap = new Map<string, (data: unknown) => void>();

    listeners.forEach(({ event }) => {
      const handler = (data: unknown) => {
        const h = handlersRef.current.get(event);
        if (h) h(data);
      };

      eventMap.set(event, handler);
      socket.off(event);
      socket.on(event, handler);
    });

    return () => {
      eventMap.forEach((handler, event) => {
        socket.off(event, handler);
      });
    };
  }, [socket, listeners.length, enabled]);
}

/**
 * Hook para emitir eventos com debounce
 */
export function useSocketEmit(socket: Socket | null) {
  return useCallback(
    (event: string, data?: unknown, callback?: () => void) => {
      if (!socket) return;
      socket.emit(event, data, callback);
    },
    [socket]
  );
}
