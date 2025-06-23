import { getDatabase, dbPromise } from './databaseLifecycle.ts'
import {
    ATPROTO_POSTS_STORE,
    ATPROTO_AUTHOR_DID_CREATED_AT_INDEX,
    ATPROTO_CREATED_AT_INDEX,
    ATPROTO_REPLY_ROOT_URI_INDEX,
    ATPROTO_REPLY_PARENT_URI_INDEX
} from './constants.js'
import { cloneForStorage } from './helpers.js'
// import { postsCache, setInCache, hasInCache, getInCache } from './cache.js'; // Decide if caching needed

// TODO: Consider caching for posts, similar to statusesCache for AP.

/**
 * Saves an atproto post to the database.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {object} postData - The transformed atproto post data (from transformAtprotoPostToEnaforeStatus).
 *                            Must include `uri`.
 */
export async function setAtprotoPost (pdsHostname, postData) {
  if (!postData || !postData.uri) {
    console.error('[DB atprotoPosts] Attempted to save post without URI.', postData)
    return Promise.reject(new Error('Post data must include a URI.'))
  }
  const db = await getDatabase(pdsHostname)
  // Ensure crucial fields for indexing are present, even if null
  const storablePostData = cloneForStorage({
    ...postData,
    author: { ...postData.author }, // Ensure author object and its did is cloned
    createdAt: postData.createdAt || new Date().toISOString(), // Fallback for createdAt
    replyRootUri: postData.replyRootUri || null,
    replyParentUri: postData.replyParentUri || null,
  })

  return dbPromise(db, ATPROTO_POSTS_STORE, 'readwrite', (store) => {
    store.put(storablePostData)
  }).then(() => {
    // setInCache(atprotoPostsCache, pdsHostname, postData.uri, postData) // If caching
    console.log(`[DB atprotoPosts] Saved post URI: ${postData.uri} to ${pdsHostname}`)
  }).catch(error => {
    console.error(`[DB atprotoPosts] Error saving post URI ${postData.uri}:`, error)
    throw error
  })
}

/**
 * Retrieves an atproto post by its URI.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} uri - The AT URI of the post.
 * @returns {Promise<object|null>} The post data or null if not found.
 */
export async function getAtprotoPost (pdsHostname, uri) {
  // if (hasInCache(atprotoPostsCache, pdsHostname, uri)) {
  //   return cloneDeep(getInCache(atprotoPostsCache, pdsHostname, uri));
  // }
  const db = await getDatabase(pdsHostname)
  return dbPromise(db, ATPROTO_POSTS_STORE, 'readonly', (store) => {
    return store.get(uri)
  }).then(postData => {
    if (postData) {
      // setInCache(atprotoPostsCache, pdsHostname, uri, cloneDeep(postData)); // If caching
      console.log(`[DB atprotoPosts] Retrieved post URI: ${uri} from ${pdsHostname}`)
    } else {
      console.log(`[DB atprotoPosts] Post not found for URI: ${uri} in ${pdsHostname}`)
    }
    return postData
  }).catch(error => {
    console.error(`[DB atprotoPosts] Error retrieving post URI ${uri}:`, error)
    throw error
  })
}

/**
 * Saves multiple atproto posts to the database.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {Array<object>} postsData - An array of transformed atproto post objects.
 */
export async function setMultipleAtprotoPosts (pdsHostname, postsData) {
  if (!postsData || postsData.length === 0) {
    return Promise.resolve()
  }
  const db = await getDatabase(pdsHostname)

  return dbPromise(db, ATPROTO_POSTS_STORE, 'readwrite', (store) => {
    for (const postData of postsData) {
      if (!postData || !postData.uri) {
        console.warn('[DB atprotoPosts] Skipping post in batch save due to missing URI.', postData)
        continue
      }
      const storablePostData = cloneForStorage({
        ...postData,
        author: { ...postData.author },
        createdAt: postData.createdAt || new Date().toISOString(),
        replyRootUri: postData.replyRootUri || null,
        replyParentUri: postData.replyParentUri || null,
      })
      store.put(storablePostData)
    }
  }).then(() => {
    console.log(`[DB atprotoPosts] Batch saved ${postsData.length} posts to ${pdsHostname}`)
  }).catch(error => {
    console.error(`[DB atprotoPosts] Error batch saving posts:`, error)
    throw error
  })
}


/**
 * Retrieves posts by a specific author, ordered by creation date (descending).
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} authorDid - The DID of the post author.
 * @param {number} [limit] - Max number of posts to retrieve.
 * @param {string} [beforeTimestamp] - To paginate, get posts created before this ISO timestamp.
 * @returns {Promise<Array<object>>} A list of post objects.
 */
export async function getAtprotoPostsByAuthor (pdsHostname, authorDid, limit = 20, beforeTimestamp = null) {
  const db = await getDatabase(pdsHostname)
  return dbPromise(db, ATPROTO_POSTS_STORE, 'readonly', (store, callback) => {
    const index = store.index(ATPROTO_AUTHOR_DID_CREATED_AT_INDEX)
    // Key range for [authorDid, highTimestamp] down to [authorDid, lowTimestamp]
    // Or [authorDid, beforeTimestamp] down to [authorDid, specificDateIfPagingBackwards]
    // For descending order, IDBKeyRange.upperBound([authorDid, beforeTimestamp || 'Z'], true)
    // and IDBKeyRange.lowerBound([authorDid, '1970-01-01T00:00:00.000Z'])
    // This gets complicated with compound keys and pagination.
    // A simpler approach for now: get all for author and sort/slice in code, or use cursor if just by timestamp.
    // Using getAll for simplicity, then sort and slice. This is not efficient for large datasets.
    // Proper pagination would use cursors on the index.
    const range = IDBKeyRange.bound([authorDid, '0'], [authorDid, 'Z']) // Get all by author DID

    let posts = []
    index.openCursor(range, 'prev').onsuccess = (event) => { // 'prev' for descending
      const cursor = event.target.result
      if (cursor && posts.length < limit) {
        if (beforeTimestamp && cursor.key[1] >= beforeTimestamp) { // cursor.key[1] is createdAt
          cursor.continue()
          return
        }
        posts.push(cursor.value)
        cursor.continue()
      } else {
        callback(posts) // Done
      }
    }
    index.openCursor(range, 'prev').onerror = (event) => {
        console.error("[DB atprotoPosts] Error opening cursor for getAtprotoPostsByAuthor", event.target.error);
        callback([]); // return empty on error
    }
  }).catch(error => {
    console.error(`[DB atprotoPosts] Error in getAtprotoPostsByAuthor for ${authorDid}:`, error)
    throw error
  })
}


// TODO: Add functions for fetching posts for threads (by replyParentUri or replyRootUri)
// TODO: Add deletion functions if needed.
