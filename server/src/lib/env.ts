/**
 * Centralised, lazily-validated server environment access.
 *
 * Values are read on demand so that commands which do not touch the database
 * do not fail simply because a variable is absent. Any attempt to actually use
 * a missing required variable throws a clear, actionable error.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Copy .env.example to .env and provide a value.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback = ""): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function bool(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const env = {
  get port(): number {
    return int("PORT", 5000);
  },
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  get jwtSecret(): string {
    const secret = required("JWT_SECRET");
    if (secret.length < 16) {
      throw new Error("JWT_SECRET must be at least 16 characters long.");
    }
    return secret;
  },
  /** Alias kept for compatibility with the shared service layer. */
  get appSecret(): string {
    return this.jwtSecret;
  },
  get frontendUrl(): string {
    return (
      optional("FRONTEND_URL") ||
      optional("URL") ||
      optional("DEPLOY_PRIME_URL") ||
      "http://localhost:5173"
    ).replace(/\/$/, "");
  },
  get corsOrigins(): string[] {
    const extra = optional("CORS_ORIGINS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return [this.frontendUrl, ...extra].filter((value, index, all) => all.indexOf(value) === index);
  },
  get supabaseUrl(): string {
    return optional("SUPABASE_URL") || optional("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseServiceRoleKey(): string {
    return optional("SUPABASE_SERVICE_ROLE_KEY");
  },
  get supabaseStorageBucket(): string {
    return optional("SUPABASE_STORAGE_BUCKET", "codequest-evidence");
  },
  get isStorageConfigured(): boolean {
    return Boolean(
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
        process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  },
  get verificationProviders(): string[] {
    return optional("VERIFICATION_PROVIDERS", "manual")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  },
  get enableLeetcodeGraphqlProvider(): boolean {
    return bool("ENABLE_LEETCODE_GRAPHQL_PROVIDER", false);
  },
  get rateLimitWindowSeconds(): number {
    return int("RATE_LIMIT_WINDOW_SECONDS", 60);
  },
  get rateLimitMaxRequests(): number {
    return int("RATE_LIMIT_MAX_REQUESTS", 30);
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  get nodeEnv(): string {
    return optional("NODE_ENV", "development");
  },
};

export const isDatabaseConfigured = (): boolean =>
  Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== "");
