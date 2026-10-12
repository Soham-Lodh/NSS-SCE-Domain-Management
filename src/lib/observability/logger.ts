/**
 * Sanitized structured operational telemetry.
 *
 * Separate from the durable business AuditLog. Never logs cookies, JWTs,
 * authorization headers, tokens, full request bodies or SMTP credentials.
 */
type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "cookies",
  "token",
  "access_token",
  "refresh_token",
  "password",
  "secret",
  "jwt",
  "apikey",
  "api_key",
  "smtppassword",
  "set-cookie",
];

function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.includes(k.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta: redact(meta) as Record<string, unknown> } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => emit("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit("error", m, meta),
};
