import { z } from 'zod';

const urlWithProtocol = (protocols: string[]) =>
  z.string().url().refine((value) => protocols.includes(new URL(value).protocol), {
    message: 'Unsupported URL protocol',
  });

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  COOKIE_SECRET: z.string().min(32),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(1),
  MYSQL_URL: urlWithProtocol(['mysql:', 'mysql2:']),
  REDIS_URL: urlWithProtocol(['redis:', 'rediss:']),
  S3_ENDPOINT: urlWithProtocol(['http:', 'https:']),
  S3_BUCKET: z.string().min(3).max(63),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  WALMART_CLIENT_ID: z.string().min(1),
  WALMART_CLIENT_SECRET: z.string().min(1),
  WALMART_ENVIRONMENT: z.enum(['sandbox', 'production']),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  cookieSecret: string;
  credentialEncryptionKey: Uint8Array;
  mysqlUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  s3Bucket: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  walmart: {
    clientId: string;
    clientSecret: string;
    environment: 'sandbox' | 'production';
  };
}

function parseEncryptionKey(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return undefined;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value ? decoded : undefined;
}

export function loadEnv(source: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const invalidKeys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Invalid configuration: ${invalidKeys.join(', ')}`);
  }

  const encryptionKey = parseEncryptionKey(parsed.data.CREDENTIAL_ENCRYPTION_KEY);
  if (!encryptionKey) {
    throw new Error('Invalid configuration: CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }

  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    cookieSecret: env.COOKIE_SECRET,
    credentialEncryptionKey: encryptionKey,
    mysqlUrl: env.MYSQL_URL,
    redisUrl: env.REDIS_URL,
    s3Endpoint: env.S3_ENDPOINT,
    s3Bucket: env.S3_BUCKET,
    ...(env.S3_ACCESS_KEY ? { s3AccessKey: env.S3_ACCESS_KEY } : {}),
    ...(env.S3_SECRET_KEY ? { s3SecretKey: env.S3_SECRET_KEY } : {}),
    walmart: {
      clientId: env.WALMART_CLIENT_ID,
      clientSecret: env.WALMART_CLIENT_SECRET,
      environment: env.WALMART_ENVIRONMENT,
    },
  };
}
