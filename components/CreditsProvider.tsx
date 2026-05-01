"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

const CREDITS_POLL_INTERVAL_MS = 15000;

type CreditsContextValue = {
  remainingCredits: number;
  loadingCredits: boolean;
  refreshCredits: () => Promise<void>;
  setRemainingCredits: Dispatch<SetStateAction<number>>;
};

const CreditsContext = createContext<CreditsContextValue | null>(null);

export function CreditsProvider({ children }: { children: ReactNode }) {
  const [remainingCredits, setRemainingCredits] = useState(0);
  const [loadingCredits, setLoadingCredits] = useState(true);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const refreshCredits = useCallback(async () => {
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    const refreshPromise = (async () => {
      try {
        const res = await fetch("/api/credits", { cache: "no-store" });
        if (res.status === 401) {
          setRemainingCredits(0);
          return;
        }
        if (!res.ok) return;
        const body = (await res.json()) as { remainingCredits?: number };
        setRemainingCredits(body.remainingCredits ?? 0);
      } finally {
        setLoadingCredits(false);
        refreshInFlight.current = null;
      }
    })();

    refreshInFlight.current = refreshPromise;
    return refreshPromise;
  }, []);

  useEffect(() => {
    void refreshCredits();
  }, [refreshCredits]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshCredits();
      }
    }, CREDITS_POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshCredits();
      }
    };

    window.addEventListener("focus", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshCredits]);

  const value = useMemo(
    () => ({
      remainingCredits,
      loadingCredits,
      refreshCredits,
      setRemainingCredits,
    }),
    [loadingCredits, refreshCredits, remainingCredits]
  );

  return <CreditsContext.Provider value={value}>{children}</CreditsContext.Provider>;
}

export function useCredits() {
  const context = useContext(CreditsContext);
  if (!context) {
    throw new Error("useCredits must be used within a CreditsProvider");
  }
  return context;
}
