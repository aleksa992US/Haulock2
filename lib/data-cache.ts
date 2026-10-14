'use client';

import { useEffect, useRef, useState } from 'react';

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
// Every mounted hook for a key hears about new data and invalidations, so
// the sidebar badge and the page showing the same list never disagree.
const listeners = new Map<string, Set<() => void>>();

function emit(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

type FetcherResult<T> = { data: T | null; loading: boolean; refetch: () => void };
type FetchOpts = {
  // Re-fetch on this interval while the tab is visible, and whenever the
  // tab becomes visible again (for live counts like sidebar badges).
  refreshMs?: number;
};

export function useCachedFetch<T>(key: string, url: string | null, opts?: FetchOpts): FetcherResult<T> {
  const initial = key && cache.has(key) ? (cache.get(key) as T) : null;
  const [data, setData] = useState<T | null>(initial);
  const [loading, setLoading] = useState<boolean>(initial == null);
  const urlRef = useRef(url);
  urlRef.current = url;
  const hasData = useRef(initial != null);
  hasData.current = data != null;

  const run = () => {
    const u = urlRef.current;
    if (!u) return;
    let promise = inflight.get(key);
    if (!promise) {
      promise = fetch(u, { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      }).then((j) => {
        cache.set(key, j);
        emit(key);
        return j;
      }).finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, promise);
    }
    if (!hasData.current) setLoading(true); // background refresh keeps showing current data
    promise.then((j) => {
      setData(j as T);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    if (!url) return;
    setData(cache.has(key) ? (cache.get(key) as T) : null);
    const onChange = () => {
      if (cache.has(key)) { setData(cache.get(key) as T); setLoading(false); }
      else run(); // invalidated: fetch fresh (deduped across hooks)
    };
    let set = listeners.get(key);
    if (!set) { set = new Set(); listeners.set(key, set); }
    set.add(onChange);
    run();
    return () => { set!.delete(onChange); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url]);

  const refreshMs = opts?.refreshMs;
  useEffect(() => {
    if (!url || !refreshMs) return;
    const tick = () => { if (document.visibilityState === 'visible') run(); };
    const timer = setInterval(tick, refreshMs);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url, refreshMs]);

  return { data, loading, refetch: run };
}

// Drops the cached copy and makes every mounted hook for these keys fetch
// fresh data, so counts elsewhere on screen update right away.
export function invalidateCache(...keys: string[]) {
  for (const k of keys) {
    cache.delete(k);
    emit(k);
  }
}

export function setCache<T>(key: string, value: T) {
  cache.set(key, value);
  emit(key);
}
