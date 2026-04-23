'use client';

import { useEffect, useState } from 'react';

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

type FetcherResult<T> = { data: T | null; loading: boolean; refetch: () => void };

export function useCachedFetch<T>(key: string, url: string | null): FetcherResult<T> {
  const initial = key && cache.has(key) ? (cache.get(key) as T) : null;
  const [data, setData] = useState<T | null>(initial);
  const [loading, setLoading] = useState<boolean>(initial == null);

  const run = () => {
    if (!url) return;
    let promise = inflight.get(key);
    if (!promise) {
      promise = fetch(url, { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      }).finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, promise);
    }
    setLoading(initial == null);
    promise.then((j) => {
      cache.set(key, j as T);
      setData(j as T);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    if (!url) return;
    setData(cache.has(key) ? (cache.get(key) as T) : null);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url]);

  return { data, loading, refetch: run };
}

export function invalidateCache(...keys: string[]) {
  for (const k of keys) cache.delete(k);
}

export function setCache<T>(key: string, value: T) {
  cache.set(key, value);
}
