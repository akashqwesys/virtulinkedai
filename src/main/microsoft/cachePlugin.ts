/**
 * MSAL Custom Cache Plugin — Persistent Encryption
 *
 * Hooks into the MSAL Node token caching lifecycle to inject `safeStorage` encrypted persistence.
 *
 * - beforeCacheAccess: Deserializes the encrypted vault entry back into MSAL memory.
 * - afterCacheAccess: Checks if MSAL updated tokens (e.g., refresh), encrypts, and stores them in the vault.
 *
 * This ensures the user doesn't have to log in on every app restart!
 */

import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node'
import { storeSecret, getSecret } from '../storage/vault'

const MSAL_VAULT_KEY = 'msal_token_cache'

/**
 * Custom Token Cache Persistence for MSAL connecting securely to the hardware OS Vault.
 */
export const vaultCachePlugin: ICachePlugin = {
  /**
   * Called before MSAL tries to read the token.
   * We retrieve the encrypted blob from the OS vault, decrypt it, and inject it into MSAL.
   */
  beforeCacheAccess: async (cacheContext: TokenCacheContext): Promise<void> => {
    try {
      const decryptedCache = getSecret(MSAL_VAULT_KEY)
      if (decryptedCache) {
        cacheContext.tokenCache.deserialize(decryptedCache)
        console.log('[TokenCacheContext] Restored encrypted token state from Security Vault.')
      }
    } catch (e) {
      console.warn('[TokenCacheContext] Failed to load from Vault (maybe first run or corrupted)', e)
      // Allow MSAL to continue empty (will prompt login)
    }
  },

  /**
   * Called after MSAL updates the cache (e.g. initial login or refresh token cycle).
   * We pull the raw cache dump, encrypt it, and save it back to the OS vault.
   */
  afterCacheAccess: async (cacheContext: TokenCacheContext): Promise<void> => {
    try {
      if (cacheContext.cacheHasChanged) {
        const rawCacheDump = cacheContext.tokenCache.serialize()
        storeSecret(MSAL_VAULT_KEY, rawCacheDump)
        console.log('[TokenCacheContext] Encrypted and saved new token map to Security Vault.')
      }
    } catch (e) {
      console.error('[TokenCacheContext] Failed to save tokens to Security Vault', e)
    }
  }
}
