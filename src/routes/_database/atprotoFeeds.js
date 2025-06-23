import { getDatabase, dbPromise } from './databaseLifecycle.ts'
import {
    ATPROTO_TIMELINES_STORE,
    ATPROTO_FEED_CURSORS_STORE
} from './constants.js'
import { cloneForStorage } from './helpers.js'

/**
 * Stores the URIs of posts for a given feed, associating them with a sortable key.
 * Also updates the cursor for this feed.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} feedUri - The AT URI of the feed generator or a special name (e.g., "home").
 * @param {Array<object>} posts - Array of transformed post objects. Each should have `uri` and `createdAt`.
 * @param {string} [nextCursor] - The new cursor for the next page of this feed. Undefined if no more pages.
 */
export async function setAtprotoFeedTimeline (pdsHostname, feedUri, posts, nextCursor) {
  if (!feedUri) {
    console.error('[DB atprotoFeeds] feedUri is required.')
    return Promise.reject(new Error('feedUri is required.'))
  }
  const db = await getDatabase(pdsHostname)

  // Store post URIs in ATPROTO_TIMELINES_STORE
  // Key: feedUri + '\u0000' + createdAt_timestamp_ISO + '\u0000' + postUri
  // Value: postUri (or a small object like { postUri, indexedAtFromFeedView })
  // This allows fetching an ordered list of URIs for a feed.
  await dbPromise(db, ATPROTO_TIMELINES_STORE, 'readwrite', (timelineStore) => {
    for (const post of posts) {
      if (post && post.uri && post.createdAt) {
        // Using createdAt for sorting. If posts from feed view have a more reliable sort field (e.g. cursor position, specific indexedAt for that feed), use that.
        const sortableKey = `${post.createdAt}\u0000${post.uri}`
        const key = `${feedUri}\u0000${sortableKey}`
        timelineStore.put(post.uri, key) // Storing post URI as value, key enables sorting/grouping
      } else {
        console.warn('[DB atprotoFeeds] Skipping post in timeline due to missing uri or createdAt.', post)
      }
    }
  }).catch(error => {
    console.error(`[DB atprotoFeeds] Error saving timeline items for feed ${feedUri}:`, error)
    throw error // Re-throw to indicate failure
  })

  // Store/Update the cursor for this feed in ATPROTO_FEED_CURSORS_STORE
  if (typeof nextCursor !== 'undefined') { // Allow storing null or empty string if that signifies end of feed
    return dbPromise(db, ATPROTO_FEED_CURSORS_STORE, 'readwrite', (cursorStore) => {
      cursorStore.put({ feedUri, cursor: nextCursor })
    }).then(() => {
      console.log(`[DB atprotoFeeds] Updated cursor for feed ${feedUri} to: ${nextCursor} in ${pdsHostname}`)
    }).catch(error => {
      console.error(`[DB atprotoFeeds] Error saving cursor for feed ${feedUri}:`, error)
      // Decide if this error should also reject the main promise
    })
  }
  console.log(`[DB atprotoFeeds] Saved ${posts.length} items for feed ${feedUri} in ${pdsHostname}`)
}

/**
 * Sets or updates the pagination cursor for a given feed.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} feedUri - The AT URI of the feed or a special identifier (e.g., "home_following", "notifications_all").
 * @param {string | null | undefined} cursor - The cursor string. Null or undefined might signify end of feed or reset.
 */
export async function setAtprotoFeedCursor (pdsHostname, feedUri, cursor) {
  if (!feedUri) {
    console.error('[DB atprotoFeeds] setAtprotoFeedCursor: feedUri is required.');
    return Promise.reject(new Error('feedUri is required for setting cursor.'));
  }
  const db = await getDatabase(pdsHostname);
  const record = { feedUri, cursor: cursor }; // cursor can be null or undefined

  return dbPromise(db, ATPROTO_FEED_CURSORS_STORE, 'readwrite', (store) => {
    store.put(cloneForStorage(record)); // Use put to insert or update
  }).then(() => {
    console.log(`[DB atprotoFeeds] Set cursor for feed ${feedUri} to: "${cursor}" in ${pdsHostname}`);
  }).catch(error => {
    console.error(`[DB atprotoFeeds] Error setting cursor for feed ${feedUri}:`, error);
    throw error;
  });
}

/**
 * Retrieves an ordered list of post URIs for a given feed.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} feedUri - The AT URI of the feed or a special name.
 * @param {number} [limit] - Max number of post URIs to retrieve.
 * @param {string} [startAfterSortableKey] - For pagination, the sortableKey of the last item from the previous page.
 *                                         (e.g., "2023-01-01T00:00:00.000Z\u0000postUri")
 * @returns {Promise<Array<string>>} An array of post URIs.
 */
export async function getAtprotoFeedTimelineUris (pdsHostname, feedUri, limit = 20, startAfterSortableKey = null) {
  const db = await getDatabase(pdsHostname)
  return dbPromise(db, ATPROTO_TIMELINES_STORE, 'readonly', (store, callback) => {
    // Create a key range for items belonging to this feedUri, starting after the given key if paginating.
    // Range: [feedUri + '\u0000' + startAfterSortableKey (exclusive), feedUri + '\u0000' + 'Z']
    // Order is descending by the sortableKey part.
    const lowerBound = startAfterSortableKey
      ? `${feedUri}\u0000${startAfterSortableKey}`
      : `${feedUri}\u0000` // Start of the feed
    const upperBound = `${feedUri}\u0000\uffff` // End of the feed (using \uffff as high sentinel character)

    // For descending order, we'd use 'prev' and swap bounds, or adjust keys for lexicographical descending.
    // The current key structure (timestamp + postUri) sorts ascending by time.
    // To get latest first, we need 'prev' or store keys that sort naturally descending (e.g. (MAX_TIMESTAMP - timestamp)).
    // Let's assume for now we want ascending and UI will reverse if needed, or we use 'prev'.

    let range;
    if (startAfterSortableKey) {
      // If paginating "older" items (ascending time), use lower bound.
      range = IDBKeyRange.lowerBound(`${feedUri}\u0000${startAfterSortableKey}`, true); // true for exclusive
    } else {
      // Get first page
      range = IDBKeyRange.bound(`${feedUri}\u0000`, `${feedUri}\u0000\uffff`);
    }

    const uris = []
    // Using 'next' for ascending order of sortableKey (older to newer).
    // If 'latest first' is desired, use 'prev' and adjust range or key storage.
    store.openCursor(range, 'next').onsuccess = (event) => {
      const cursor = event.target.result
      if (cursor && uris.length < limit) {
        // Make sure the key actually belongs to the feedUri (prefix check)
        if (cursor.key.startsWith(feedUri + '\u0000')) {
            uris.push(cursor.value) // value is postUri
        }
        cursor.continue()
      } else {
        callback(uris) // Done
      }
    }
    store.openCursor(range, 'next').onerror = (event) => {
        console.error("[DB atprotoFeeds] Error opening cursor for getAtprotoFeedTimelineUris", event.target.error);
        callback([]);
    }
  }).catch(error => {
    console.error(`[DB atprotoFeeds] Error in getAtprotoFeedTimelineUris for ${feedUri}:`, error)
    throw error
  })
}

/**
 * Retrieves the stored cursor for a given feed.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} feedUri - The AT URI of the feed or a special name.
 * @returns {Promise<string|null|undefined>} The cursor string, null if explicitly stored as null, or undefined if not found.
 */
export async function getAtprotoFeedCursor (pdsHostname, feedUri) {
  const db = await getDatabase(pdsHostname)
  return dbPromise(db, ATPROTO_FEED_CURSORS_STORE, 'readonly', (store) => {
    return store.get(feedUri)
  }).then(record => {
    if (record) {
      console.log(`[DB atprotoFeeds] Retrieved cursor for feed ${feedUri}: ${record.cursor} from ${pdsHostname}`)
      return record.cursor
    }
    console.log(`[DB atprotoFeeds] No cursor found for feed ${feedUri} in ${pdsHostname}`)
    return undefined // Explicitly return undefined if no record
  }).catch(error => {
    console.error(`[DB atprotoFeeds] Error retrieving cursor for feed ${feedUri}:`, error)
    throw error
  })
}
