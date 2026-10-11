import axios, { type AxiosRequestConfig } from "axios";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Audience = "student" | "admin" | "none";

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiFailure {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

const CSRF_COOKIES: Record<"student" | "admin", string> = {
  student: "cq_student_csrf",
  admin: "cq_admin_csrf",
};

/**
 * Absolute API origin. When empty the client talks to the same origin it is
 * served from (the Vite dev proxy forwards `/api` to the backend locally).
 */
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");

/**
 * CSRF tokens captured from the auth session responses. `document.cookie`
 * cannot read cookies set on a different (API) origin in a split deployment,
 * so the session endpoints echo the token and we keep it in memory.
 */
const csrfTokens: Record<"student" | "admin", string | null> = { student: null, admin: null };

export function setCsrfToken(audience: "student" | "admin", token: string | null): void {
  csrfTokens[audience] = token;
}

const http = axios.create({
  baseURL: API_ORIGIN || undefined,
  withCredentials: true,
  headers: { Accept: "application/json" },
});

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]!) : undefined;
}

function resolveAudience(path: string, audience?: Audience): Audience {
  if (audience) return audience;
  return path.startsWith("/api/admin") ? "admin" : "student";
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; audience?: Audience; formData?: FormData } = {},
): Promise<T> {
  const audience = resolveAudience(path, options.audience);
  const config: AxiosRequestConfig = { method, url: path };

  if (options.formData) {
    config.data = options.formData;
  } else if (options.body !== undefined) {
    config.data = options.body;
    config.headers = { "content-type": "application/json" };
  }

  if (method !== "GET" && audience !== "none") {
    const token = csrfTokens[audience] ?? readCookie(CSRF_COOKIES[audience]);
    if (token) config.headers = { ...config.headers, "x-csrf-token": token };
  }

  try {
    const response = await http.request<ApiSuccess<T> | ApiFailure>(config);
    const payload = response.data;
    if (!payload || payload.ok !== true) {
      const error = payload && payload.ok === false ? payload.error : null;
      throw new ApiError(
        error?.code ?? "REQUEST_FAILED",
        error?.message ?? `Request failed with status ${response.status}.`,
        response.status,
        error?.details,
      );
    }
    return payload.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 0;
      const payload = error.response?.data as ApiFailure | undefined;
      const apiError = payload && payload.ok === false ? payload.error : null;
      throw new ApiError(
        apiError?.code ?? "REQUEST_FAILED",
        apiError?.message ?? `Request failed with status ${status || "unknown"}.`,
        status,
        apiError?.details,
      );
    }
    throw error;
  }
}

export const api = {
  get: <T>(path: string, audience?: Audience) => request<T>("GET", path, { audience }),
  post: <T>(path: string, body?: unknown, audience?: Audience) =>
    request<T>("POST", path, { body, audience }),
  patch: <T>(path: string, body?: unknown, audience?: Audience) =>
    request<T>("PATCH", path, { body, audience }),
  put: <T>(path: string, body?: unknown, audience?: Audience) =>
    request<T>("PUT", path, { body, audience }),
  del: <T>(path: string, audience?: Audience) => request<T>("DELETE", path, { audience }),
  upload: <T>(path: string, formData: FormData, audience?: Audience) =>
    request<T>("POST", path, { formData, audience }),
};

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
