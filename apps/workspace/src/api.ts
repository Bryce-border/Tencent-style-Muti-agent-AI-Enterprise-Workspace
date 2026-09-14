import { useCallback, useEffect, useRef, useState } from "react";

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      "X-Workspace-Request": "1",
      ...options.headers,
    },
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("workspace-session-expired"));
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      typeof payload.detail === "string"
        ? payload.detail
        : `请求失败 (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}

export function useResource<T>(path: string, interval = 0) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
  }>({ loading: true });
  const [revision, setRevision] = useState(0);
  const lastPath = useRef(path);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    if (lastPath.current !== path) setState({ loading: true });
    lastPath.current = path;
    async function read() {
      try {
        const data = await api<T>(path, { signal: controller.signal });
        if (!stopped) setState({ data, loading: false });
      } catch (error) {
        if (!stopped)
          setState((previous) => ({
            ...previous,
            error: String(error),
            loading: false,
          }));
      } finally {
        if (!stopped && interval) timer = setTimeout(read, interval);
      }
    }
    void read();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, interval, revision]);
  return { ...state, reload };
}
