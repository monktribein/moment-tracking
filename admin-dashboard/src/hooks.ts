import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  /** Load again; `silent` keeps the current data on screen while it loads. */
  reload: (silent?: boolean) => void;
  setData: (update: T | ((current: T | undefined) => T)) => void;
}

/** Runs `load` when `deps` change; only the newest call's result is kept. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const ticket = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback((silent = false) => {
    const mine = ++ticket.current;
    if (!silent) setLoading(true);
    loadRef
      .current()
      .then((value) => {
        if (mine !== ticket.current) return;
        setDataState(value);
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine !== ticket.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (mine === ticket.current) setLoading(false);
      });
  }, []);

  useEffect(() => run(), deps); // reruns only when the caller's deps change

  const setData = useCallback((update: T | ((current: T | undefined) => T)) => {
    setDataState((current) =>
      typeof update === "function" ? (update as (c: T | undefined) => T)(current) : update,
    );
  }, []);

  return { data, error, loading, reload: run, setData };
}

/** `value`, updated only after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Calls `fn` every `ms` while the tab is visible. */
export function useInterval(fn: () => void, ms: number): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) ref.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
}
