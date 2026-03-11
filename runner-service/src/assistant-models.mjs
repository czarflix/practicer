import process from 'node:process'
import { GoogleAuth } from 'google-auth-library'
import { runnerConfig } from './config.mjs'

const GOOGLE_CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const MODEL_PRICING = [
  {
    match: /gemini-3.*flash/i,
    inputPerMillion: 0.5,
    outputPerMillion: 3,
  },
  {
    match: /gemini-3.*pro/i,
    inputPerMillion: 2,
    outputPerMillion: 12,
  },
  {
    match: /gemini-2\.5.*flash-lite/i,
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
  },
  {
    match: /gemini-2\.5.*flash/i,
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
  },
]

const googleAuth = new GoogleAuth({
  scopes: [GOOGLE_CLOUD_SCOPE],
})

let cachedAccessToken = ''
let cachedAccessTokenExpiry = 0

function stringifyErrorPayload(payload) {
  if (!payload) {
    return ''
  }

  if (typeof payload === 'string') {
    return payload
  }

  if (payload.error?.message) {
    return String(payload.error.message)
  }

  return JSON.stringify(payload)
}

async function getVertexAccessToken() {
  const directToken = String(process.env.GOOGLE_CLOUD_ACCESS_TOKEN || '').trim()
  if (directToken) {
    return directToken
  }

  const now = Date.now()
  if (cachedAccessToken && now < cachedAccessTokenExpiry - 60_000) {
    return cachedAccessToken
  }

  const client = await googleAuth.getClient()
  const tokenResponse = await client.getAccessToken()
  const accessToken =
    typeof tokenResponse === 'string'
      ? tokenResponse
      : tokenResponse?.token || tokenResponse?.res?.data?.access_token || ''

  if (!accessToken) {
    throw new Error('Unable to acquire a Vertex AI access token.')
  }

  cachedAccessToken = accessToken
  cachedAccessTokenExpiry = now + 45 * 60_000
  return cachedAccessToken
}

function buildModelUrl({ provider, model, apiKey }) {
  if (provider === 'gemini_api') {
    if (!apiKey) {
      throw new Error('Gemini API key is required for the BYO provider.')
    }

    const baseUrl = runnerConfig.geminiApiBaseUrl
    return `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  }

  const project = String(runnerConfig.googleCloudProject || '').trim()
  if (!project) {
    throw new Error('GOOGLE_CLOUD_PROJECT is required for Vertex AI assistant calls.')
  }

  const location = runnerConfig.googleCloudLocation
  return `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`
}

function buildHeaders({ provider, apiKey, accessToken }) {
  if (provider === 'gemini_api') {
    return {
      'Content-Type': 'application/json; charset=utf-8',
    }
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=utf-8',
  }
}

function extractTextFromCandidate(candidate) {
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
  return parts
    .map((part) => {
      if (typeof part?.text === 'string') {
        return part.text
      }
      return ''
    })
    .filter(Boolean)
    .join('')
}

function normalizeUsageMetadata(usageMetadata) {
  const promptTokens = Number(usageMetadata?.promptTokenCount || usageMetadata?.inputTokenCount || 0)
  const outputTokens = Number(usageMetadata?.candidatesTokenCount || usageMetadata?.outputTokenCount || 0)
  const totalTokens = Number(usageMetadata?.totalTokenCount || promptTokens + outputTokens || 0)

  return {
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
  }
}

export function estimateCostUsd(model, usage) {
  const pricing = MODEL_PRICING.find((entry) => entry.match.test(String(model || '')))
  if (!pricing) {
    return 0
  }

  const promptTokens = Number(usage?.promptTokens || 0)
  const outputTokens = Number(usage?.outputTokens || 0)
  return (
    (promptTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  )
}

export async function generateStructuredJson({
  provider,
  model,
  apiKey = '',
  systemInstruction,
  userPrompt,
  temperature = 0.35,
  maxOutputTokens = 2048,
}) {
  const accessToken = provider === 'vertex' ? await getVertexAccessToken() : ''
  const response = await fetch(buildModelUrl({ provider, model, apiKey }), {
    method: 'POST',
    headers: buildHeaders({ provider, apiKey, accessToken }),
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens,
        responseMimeType: 'application/json',
      },
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(stringifyErrorPayload(payload) || `Model request failed (${response.status}).`)
  }

  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null
  const text = extractTextFromCandidate(candidate)
  if (!text.trim()) {
    throw new Error('Model response did not include any text.')
  }

  const usage = normalizeUsageMetadata(payload?.usageMetadata)
  return {
    text,
    usage,
    estimatedCostUsd: estimateCostUsd(model, usage),
    raw: payload,
  }
}
