"use client";

import { ApiClientError } from "@/lib/http/client";

/** Upload a file as multipart and parse the JSON response. */
export async function uploadFile<T>(url: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(url, {
    method: "POST",
    body: form,
    credentials: "same-origin",
    headers: { "x-request-id": crypto.randomUUID() },
    cache: "no-store",
  });
  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    let code: ApiClientError["code"] = "INTERNAL";
    try {
      const body = await res.json();
      if (body?.error) {
        message = body.error.message ?? message;
        code = body.error.code ?? code;
      }
    } catch {
      /* ignore */
    }
    throw new ApiClientError(code, message, res.status);
  }
  return (await res.json()) as T;
}

/** Fetch a binary export and trigger a browser download. */
export async function downloadExport(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { "x-request-id": crypto.randomUUID() },
    cache: "no-store",
  });
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* ignore */
    }
    throw new ApiClientError("INTERNAL", message, res.status);
  }

  const disposition = res.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^";]+)"?/);
  const name = match ? decodeURIComponent(match[1] as string) : fallbackName;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
