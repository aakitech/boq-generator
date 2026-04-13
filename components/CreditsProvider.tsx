"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

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

  const refreshCredits = useCallback(async () => {
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
    }
  }, []);

  useEffect(() => {
    void refreshCredits();
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
