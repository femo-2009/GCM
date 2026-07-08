import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

interface LoadingContextValue {
  /** True whenever at least one tracked async operation is in-flight. */
  isLoading: boolean;
  /** Manually increment the loading counter (pair with stopLoading). */
  startLoading: () => void;
  /** Manually decrement the loading counter. */
  stopLoading: () => void;
  /** Wrap any async function/promise so the global loading bar shows while it runs. */
  withLoading: <T,>(fn: () => Promise<T>) => Promise<T>;
}

const LoadingContext = createContext<LoadingContextValue | undefined>(undefined);

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);

  const startLoading = useCallback(() => {
    setCount((c) => c + 1);
  }, []);

  const stopLoading = useCallback(() => {
    setCount((c) => Math.max(0, c - 1));
  }, []);

  const withLoading = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      startLoading();
      try {
        return await fn();
      } finally {
        stopLoading();
      }
    },
    [startLoading, stopLoading]
  );

  const value = useMemo(
    () => ({ isLoading: count > 0, startLoading, stopLoading, withLoading }),
    [count, startLoading, stopLoading, withLoading]
  );

  return <LoadingContext.Provider value={value}>{children}</LoadingContext.Provider>;
}

export function useLoading() {
  const ctx = useContext(LoadingContext);
  if (!ctx) {
    throw new Error('useLoading must be used within a LoadingProvider');
  }
  return ctx;
}
