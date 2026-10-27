"use client";

import { useCallback } from "react";
import { useSession } from "@/components/auth-gate";
import type { ApiErrorBody } from "@/lib/api-types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

// Authorization headers for the current user. Use this for requests that can't
// go through useApi (streams, uploads).
export function useAuthHeaders() {
  const { getToken } = useSession();
  return useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);
}

// JSON fetch against our API with the user's token attached. Throws ApiError
// with the server's message and code on non-2xx responses.
export function useApi() {
  const authHeaders = useAuthHeaders();
  return useCallback(
    async <T,>(path: string, init: Omit<RequestInit, "body"> & { json?: unknown } = {}): Promise<T> => {
      const { json, headers, ...rest } = init;
      const response = await fetch(path, {
        cache: "no-store",
        ...rest,
        headers: {
          ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(await authHeaders()),
          ...(headers as Record<string, string> | undefined),
        },
        body: json !== undefined ? JSON.stringify(json) : undefined,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
        throw new ApiError(response.status, body?.error ?? `Request failed (${response.status}).`, body?.code);
      }
      return (await response.json()) as T;
    },
    [authHeaders],
  );
}
