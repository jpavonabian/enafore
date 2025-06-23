import { getDatabase, dbPromise } from './databaseLifecycle.ts'
import { ATPROTO_ACCOUNTS_STORE, ATPROTO_HANDLE_INDEX } from './constants.js'
import { cloneForStorage } from './helpers.js'
// import { accountsCache, setInCache, hasInCache, getInCache } from './cache.js' // Decide if caching is needed here similar to AP accounts

// TODO: Consider if a dedicated cache for atproto accounts is needed like `accountsCache` for AP.
// For now, direct DB access.

/**
 * Saves an atproto account/profile to the database.
 * @param {string} pdsHostname - The hostname of the PDS, used to identify the DB.
 * @param {object} accountData - The atproto account data (e.g., from agent.getProfile()).
 *                               Should include at least `did` and `handle`.
 */
export async function setAtprotoAccount (pdsHostname, accountData) {
  if (!accountData || !accountData.did) {
    console.error('[DB atprotoAccounts] Attempted to save account without DID.', accountData)
    return Promise.reject(new Error('Account data must include a DID.'))
  }
  const db = await getDatabase(pdsHostname)
  const storableAccountData = cloneForStorage(accountData) // Ensure data is storable (e.g. remove undefined)

  return dbPromise(db, ATPROTO_ACCOUNTS_STORE, 'readwrite', (store) => {
    store.put(storableAccountData)
  }).then(() => {
    // setInCache(atprotoAccountsCache, pdsHostname, accountData.did, accountData) // If caching
    console.log(`[DB atprotoAccounts] Saved account for DID: ${accountData.did} to ${pdsHostname}`)
  }).catch(error => {
    console.error(`[DB atprotoAccounts] Error saving account for DID ${accountData.did}:`, error)
    throw error
  })
}

/**
 * Retrieves an atproto account/profile by DID.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} did - The DID of the account to retrieve.
 * @returns {Promise<object|null>} The account data or null if not found.
 */
export async function getAtprotoAccount (pdsHostname, did) {
  // if (hasInCache(atprotoAccountsCache, pdsHostname, did)) {
  //   return cloneDeep(getInCache(atprotoAccountsCache, pdsHostname, did));
  // }
  const db = await getDatabase(pdsHostname)
  return dbPromise(db, ATPROTO_ACCOUNTS_STORE, 'readonly', (store) => {
    return store.get(did)
  }).then(accountData => {
    if (accountData) {
      // setInCache(atprotoAccountsCache, pdsHostname, did, cloneDeep(accountData)); // If caching
      console.log(`[DB atprotoAccounts] Retrieved account for DID: ${did} from ${pdsHostname}`)
    } else {
      console.log(`[DB atprotoAccounts] Account not found for DID: ${did} in ${pdsHostname}`)
    }
    return accountData
  }).catch(error => {
    console.error(`[DB atprotoAccounts] Error retrieving account for DID ${did}:`, error)
    throw error
  })
}

/**
 * Retrieves an atproto account/profile by Handle.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} handle - The handle of the account to retrieve.
 * @returns {Promise<object|null>} The account data or null if not found.
 */
export async function getAtprotoAccountByHandle (pdsHostname, handle) {
  const db = await getDatabase(pdsHostname)
  return dbPromise(db, ATPROTO_ACCOUNTS_STORE, 'readonly', (store) => {
    const index = store.index(ATPROTO_HANDLE_INDEX)
    return index.get(handle) // Assumes handle is unique, which it should be.
  }).then(accountData => {
    if (accountData) {
      // setInCache(atprotoAccountsCache, pdsHostname, accountData.did, cloneDeep(accountData)); // If caching
      console.log(`[DB atprotoAccounts] Retrieved account for handle: ${handle} from ${pdsHostname}`)
    } else {
      console.log(`[DB atprotoAccounts] Account not found for handle: ${handle} in ${pdsHostname}`)
    }
    return accountData
  }).catch(error => {
    console.error(`[DB atprotoAccounts] Error retrieving account for handle ${handle}:`, error)
    throw error
  })
}

// TODO: Add functions for bulk operations if needed, e.g., setMultipleAtprotoAccounts
// TODO: Add deletion functions if account removal is a feature.
// TODO: Consider how to store and retrieve atproto agent session data if it's to be moved from localStorage
// For now, session data is handled by BskyAgent's persistSession and store's `atprotoSessions`.
// This DB module focuses on profile/account metadata.
