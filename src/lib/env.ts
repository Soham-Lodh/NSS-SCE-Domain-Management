import { z } from "zod";

/**
 * Server-side environment validation.
 *
 * Validation is lazy (first access) so that `next build`/typecheck does not
 * require production secrets to be present. Never log or expose these values.
 */

const serverSchema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  ORGANIZATION_TIMEZONE: z.string().default("Asia/Kolkata"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  ALLOWED_EMAIL_DOMAINS: z.string().min(1),
  BOOTSTRAP_COORDINATOR_EMAIL: z.string().email().or(z.literal("")).default(""),
  ALLOWED_ORIGINS: z.string().default(""),
  // Tolerate unknown/legacy values instead of failing the whole app.
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).catch("info"),

  BREVO_SMTP_HOST: z.string().default("smtp-relay.brevo.com"),
  BREVO_SMTP_PORT: z.coerce.number().int().default(587),
  BREVO_SMTP_USER: z.string().optional(),
  BREVO_SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default("no-reply@example.com"),
  MAIL_FROM_NAME: z.string().default("NSS SCE KIIT"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/**
 * Returns validated server env. Throws a clear (secret-free) error listing
 * missing variable *names* only.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues
      .map((i) => i.path.join("."))
      .filter(Boolean);
    throw new Error(
      `Invalid/missing server environment variables: ${Array.from(new Set(names)).join(", ")}. ` +
        `See .env.example.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Exact allowlisted email-domain suffixes (lower-cased, no leading dots). */
export function allowedEmailDomains(): string[] {
  return serverEnv()
    .ALLOWED_EMAIL_DOMAINS.split(",")
    .map((d) => d.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
}

/** Extra origins permitted for cookie-authenticated mutations. */
export function allowedOrigins(): string[] {
  return serverEnv()
    .ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Public (browser-exposed) Supabase config. */
export const publicSupabase = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
});
