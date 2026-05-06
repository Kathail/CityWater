function readCsrfTokenCookie(): string | undefined {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  // FormData carries its own multipart boundary in Content-Type — let the
  // browser set it. Otherwise default to JSON.
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (MUTATING_METHODS.has(method)) {
    const csrf = readCsrfTokenCookie();
    if (csrf) headers.set("X-CSRFToken", csrf);
  }
  return fetch(path, { ...init, headers, credentials: "include" });
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const errBody = (body ?? {}) as { error?: { code?: string; message?: string } };
    throw new ApiError(
      res.status,
      errBody.error?.code ?? "error",
      errBody.error?.message ?? res.statusText,
    );
  }
  return body as T;
}
