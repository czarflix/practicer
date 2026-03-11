import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { runnerConfig } from './config.mjs'

function getEncryptionKey() {
  const raw = String(runnerConfig.assistantCredentialEncryptionKey || '').trim()
  if (!raw) {
    throw new Error('AI_CREDENTIAL_ENCRYPTION_KEY is required for BYO Gemini API key storage.')
  }

  return createHash('sha256').update(raw).digest()
}

export function encryptSecret(secret) {
  const value = String(secret || '')
  if (!value.trim()) {
    throw new Error('Secret is required.')
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    encrypted_secret: encrypted.toString('base64'),
    secret_nonce: iv.toString('base64'),
    secret_tag: tag.toString('base64'),
  }
}

export function decryptSecret(record) {
  const ciphertext = Buffer.from(String(record?.encrypted_secret || ''), 'base64')
  const iv = Buffer.from(String(record?.secret_nonce || ''), 'base64')
  const tag = Buffer.from(String(record?.secret_tag || ''), 'base64')

  if (!ciphertext.length || !iv.length || !tag.length) {
    throw new Error('Stored API key payload is incomplete.')
  }

  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}
