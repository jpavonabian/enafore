import { getDatabase, dbPromise } from './databaseLifecycle.ts'
import {
    ATPROTO_BOOKMARKS_STORE,
    ATPROTO_BOOKMARKED_AT_INDEX
} from './constants.js'
import { cloneForStorage } from './helpers.js'

/**
 * Adds an ATProto post URI to client-side bookmarks.
 * @param {string} pdsHostname - The hostname of the PDS (to identify the database).
 * @param {string} postUri - The AT URI of the post to bookmark.
 * @returns {Promise<object>} The created bookmark record { postUri, bookmarkedAt }.
 * @throws {Error} If postUri is already bookmarked or on DB error.
 */
export async function addAtprotoBookmark (pdsHostname, postUri) {
  if (!postUri) {
    return Promise.reject(new Error('Post URI is required to add a bookmark.'));
  }
  const db = await getDatabase(pdsHostname);
  const bookmarkRecord = {
    postUri: postUri,
    bookmarkedAt: new Date().toISOString()
  };

  return dbPromise(db, ATPROTO_BOOKMARKS_STORE, 'readwrite', async (store, callback, tx) => {
    try {
      const existing = await new Promise((resolve, reject) => {
        const req = store.get(postUri);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      if (existing) {
        console.log(`[DB atprotoBookmarks] Post ${postUri} is already bookmarked.`);
        // Optionally update bookmarkedAt timestamp if desired, for now, treat as "already exists"
        // store.put(cloneForStorage(bookmarkRecord));
        callback(existing); // Return existing record
        return;
      }
      store.add(cloneForStorage(bookmarkRecord));
      callback(bookmarkRecord);
    } catch (e) {
      // dbPromise's transaction will abort on error
      console.error(`[DB atprotoBookmarks] Error in addAtprotoBookmark for ${postUri}:`, e);
      throw e; // Propagate to ensure transaction aborts and caller sees error
    }
  }).then(() => {
    console.log(`[DB atprotoBookmarks] Added bookmark for post: ${postUri} in ${pdsHostname}`);
    return bookmarkRecord;
  });
}

/**
 * Removes an ATProto post URI from client-side bookmarks.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} postUri - The AT URI of the post to unbookmark.
 * @returns {Promise<void>}
 */
export async function removeAtprotoBookmark (pdsHostname, postUri) {
  if (!postUri) {
    return Promise.reject(new Error('Post URI is required to remove a bookmark.'));
  }
  const db = await getDatabase(pdsHostname);
  return dbPromise(db, ATPROTO_BOOKMARKS_STORE, 'readwrite', (store) => {
    store.delete(postUri);
  }).then(() => {
    console.log(`[DB atprotoBookmarks] Removed bookmark for post: ${postUri} from ${pdsHostname}`);
  }).catch(error => {
    console.error(`[DB atprotoBookmarks] Error removing bookmark for post ${postUri}:`, error);
    throw error;
  });
}

/**
 * Retrieves a specific client-side bookmark by post URI.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} postUri - The AT URI of the post.
 * @returns {Promise<object|null>} The bookmark record { postUri, bookmarkedAt } or null if not found.
 */
export async function getAtprotoBookmark (pdsHostname, postUri) {
  if (!postUri) return Promise.resolve(null);
  const db = await getDatabase(pdsHostname);
  return dbPromise(db, ATPROTO_BOOKMARKS_STORE, 'readonly', (store) => {
    return store.get(postUri);
  }).then(record => {
    console.log(`[DB atprotoBookmarks] Get bookmark for ${postUri}: ${record ? 'found' : 'not found'}`);
    return record;
  }).catch(error => {
    console.error(`[DB atprotoBookmarks] Error getting bookmark for post ${postUri}:`, error);
    throw error;
  });
}

/**
 * Retrieves all client-side bookmarks, sorted by bookmarkedAt descending (most recent first).
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {number} [limit] - Max number of bookmarks to retrieve.
 * @param {string} [beforeTimestamp] - For pagination: ISO string, fetch bookmarks older than this.
 * @returns {Promise<Array<object>>} An array of bookmark records [{ postUri, bookmarkedAt }].
 */
export async function getAllAtprotoBookmarks (pdsHostname, limit = 50, beforeTimestamp = null) {
  const db = await getDatabase(pdsHostname);
  return dbPromise(db, ATPROTO_BOOKMARKS_STORE, 'readonly', (store, callback) => {
    const index = store.index(ATPROTO_BOOKMARKED_AT_INDEX);
    let range = null;
    if (beforeTimestamp) {
      range = IDBKeyRange.upperBound(beforeTimestamp, true); // Bookmarks created *before* this timestamp (exclusive)
    }

    const bookmarks = [];
    // Open cursor in 'prev' direction to get newest first from the index.
    index.openCursor(range, 'prev').onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && bookmarks.length < limit) {
        bookmarks.push(cursor.value); // cursor.value is { postUri, bookmarkedAt }
        cursor.continue();
      } else {
        callback(bookmarks); // Done
      }
    };
    index.openCursor(range, 'prev').onerror = (event) => {
      console.error("[DB atprotoBookmarks] Error opening cursor for getAllAtprotoBookmarks:", event.target.error);
      callback([]);
    };
  }).catch(error => {
    console.error(`[DB atprotoBookmarks] Error in getAllAtprotoBookmarks:`, error);
    throw error;
  });
}

// This module needs to be exported via databaseApis.js
// Example in databaseApis.js: export * from './atprotoBookmarks.js';
