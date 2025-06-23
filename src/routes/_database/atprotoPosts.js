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

/**
 * Deletes an atproto post from the database and its references in timelines.
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} postUri - The AT URI of the post to delete.
 */
export async function deleteAtprotoPost (pdsHostname, postUri) {
  if (!postUri) {
    console.error('[DB atprotoPosts] Attempted to delete post without URI.')
    return Promise.reject(new Error('Post URI is required for deletion.'))
  }
  const db = await getDatabase(pdsHostname)

  // 1. Delete from ATPROTO_POSTS_STORE
  await dbPromise(db, ATPROTO_POSTS_STORE, 'readwrite', (store) => {
    store.delete(postUri)
  }).then(() => {
    console.log(`[DB atprotoPosts] Deleted post URI: ${postUri} from ${ATPROTO_POSTS_STORE}`)
  }).catch(error => {
    console.error(`[DB atprotoPosts] Error deleting post URI ${postUri} from ${ATPROTO_POSTS_STORE}:`, error)
    throw error // Re-throw to indicate failure
  })

  // 2. Delete references from ATPROTO_TIMELINES_STORE
  // This requires iterating and finding keys where the value is postUri,
  // or if postUri is part of the key, finding those keys.
  // Current key: feedUri + '\u0000' + sortableKey(createdAt, postUri) | Value: postUri
  await dbPromise(db, ATPROTO_TIMELINES_STORE, 'readwrite', (store, callback) => {
    const keysToDelete = []
    store.openCursor().onsuccess = (event) => {
      const cursor = event.target.result
      if (cursor) {
        // Check if value matches postUri OR if postUri is embedded in the key in a predictable way.
        // With current key structure, value is postUri.
        // Also, the postUri is at the end of the key: feedUri + '\u0000' + createdAt + '\u0000' + postUri
        if (cursor.value === postUri || (typeof cursor.key === 'string' && cursor.key.endsWith('\u0000' + postUri))) {
          keysToDelete.push(cursor.key)
        }
        cursor.continue()
      } else {
        // All records iterated, now delete collected keys
        let deleteCount = 0
        if (keysToDelete.length === 0) {
          callback() // No keys to delete
          return
        }
        keysToDelete.forEach(key => {
          store.delete(key).onsuccess = () => {
            deleteCount++
            if (deleteCount === keysToDelete.length) {
              console.log(`[DB atprotoPosts] Deleted ${deleteCount} references for post URI: ${postUri} from ${ATPROTO_TIMELINES_STORE}`)
              callback() // All deletions are done
            }
          }
          store.delete(key).onerror = (e) => {
             console.error(`[DB atprotoPosts] Error deleting key ${key} from ${ATPROTO_TIMELINES_STORE}`, e.target.error)
             deleteCount++; // Count it as processed to not hang indefinitely
             if (deleteCount === keysToDelete.length) {
                callback();
             }
          }
        })
      }
    }
    store.openCursor().onerror = (event) => {
        console.error("[DB atprotoPosts] Error opening cursor for deleting from timelines_store", event.target.error);
        callback(event.target.error); // Propagate error
    }
  }).catch(error => {
    console.error(`[DB atprotoPosts] Error cleaning up timelines for post URI ${postUri}:`, error)
    // Don't necessarily throw here if main post deletion succeeded, but log it.
  })

  // TODO: Also remove from ATPROTO_FEED_CURSORS_STORE if this post was a cursor? Unlikely. -> This can be removed.
  // TODO: Consider if other stores reference this post URI and need cleanup. (Largely handled by design, specific cases if any would be new features)
}

/**
 * Retrieves replies to a specific parent post, ordered by creation date (ascending).
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} parentPostUri - The AT URI of the parent post.
 * @param {number} [limit] - Max number of replies to retrieve.
 * @param {string} [sinceTimestamp] - To paginate, get replies created after this ISO timestamp (exclusive).
 * @returns {Promise<Array<object>>} A list of post objects (replies).
 */
export async function getAtprotoReplies (pdsHostname, parentPostUri, limit = 50, sinceTimestamp = null) {
  if (!parentPostUri) {
    console.error('[DB atprotoPosts] parentPostUri is required for getAtprotoReplies.');
    return Promise.resolve([]);
  }
  const db = await getDatabase(pdsHostname);
  return dbPromise(db, ATPROTO_POSTS_STORE, 'readonly', (store, callback) => {
    const index = store.index(ATPROTO_REPLY_PARENT_URI_INDEX);
    const range = IDBKeyRange.only(parentPostUri); // Get all posts whose replyParentUri matches

    const request = index.getAll(range);

    request.onsuccess = () => {
      let replies = request.result;
      if (!replies) {
        callback([]);
        return;
      }
      // Sort by createdAt ascending (oldest first for thread display)
      replies.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      if (sinceTimestamp) {
        replies = replies.filter(reply => new Date(reply.createdAt).getTime() > new Date(sinceTimestamp).getTime());
      }

      if (limit && replies.length > limit) {
        replies = replies.slice(0, limit);
      }
      callback(replies);
    };
    request.onerror = (event) => {
      console.error("[DB atprotoPosts] Error in getAtprotoReplies getAll request:", event.target.error);
      callback([]);
    };
  }).catch(error => {
    console.error(`[DB atprotoPosts] Error in getAtprotoReplies for parent ${parentPostUri}:`, error);
    throw error;
  });
}

/**
 * Retrieves all posts belonging to a specific thread, ordered by creation date (ascending).
 * @param {string} pdsHostname - The hostname of the PDS.
 * @param {string} rootPostUri - The AT URI of the root post of the thread.
 * @returns {Promise<Array<object>>} A list of post objects belonging to the thread.
 */
export async function getAtprotoThread (pdsHostname, rootPostUri) {
  if (!rootPostUri) {
    console.error('[DB atprotoPosts] rootPostUri is required for getAtprotoThread.');
    return Promise.resolve([]);
  }
  const db = await getDatabase(pdsHostname);
  return dbPromise(db, ATPROTO_POSTS_STORE, 'readonly', (store, callback) => {
    const index = store.index(ATPROTO_REPLY_ROOT_URI_INDEX);
    // Get all posts where replyRootUri matches the rootPostUri
    // This includes the root post itself if its replyRootUri is set to its own URI,
    // or if it's null/undefined and we fetch it separately.
    // For now, assume replyRootUri is consistently set for all posts in a thread.
    const range = IDBKeyRange.only(rootPostUri);

    const request = index.getAll(range);

    request.onsuccess = async () => {
      let threadPosts = request.result;
      if (!threadPosts) {
        threadPosts = [];
      }

      // Also fetch the root post itself, as it might not have replyRootUri set (or set to itself)
      // and thus might not be caught by the index query if the index only includes posts *with* a replyRootUri.
      // A common pattern is that root posts don't have `reply` fields.
      try {
        const rootPost = await getAtprotoPost(pdsHostname, rootPostUri); // Use existing getter
        if (rootPost) {
          // Add rootPost if not already included (e.g., if it had replyRootUri pointing to itself)
          if (!threadPosts.find(p => p.uri === rootPost.uri)) {
            threadPosts.push(rootPost);
          }
        }
      } catch(err) {
        console.warn(`[DB atprotoPosts] getAtprotoThread: Could not fetch root post ${rootPostUri} separately:`, err);
      }

      // Sort by createdAt ascending (oldest first for thread display)
      threadPosts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      callback(threadPosts);
    };
    request.onerror = (event) => {
      console.error("[DB atprotoPosts] Error in getAtprotoThread getAll request:", event.target.error);
      callback([]);
    };
  }).catch(error => {
    console.error(`[DB atprotoPosts] Error in getAtprotoThread for root ${rootPostUri}:`, error);
    throw error;
  });
}
