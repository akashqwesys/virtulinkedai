/**
 * Security Vault — Cryptographic Storage Handler
 *
 * Provides a secure key-value store leveraging Electron's safeStorage API.
 * Data is encrypted at the OS-hardware level (macOS Keychain, Windows DPAPI)
 * before being persisted to disk, providing Keytar-equivalent security
 * without the complex C++ native-addon build requirements.
 */

import { safeStorage } from 'electron'
import Store from 'electron-store'
import { logActivity } from './database'

// Creates an isolated JSON file (vault.json) in the user data directory
const vaultStore = new Store<{ secrets: Record<string, string> }>({
  name: 'vault',
  defaults: {
    secrets: {}
  }
})

/**
 * Encrypt and store a secret string.
 *
 * @param key Identifier for the secret
 * @param value The raw string to encrypt
 */
export function storeSecret(key: string, value: string): void {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      // Encrypt the string to a Buffer, then convert to base64 for JSON storage
      const encryptedBuffer = safeStorage.encryptString(value)
      const base64Data = encryptedBuffer.toString('base64')

      const secrets = vaultStore.get('secrets') || {}
      secrets[key] = base64Data
      vaultStore.set('secrets', secrets)

      logActivity('vault_secret_stored', 'system', { key, encrypted: true })
    } else {
      // Fallback for environments without hardware crypto
      // Warning: This saves the token in plain text as a last resort fallback!
      console.warn(`[Security Vault] Hardware encryption unavailable. Storing '${key}' as plaintext.`)
      const secrets = vaultStore.get('secrets') || {}
      secrets[key] = value
      vaultStore.set('secrets', secrets)

      logActivity('vault_secret_stored', 'system', { key, encrypted: false })
    }
  } catch (error) {
    console.error(`[Security Vault] Failed to store secret '${key}':`, error)
    logActivity('vault_secret_store_error', 'system', { key, error: String(error) }, 'error')
    throw error
  }
}

/**
 * Retrieve and decrypt a stored secret string.
 *
 * @param key Identifier for the secret
 * @returns Decrypted string or null if not found
 */
export function getSecret(key: string): string | null {
  try {
    const secrets = vaultStore.get('secrets') || {}
    const storedValue = secrets[key]

    if (!storedValue) return null

    if (safeStorage.isEncryptionAvailable()) {
      // Decode base64 to Buffer, then decrypt hardware lock
      try {
        const encryptedBuffer = Buffer.from(storedValue, 'base64')
        return safeStorage.decryptString(encryptedBuffer)
      } catch (decryptError) {
        // If decryption fails, it might have been saved in plaintext during fallback
        console.warn(`[Security Vault] Decryption failed for '${key}', trying plaintext...`)
        return storedValue
      }
    } else {
      // Fallback environment
      return storedValue
    }
  } catch (error) {
    console.error(`[Security Vault] Failed to retrieve secret '${key}':`, error)
    logActivity('vault_secret_retrieve_error', 'system', { key, error: String(error) }, 'error')
    return null
  }
}

/**
 * Delete a secure secret.
 *
 * @param key Identifier for the secret
 */
export function deleteSecret(key: string): void {
  const secrets = vaultStore.get('secrets') || {}
  if (key in secrets) {
    delete secrets[key]
    vaultStore.set('secrets', secrets)
    logActivity('vault_secret_deleted', 'system', { key })
  }
}

/**
 * Check if secure hardware encryption is ready
 */
export function isVaultSecure(): boolean {
  return safeStorage.isEncryptionAvailable()
}
