"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

const USER_KEY = "dryrun.user";

/** The signed-in user id. Auth is header-based for the hackathon build; see README "known limits". */
export function getUserId(): string {
  try {
    return localStorage.getItem(USER_KEY) || "u_engineer";
  } catch {
    return "u_engineer";
  }
}

export function setUserId(id: string) {
  try {
    localStorage.setItem(USER_KEY, id);
  } catch {
    /* storage unavailable — fall back to the default user */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("X-DryRun-User", getUserId());
  let body = init?.body;
  if (init?.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, body });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Small data hook: loading / error / data / reload, with optional polling. */
export function useApi<T>(path: string | null, opts?: { pollMs?: number }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    if (!pathRef.current) return;
    try {
      const d = await api<T>(pathRef.current);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    setLoading(true);
    load();
    if (!opts?.pollMs) return;
    const t = setInterval(load, opts.pollMs);
    return () => clearInterval(t);
  }, [path, opts?.pollMs, load]);

  return { data, error, loading, reload: load, setData };
}

/** Subscribe to a Server-Sent Events stream from the API. */
export function useEventStream<E>(path: string | null, onEvent: (e: E) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!path) return;
    const sep = path.includes("?") ? "&" : "?";
    const es = new EventSource(`${API_URL}${path}${sep}user=${encodeURIComponent(getUserId())}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      try {
        handler.current(JSON.parse(m.data) as E);
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => es.close();
  }, [path]);

  return connected;
}
