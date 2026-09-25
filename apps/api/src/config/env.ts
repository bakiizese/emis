import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** A base64-encoded 256-bit key. Errors never include the value. */
const base64Key = z
  .string()
  .trim()
  .transform((value) => Buffer.from(value, 'base64'))
  .refine((key) => key.length === 32, 'must be 32 bytes, base64-encoded (openssl rand -base64 32)');

const commaSeparatedKeys = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(base64Key));

const httpUrl = z.url({ protocol: /^https?$/ });

const commaSeparatedUrls = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z.enum(logLevels).default('info'),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** Job queues (worker only). The API itself never talks to Valkey. */
    VALKEY_URL: z.url({ protocol: /^rediss?$/ }).optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),

    /** Set to true when running behind Caddy/a load balancer so client IPs are real. */
    TRUST_PROXY: z.stringbool().default(false),
    /** Browser origins allowed to call the API cross-origin. Empty = same-origin only. */
    CORS_ORIGINS: commaSeparatedUrls,
    BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1_048_576),

    /** Name shown in authenticator apps and emails until the institution profile exists. */
    APP_NAME: z.string().trim().min(1).max(60).default('EMIS'),
    /** Public URLs of the frontends: used in email links and as trusted origins. */
    PORTAL_URL: httpUrl.default('http://localhost:3001'),
    WEB_URL: httpUrl.default('http://localhost:3000'),
    /** Extra origins allowed to make state-changing requests (CSRF check). */
    TRUSTED_ORIGINS: commaSeparatedUrls,

    /** Encrypts secrets at rest (TOTP seeds…). Keep previous keys listed while rotating. */
    ENCRYPTION_KEY: base64Key,
    ENCRYPTION_KEYS_PREVIOUS: commaSeparatedKeys,

    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('__Host-emis_session'),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(720).default(12),

    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    /** true = implicit TLS (port 465). Otherwise STARTTLS is used when the server offers it. */
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().min(3).default('EMIS <no-reply@localhost>'),

    RATE_LIMIT_TTL_MS: z.coerce.number().int().min(1000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),

    /** Serve OpenAPI docs at /api/docs. Defaults to on, except in production. */
    API_DOCS_ENABLED: z.stringbool().optional(),
  })
  .transform((env) => ({
    ...env,
    API_DOCS_ENABLED: env.API_DOCS_ENABLED ?? env.NODE_ENV !== 'production',
    TRUSTED_ORIGINS: [
      ...new Set(
        [env.PORTAL_URL, env.WEB_URL, ...env.CORS_ORIGINS, ...env.TRUSTED_ORIGINS].map(
          (url) => new URL(url).origin,
        ),
      ),
    ],
  }));

export type Env = z.output<typeof envSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

/** Parse and validate configuration once at startup. Messages name the key, never the value. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
