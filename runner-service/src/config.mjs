import process from 'node:process'
import { config as loadDotenv } from 'dotenv'

loadDotenv()

function toNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function parseAllowedOrigins(raw) {
  const value = String(raw || '').trim()
  if (!value || value === '*') return new Set(['*'])
  return new Set(
    value
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )
}

export const runnerConfig = {
  port: toNumber(process.env.RUNNER_PORT, 8787),
  allowedOrigins: parseAllowedOrigins(process.env.RUNNER_ALLOWED_ORIGIN),

  supabaseUrl: toBaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
  supabaseServiceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),

  judge0Url: toBaseUrl(process.env.JUDGE0_URL),
  judge0ApiKey: String(process.env.JUDGE0_API_KEY || '').trim(),

  // Dedicated PostgreSQL 14 database for SQL execution.
  // Must NOT be Supabase. Each run gets its own schema inside a transaction.
  sqlExecPgDsn: String(process.env.SQL_EXEC_PG_DSN || '').trim(),

  maxTests: toNumber(process.env.RUNNER_MAX_TESTS, 150),
  maxCodeChars: toNumber(process.env.RUNNER_MAX_CODE_CHARS, 200000),
  maxSqlChars: toNumber(process.env.RUNNER_MAX_SQL_CHARS, 50000),
  sqlStatementTimeoutMs: toNumber(process.env.RUNNER_SQL_STATEMENT_TIMEOUT_MS, 5000),
  cpuTimeLimitSeconds: toNumber(process.env.RUNNER_TIME_LIMIT, 2),
  wallTimeLimitSeconds: toNumber(process.env.RUNNER_WALL_TIME_LIMIT, 5),
  memoryLimitKb: toNumber(process.env.RUNNER_MEMORY_LIMIT_KB, 262144),

  googleCloudProject: String(process.env.GOOGLE_CLOUD_PROJECT || '').trim(),
  googleCloudLocation: String(process.env.GOOGLE_CLOUD_LOCATION || 'global').trim() || 'global',
  googleApiKey: String(process.env.GOOGLE_API_KEY || process.env.VERTEX_AI_API_KEY || '').trim(),
  vertexModelFlash: String(process.env.VERTEX_AI_MODEL_FLASH || 'gemini-3-flash').trim(),
  vertexModelPro: String(process.env.VERTEX_AI_MODEL_PRO || 'gemini-3-pro').trim(),
  backgroundModelFlash25: String(process.env.VERTEX_AI_BACKGROUND_MODEL || 'gemini-2.5-flash').trim(),
  geminiApiBaseUrl:
    String(process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta')
      .trim()
      .replace(/\/+$/, ''),
  assistantCredentialEncryptionKey: String(process.env.AI_CREDENTIAL_ENCRYPTION_KEY || '').trim(),
  assistantPlatformMonthlyHardCapUsd: toNumber(process.env.AI_PLATFORM_MONTHLY_HARD_CAP_USD, 180),
  assistantUserDailySoftCapUsd: toNumber(process.env.AI_USER_DAILY_SOFT_CAP_USD, 8),
  assistantUserDailyHardCapUsd: toNumber(process.env.AI_USER_DAILY_HARD_CAP_USD, 12),
}

export function validateConfig() {
  const missing = []

  if (!runnerConfig.supabaseUrl) {
    missing.push('SUPABASE_URL')
  }

  if (!runnerConfig.supabaseServiceRoleKey) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY')
  }

  if (!runnerConfig.judge0Url) {
    missing.push('JUDGE0_URL')
  }

  if (!runnerConfig.sqlExecPgDsn) {
    missing.push('SQL_EXEC_PG_DSN')
  }

  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }
}
