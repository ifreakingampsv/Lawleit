import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/data";
import type { Session } from "@/lib/data";

/** Tiny async-data hook: load once, expose refetch. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const refetch = useCallback(() => {
    setLoading(true);
    fn()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e as Error))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, error, refetch, setData };
}

export function useSession() {
  return useAsync<Session | null>(() => api.getSession(), []);
}

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 });

export const hours = (minutes: number) => (minutes / 60).toFixed(1);

export const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
