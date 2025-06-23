import { getDatabase, dbPromise } from './databaseLifecycle.ts'
import {
    ATPROTO_NOTIFICATIONS_STORE,
    ATPROTO_NOTIFICATION_TIMELINES_STORE,
    ATPROTO_CREATED_AT_INDEX
} from './constants.js'
import { cloneForStorage } from './helpers.js'
// import { notificationsCache, setInCache, hasInCache, getInCache } from './cache.js'; // Decide if caching needed

// The "feed URI" for the main notifications timeline. Could have others like "mentions_only".
const MAIN_NOTIFICATIONS_FEED_ID = 'atproto_notifications_all'

/**
 * Saves multiple atproto notification objects to the database and updates their timeline.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {Array<object>} notifications - Array of transformed atproto notification objects.
 *                                     Each must include `id` (notification URI) and `createdAt`.
 * @param {string} [nextCursor] - The new cursor for the next page of notifications. (Not stored with each notification, but for the feed)
 */
export async function setAtprotoNotifications (pdsHostname, notifications, nextCursor) {
  if (!notifications || notifications.length === 0) {
    return Promise.resolve()
  }
  const db = await getDatabase(pdsHostname)

  // Store individual notification objects
  await dbPromise(db, ATPROTO_NOTIFICATIONS_STORE, 'readwrite', (store) => {
    for (const notification of notifications) {
      if (!notification || !notification.id || !notification.createdAt) {
        console.warn('[DB atprotoNotifications] Skipping notification in batch save due to missing id or createdAt.', notification)
        continue
      }
      const storableNotification = cloneForStorage(notification)
      store.put(storableNotification)
    }
  }).catch(error => {
    console.error(`[DB atprotoNotifications] Error batch saving notification objects:`, error)
    throw error // Re-throw to indicate failure
  })

  // Store notification URIs in the notification timeline
  // Key: MAIN_NOTIFICATIONS_FEED_ID + '\u0000' + createdAt_ISO_timestamp + '\u0000' + notificationUri
  // Value: notificationUri
  await dbPromise(db, ATPROTO_NOTIFICATION_TIMELINES_STORE, 'readwrite', (timelineStore) => {
    for (const notification of notifications) {
      if (notification && notification.id && notification.createdAt) {
        const sortableKey = `${notification.createdAt}\u0000${notification.id}`
        const key = `${MAIN_NOTIFICATIONS_FEED_ID}\u0000${sortableKey}`
        timelineStore.put(notification.id, key)
      }
    }
  }).catch(error => {
    console.error(`[DB atprotoNotifications] Error saving notification timeline items:`, error)
    // Potentially try to clean up if main objects were stored but timeline association failed.
    throw error
  })

  // Cursor management for the notifications feed is handled by the calling store mixin,
  // which uses `database.setAtprotoFeedCursor` with a stable feed identifier like 'notifications_all'.

  console.log(`[DB atprotoNotifications] Batch saved ${notifications.length} notifications and their timeline entries to ${pdsHostname}`)
}


/**
 * Retrieves an ordered list of notification URIs for the main notification feed.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {number} [limit] - Max number of notification URIs to retrieve.
 * @param {string} [startAfterSortableKey] - For pagination, the sortableKey of the last item.
 *                                         (e.g., "2023-01-01T00:00:00.000Z\u0000notificationUri")
 * @returns {Promise<Array<string>>} An array of notification URIs.
 */
export async function getAtprotoNotificationTimelineUris (pdsHostname, limit = 20, startAfterSortableKey = null) {
  const db = await getDatabase(pdsHostname)
  return dbPromise(db, ATPROTO_NOTIFICATION_TIMELINES_STORE, 'readonly', (store, callback) => {
    let range;
    // Assuming keys are like 'notifications_feed\u0000timestamp\u0000uri'
    // For 'latest first', we need to iterate in reverse.
    const feedPrefix = `${MAIN_NOTIFICATIONS_FEED_ID}\u0000`;
    if (startAfterSortableKey) {
      // To get items *older* than (before) startAfterSortableKey when using 'prev'
      range = IDBKeyRange.upperBound(`${feedPrefix}${startAfterSortableKey}`, true); // true for exclusive
    } else {
      // Get all items for this feed for 'prev' iteration.
      range = IDBKeyRange.bound(`${feedPrefix}`, `${feedPrefix}\uffff`);
    }

    const uris = []
    store.openCursor(range, 'prev').onsuccess = (event) => { // 'prev' for descending by sortableKey
      const cursor = event.target.result
      if (cursor && uris.length < limit) {
        if (cursor.key.startsWith(feedPrefix)) { // Ensure it's part of the correct feed
            uris.push(cursor.value) // value is notificationUri
        }
        cursor.continue()
      } else {
        callback(uris) // Done
      }
    }
    store.openCursor(range, 'prev').onerror = (event) => {
        console.error("[DB atprotoNotifications] Error opening cursor for getAtprotoNotificationTimelineUris", event.target.error);
        callback([]);
    }
  }).catch(error => {
    console.error(`[DB atprotoNotifications] Error in getAtprotoNotificationTimelineUris:`, error)
    throw error
  })
}

/**
 * Retrieves a specific atproto notification by its URI.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} notificationUri - The URI of the notification.
 * @returns {Promise<object|null>} The notification object or null if not found.
 */
export async function getAtprotoNotification (pdsHostname, notificationUri) {
  const db = await getDatabase(pdsHostname)
  return dbPromise(db, ATPROTO_NOTIFICATIONS_STORE, 'readonly', (store) => {
    return store.get(notificationUri)
  }).then(notification => {
    if (notification) {
      console.log(`[DB atprotoNotifications] Retrieved notification URI: ${notificationUri} from ${pdsHostname}`)
    } else {
      console.log(`[DB atprotoNotifications] Notification not found for URI: ${notificationUri} in ${pdsHostname}`)
    }
    return notification
  }).catch(error => {
    console.error(`[DB atprotoNotifications] Error retrieving notification URI ${notificationUri}:`, error)
    throw error
  })
}

// TODO:
// - Function to fetch multiple notifications by URIs (useful after getting URIs from timeline). (Future enhancement)
// - Deletion logic if needed. (Future enhancement)
// - Potentially separate timeline stores for different notification types (e.g., mentions).
//   Currently, MAIN_NOTIFICATIONS_FEED_ID is generic. (Future enhancement)
// - Cache integration. (Future enhancement)
