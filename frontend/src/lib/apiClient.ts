import { cacheAssetResponse, readAssetResponse } from "./offline/assetCache";
import { enqueueMutation } from "./offline/queue";

function readCsrfTokenCookie(): string | undefined {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Asset list-style URLs we serve from IDB when the network fails. Tile and
// PBF endpoints are intentionally excluded — they're handled by the SW
// runtime cache.
const ASSET_CACHE_PATTERNS = [/^\/api\/v1\/assets($|\?)/];

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Sentinel response returned when a mutation is enqueued instead of sent.
 * Status 202 mirrors the HTTP semantic: "accepted, processing later". The
 * `X-FlowOps-Queued` header lets callers detect the offline path so they
 * can render an optimistic state.
 */
function queuedResponse(): Response {
  return new Response(
    JSON.stringify({
      queued: true,
      message: "Saved offline — will sync when you're back online.",
    }),
    {
      status: 202,
      headers: {
        "Content-Type": "application/json",
        "X-FlowOps-Queued": "1",
      },
    },
  );
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function isCacheableAssetGet(method: string, path: string): boolean {
  if (method !== "GET") return false;
  return ASSET_CACHE_PATTERNS.some((re) => re.test(path));
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (MUTATING_METHODS.has(method)) {
    const csrf = readCsrfTokenCookie();
    if (csrf) headers.set("X-CSRFToken", csrf);
  }

  // Offline + mutation → enqueue and return a synthetic 202 so callers
  // can keep flowing. We deliberately don't queue FormData (attachments)
  // because it can't be reliably re-encoded after IDB round-trip; field
  // techs photograph evidence online or wait until reconnect.
  if (
    !isOnline() &&
    MUTATING_METHODS.has(method) &&
    !isFormData &&
    typeof init.body === "string"
  ) {
    await enqueueMutation({
      method: method as "POST" | "PATCH" | "PUT" | "DELETE",
      url: path,
      body: init.body,
      contentType: headers.get("Content-Type"),
    });
    return queuedResponse();
  }

  try {
    const response = await fetch(path, { ...init, headers, credentials: "include" });
    if (response.ok && isCacheableAssetGet(method, path)) {
      // Fire-and-forget cache write so we don't slow the happy path.
      response
        .clone()
        .json()
        .then((payload) => cacheAssetResponse(path, payload))
        .catch(() => {
          /* non-JSON response, ignore */
        });
    }
    return response;
  } catch (err) {
    // Network error on a cacheable read → serve from IDB if we have it.
    if (isCacheableAssetGet(method, path)) {
      const cached = await readAssetResponse(path);
      if (cached !== null) {
        return new Response(JSON.stringify(cached), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-FlowOps-Cache": "idb",
          },
        });
      }
    }
    throw err;
  }
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
