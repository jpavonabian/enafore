import { dbPromise, getDatabase } from '../databaseLifecycle.ts'
import { getInCache, hasInCache, notificationsCache, setInCache, statusesCache } from '../cache.js'
import {
  ACCOUNTS_STORE,
  NOTIFICATIONS_STORE,
  STATUSES_STORE,
  ATPROTO_POSTS_STORE,
  ATPROTO_NOTIFICATIONS_STORE
} from '../constants.js'
import { fetchStatus as fetchApStatus } from './fetchStatus.js'
import { fetchNotification as fetchApNotification } from './fetchNotification.js'
import { cloneDeep } from '../../_utils/lodash-lite.js'
// Assuming getAtprotoPost and getAtprotoNotification are available via the full DB module import,
// or we might need to import them directly if this file is part of the core `importDatabase()`.
// For now, let's assume they become methods on the `db` object or are callable directly.
// This might require `databaseApis.js` to be structured so these are part of the default export,
// or `asyncDatabase` proxy needs to handle them.
// Simpler: call specialized functions that this module will gain access to when fully imported.

function isAtUri (id) {
  return typeof id === 'string' && id.startsWith('at://')
}

export async function getStatus (instanceName, id) {
  // instanceName is pdsHostname for ATProto
  if (isAtUri(id)) {
    console.log(`[DB getStatusOrNotification] ATProto: getStatus for ${id} on ${instanceName}`)
    // TODO: Implement caching for ATProto posts if desired, similar to statusesCache.
    // For now, direct fetch from its specific store via a method that should be available.
    const db = await getDatabase(instanceName) // Ensures correct DB for the PDS
    // This relies on the full DB module (after dynamic import) having getAtprotoPost method
    // which internally uses ATPROTO_POSTS_STORE.
    // This is a slight simplification of how db[prop] works with asyncDatabase;
    // ideally, this file would call `this.getAtprotoPost(instanceName, id)` if it were part of the class,
    // or import getAtprotoPost directly from `../atprotoPosts.js`.
    // For the purpose of this change, let's assume `getAtprotoPost` is made available.
    // This might actually be:
    // return (await import('../atprotoPosts.js')).getAtprotoPost(instanceName, id);
    // but that would re-import. The `asyncDatabase` should make `getAtprotoPost` available.

    // Correct approach: The dynamically imported module from `importDatabase()` aggregates all exports
    // from `databaseApis.js`. So, `getAtprotoPost` will be a method on the resolved `database` object.
    // However, `getStatus` is called by `database.getStatus()`.
    // So, this function itself IS `database.getStatus()`.
    // It needs to call the specific one. This means `asyncDatabase` needs to expose `getAtprotoPost`
    // and `createMakeProps` should call `database.getAtprotoPost` if it's an AT URI.

    // *** Preferred change based on plan: Modify this function to handle the routing ***
    const dbModule = await importDatabase() // Get the full DB module
    return dbModule.getAtprotoPost(instanceName, id) // Call the specific ATProto getter
  }

  // Existing ActivityPub Logic
  if (hasInCache(statusesCache, instanceName, id)) {
    return cloneDeep(getInCache(statusesCache, instanceName, id))
  }
  const db = await getDatabase(instanceName)
  const storeNames = [STATUSES_STORE, ACCOUNTS_STORE]
  const result = await dbPromise(db, storeNames, 'readonly', (stores, callback) => {
    const [statusesStore, accountsStore] = stores
    fetchApStatus(statusesStore, accountsStore, id, callback)
  })
  setInCache(statusesCache, instanceName, id, cloneDeep(result))
  return result
}

export async function getNotification (instanceName, id) {
  if (isAtUri(id)) {
    console.log(`[DB getStatusOrNotification] ATProto: getNotification for ${id} on ${instanceName}`)
    const dbModule = await importDatabase() // Get the full DB module
    return dbModule.getAtprotoNotification(instanceName, id) // Call the specific ATProto getter
  }

  // Existing ActivityPub Logic
  if (hasInCache(notificationsCache, instanceName, id)) {
    return getInCache(notificationsCache, instanceName, id)
  }
  const db = await getDatabase(instanceName)
  const storeNames = [NOTIFICATIONS_STORE, STATUSES_STORE, ACCOUNTS_STORE]
  const result = await dbPromise(db, storeNames, 'readonly', (stores, callback) => {
    const [notificationsStore, statusesStore, accountsStore] = stores
    fetchNotification(notificationsStore, statusesStore, accountsStore, id, callback)
  })
  setInCache(notificationsCache, instanceName, id, result)
  return result
}
