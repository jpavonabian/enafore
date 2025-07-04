import agent from './agent.js'
// Removed unused ajax import: import {නේ } from '../_utils/ajax.js'

/**
 * Creates a new post (skeet) on ATProto.
 * @async
 * @param {object} postDetails - Details of the post to be created.
 * @param {string} postDetails.text - The text content of the post.
 * @param {Array<object>} [postDetails.facets] - Rich text facets (mentions, links, tags).
 * @param {object} [postDetails.embed] - A single top-level embed object (e.g., for images, external link, quote post).
 *                                        Example image embed: { $type: 'app.bsky.embed.images', images: [{ image: blobRef, alt: 'alt text' }] }
 * @param {object} [postDetails.reply] - Optional reply object with `root` and `parent` properties,
 *                                       each having `uri` and `cid`.
 * @param {Array<string>} [postDetails.langs] - Language codes (e.g., ['en', 'ja']).
 * @param {Array<object>} [postDetails.labels] - Self-labels for the post (e.g., for content warnings).
 * @returns {Promise<object>} Object containing `uri` and `cid` of the new post.
 */
export async function createPost ({ text, facets, embed, reply, langs, labels }) { // Added labels
  if (!agent.hasSession) throw new Error('No active session. Please login first.')
  console.log('[ATProto Posts API] Creating post:', { text, embed, reply, langs, labels })

  const postRecord = {
    $type: 'app.bsky.feed.post',
    text: text,
    createdAt: new Date().toISOString(),
  }

  if (langs && langs.length > 0) {
    postRecord.langs = langs
  }

  if (facets && facets.length > 0) {
    postRecord.facets = facets
  }

  if (embed) {
    postRecord.embed = embed;
  }

  if (reply && reply.root && reply.parent) { // Check for well-formed reply object
    postRecord.reply = reply;
  }

  if (labels && labels.length > 0) {
    postRecord.labels = {
      $type: 'com.atproto.label.defs#selfLabels',
      values: labels // e.g. [{ val: '!warn' }, { val: 'sexual' }]
    }
  }

  try {
    const response = await agent.post(postRecord)
    console.log('[ATProto Posts API] Post created successfully:', response)
    return response // { uri, cid }
  } catch (error) {
    console.error('[ATProto Posts API] Error creating post:', error.name, error.message, error)
    let message = `Failed to create post: ${error.message || 'Unknown error'}.`
    if (error.name === 'XRPCError') {
      if (error.status === 401 || error.error === 'AuthenticationRequired' || error.error === 'ExpiredToken') {
        message = 'Your session has expired. Please log in again to post.'
      } else if (error.status === 400) { // Bad request, e.g. validation error
        message = `Could not create post: ${error.message || 'Invalid post data.'}`
      } else if (error.status >= 500) {
        message = 'The server encountered an error trying to create your post. Please try again later.'
      } else {
        message = `Post creation error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`
      }
    } else if (error.message.includes('NetworkError') || error.message.includes('fetch failed')) {
        message = 'Network error. Could not connect to the server to create post.'
    }
    throw new Error(message)
  }
}


/**
 * Likes a post.
 * @param {string} postUri - The AT URI of the post to like.
 * @param {string} postCid - The CID of the post to like.
 * @returns {Promise<object>} Object containing `uri` of the like record.
 */
export async function likePost (postUri, postCid) {
  if (!agent.hasSession) throw new Error('No active session. Please login first.')
  if (!postUri || !postCid) throw new Error('Post URI and CID are required to like a post.')
  console.log(`[ATProto Posts API] Liking post: ${postUri}`)
  try {
    const response = await agent.like(postUri, postCid)
    console.log(`[ATProto Posts API] Post ${postUri} liked successfully:`, response)
    return response // { uri } (uri of the like record)
  } catch (error) {
    console.error(`[ATProto Posts API] Error liking post ${postUri}:`, error.name, error.message, error)
    let message = `Failed to like post: ${error.message || 'Unknown error'}.`
    if (error.name === 'XRPCError') {
      if (error.status === 401 || error.error === 'AuthenticationRequired' || error.error === 'ExpiredToken') {
        message = 'Your session has expired. Please log in again.'
      } else if (error.status === 400 && error.message && error.message.toLowerCase().includes('subject not found')) {
        message = 'Could not like post: The post may have been deleted.'
      } else if (error.status >= 500) {
        message = 'The server encountered an error. Please try again later.'
      } else {
        message = `Like error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`
      }
    }
    throw new Error(message)
  }
}

/**
 * Deletes a like on a post.
 * @param {string} likeUri - The AT URI of the like record to delete.
 * @returns {Promise<void>}
 */
export async function deleteLike (likeUri) {
  if (!agent.hasSession) throw new Error('No active session. Please login first.')
  if (!likeUri) throw new Error('Like URI is required to delete a like.')
  console.log(`[ATProto Posts API] Deleting like: ${likeUri}`)
  try {
    await agent.deleteLike(likeUri)
    console.log(`[ATProto Posts API] Like ${likeUri} deleted successfully.`)
  } catch (error) {
    console.error(`[ATProto Posts API] Error deleting like ${likeUri}:`, error.name, error.message, error)
    let message = `Failed to unlike post: ${error.message || 'Unknown error'}.`
    if (error.name === 'XRPCError') {
      if (error.status === 401 || error.error === 'AuthenticationRequired' || error.error === 'ExpiredToken') {
        message = 'Your session has expired. Please log in again.'
      } else if (error.status >= 500) {
        message = 'The server encountered an error. Please try again later.'
      } else {
        message = `Unlike error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`
      }
    }
    throw new Error(message)
  }
}

/**
 * Reposts a post.
 * @param {string} postUri - The AT URI of the post to repost.
 * @param {string} postCid - The CID of the post to repost.
 * @returns {Promise<object>} Object containing `uri` and `cid` of the repost record.
 */
export async function repostPost (postUri, postCid) {
  if (!agent.hasSession) throw new Error('No active session. Please login first.')
  if (!postUri || !postCid) throw new Error('Post URI and CID are required to repost.')
  console.log(`[ATProto Posts API] Reposting post: ${postUri}`)
  try {
    const response = await agent.repost(postUri, postCid)
    console.log(`[ATProto Posts API] Post ${postUri} reposted successfully:`, response)
    return response // { uri, cid } (uri/cid of the repost record)
  } catch (error) {
    console.error(`[ATProto Posts API] Error reposting post ${postUri}:`, error.name, error.message, error)
    let message = `Failed to repost: ${error.message || 'Unknown error'}.`
    if (error.name === 'XRPCError') {
      if (error.status === 401 || error.error === 'AuthenticationRequired' || error.error === 'ExpiredToken') {
        message = 'Your session has expired. Please log in again.'
      } else if (error.status === 400 && error.message && error.message.toLowerCase().includes('subject not found')) {
        message = 'Could not repost: The original post may have been deleted.'
      } else if (error.status >= 500) {
        message = 'The server encountered an error. Please try again later.'
      } else {
        message = `Repost error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`
      }
    }
    throw new Error(message)
  }
}

/**
 * Deletes a repost.
 * @param {string} repostUri - The AT URI of the repost record to delete.
 * @returns {Promise<void>}
 */
export async function deleteRepost (repostUri) {
  if (!agent.hasSession) throw new Error('No active session. Please login first.')
  if (!repostUri) throw new Error('Repost URI is required to delete a repost.')
  console.log(`[ATProto Posts API] Deleting repost: ${repostUri}`)
  try {
    await agent.deleteRepost(repostUri)
    console.log(`[ATProto Posts API] Repost ${repostUri} deleted successfully.`)
  } catch (error) {
    console.error(`[ATProto Posts API] Error deleting repost ${repostUri}:`, error.name, error.message, error)
    let message = `Failed to delete repost: ${error.message || 'Unknown error'}.`
    if (error.name === 'XRPCError') {
      if (error.status === 401 || error.error === 'AuthenticationRequired' || error.error === 'ExpiredToken') {
        message = 'Your session has expired. Please log in again.'
      } else if (error.status >= 500) {
        message = 'The server encountered an error. Please try again later.'
      } else {
        message = `Delete repost error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`
      }
    }
    throw new Error(message)
  }
}

/**
 * Deletes a post.
 * @param {string} postUri - The AT URI of the post to delete.
 * @returns {Promise<void>}
 */
export async function deletePost (postUri) {
  if (!agent.hasSession) throw new Error('No active session. Please login first.')
  if (!postUri) throw new Error('Post URI is required to delete a post.')
  console.log(`[ATProto Posts API] Deleting post: ${postUri}`)
  try {
    await agent.deletePost(postUri)
    console.log(`[ATProto Posts API] Post ${postUri} deleted successfully.`)
  } catch (error) {
    console.error(`[ATProto Posts API] Error deleting post ${postUri}:`, error.name, error.message, error)
    let message = `Failed to delete post: ${error.message || 'Unknown error'}.`
    if (error.name === 'XRPCError') {
      if (error.status === 401 || error.error === 'AuthenticationRequired' || error.error === 'ExpiredToken') {
        message = 'Your session has expired. Please log in again.'
      } else if (error.status >= 500) {
        message = 'The server encountered an error. Please try again later.'
      } else {
        message = `Delete post error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`
      }
    }
    throw new Error(message)
  }
}

// TODO:
// - Image Upload: Before creating a post with images, images need to be uploaded to the PDS (agent.uploadBlob)
//   and the returned BlobRef ({ $type: 'blob', ref: { $link: '...' }, mimeType: '...', size: ... })
//   is used in the post's embed. The `createPost` function expects `BlobRef`s if images are included.
// - Quote Post Embed: Ensure the structure for quote post embeds is correct.
//   `{ $type: 'app.bsky.embed.record', record: { cid: 'quotedPostCid', uri: 'quotedPostUri' } }`
// - Reply Root/Parent: The logic in `createPost` for `reply.root` and `reply.parent` needs to be
//   correctly supplied by the calling UI based on the context of the reply.
//   If replying to a root post, root and parent are the same.
//   If replying to a reply, root is the original post, parent is the one being directly replied to.
// - More complex embeds: recordWithMedia, etc.
// - Rich text facet generation (mentions, links): This is typically handled by the UI input component.
//   The `createPost` function expects them in the correct atproto facet format.
//   `{ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#mention', did: '...' }] }`
//   `{ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: '...' }] }`
//   `{ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: '...' }] }`


/**
 * Uploads an image and returns an object suitable for an image item in an `app.bsky.embed.images` embed.
 * @async
 * @param {File} file - The image file object.
 * @param {string} [altText=''] - Alt text for the image.
 * @returns {Promise<object>} An object `{ image: BlobRef, alt: string }`.
 * @throws {Error} If upload fails (e.g., network error, auth error, server error, file too large).
 */
export async function uploadImageAndGetEmbed(file, altText = '') {
  if (!agent.hasSession) throw new Error('No active session. Please login first.');
  if (!file) {
    console.error('[ATProto Posts API] No file provided for upload.');
    return null;
  }

  console.log(`[ATProto Posts API] Uploading image: ${file.name}, type: ${file.type}, size: ${file.size}`);

  try {
    // Convert file to Uint8Array
    const buffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    const response = await agent.uploadBlob(uint8Array, {
      encoding: file.type || 'application/octet-stream'
    });

    if (response.success && response.data.blob) {
      console.log('[ATProto Posts API] Image uploaded successfully:', response.data.blob);
      return {
        image: response.data.blob, // This is the BlobRef { cid, mimeType, size, $type: 'blob', ref: { $link: ... } }
        alt: altText
      };
    } else {
      console.error('[ATProto Posts API] Image upload failed, response did not indicate success or blob missing:', response);
      throw new Error('Image upload failed: No blob data returned.');
    }
  } catch (error) {
    console.error(`[ATProto Posts API] Error uploading image ${file.name}:`, error.name, error.message, error);
    let message = `Failed to upload image: ${error.message || 'Unknown error'}.`;
    if (error.name === 'XRPCError') {
      if (error.status === 401 || error.error === 'AuthenticationRequired' || error.error === 'ExpiredToken') {
        message = 'Your session has expired. Please log in again to upload.';
      } else if (error.status === 413) { // Payload too large
        message = 'Image file is too large to upload.';
      } else if (error.status >= 500) {
        message = 'The server encountered an error during upload. Please try again later.';
      } else {
        message = `Image upload error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`;
      }
    }
    // Do not re-throw here, instead return null or an error object so compose action can decide how to proceed.
    // For now, to keep it simple for the caller, throw a user-friendly message.
    // A better pattern might be to return { success: false, error: message }
    throw new Error(message);
  }
}

/**
 * Transforms an ATProto ProfileViewBasic into Enafore's standard account object format.
 * @param {object} profileViewBasic - The ProfileViewBasic object from ATProto.
 * @param {string} [pdsHostname] - Optional PDS hostname to construct full acct.
 * @returns {object} An Enafore-compatible account object.
 */
function transformProfileViewBasicToEnaforeAccount(profileViewBasic, pdsHostname) {
  if (!profileViewBasic || !profileViewBasic.did || !profileViewBasic.handle) {
    console.warn('[ATProto Transform] Invalid ProfileViewBasic object:', profileViewBasic);
    return null;
  }
  const accHostname = pdsHostname || (profileViewBasic.handle.includes('.') ? profileViewBasic.handle.substring(profileViewBasic.handle.indexOf('.') + 1) : 'unknown.pds');


  return {
    id: profileViewBasic.did,
    did: profileViewBasic.did,
    username: profileViewBasic.handle,
    acct: `${profileViewBasic.handle}@${accHostname}`,
    displayName: profileViewBasic.displayName || profileViewBasic.handle,
    avatar: profileViewBasic.avatar || null,
    url: `https://bsky.app/profile/${profileViewBasic.did}`,
    protocol: 'atproto',
    // Viewer state (e.g., amIFollowingThisLiker)
    viewer_following: !!profileViewBasic.viewer?.following,
    viewer_followed_by: !!profileViewBasic.viewer?.followedBy,
    viewer_muted: !!profileViewBasic.viewer?.muted,
    viewer_blocking: !!profileViewBasic.viewer?.blocking, // URI of the block record
    viewer_blocked_by: !!profileViewBasic.viewer?.blockedBy,

    // Fields Enafore might expect, with defaults as ProfileViewBasic is minimal
    note: '',
    header: null,
    followersCount: null,
    followingCount: null,
    statusesCount: null,
    createdAt: null,
    locked: false,
    bot: false,
    fields: [],
    emojis: [],
    moved: null,
    suspended: false,
    _raw: profileViewBasic, // Keep raw for debugging or more detailed views
  };
}


/**
 * Fetches a list of users who liked a post.
 * @async
 * @param {string} postUri - The AT URI of the post.
 * @param {number} [limit=50] - Max number of users to fetch.
 * @param {string} [cursor] - Cursor for pagination.
 * @returns {Promise<{users: Array<object>, cursor: string|undefined}>}
 *          List of transformed Enafore account objects and the next cursor.
 * @throws {Error} If fetching fails.
 */
export async function getPostLikes(postUri, limit = 50, cursor) {
  if (!agent.hasSession) throw new Error('No active session. Please login first.');
  if (!postUri) throw new Error('Post URI is required to get likes.');

  console.log(`[ATProto Posts API] Getting likes for post: ${postUri}`);
  try {
    const response = await agent.getLikes({ uri: postUri, limit, cursor });
    if (response.success && response.data.likes) {
      const pdsHostname = new URL(agent.service.toString()).hostname; // For constructing acct
      const users = response.data.likes.map(like => transformProfileViewBasicToEnaforeAccount(like.actor, pdsHostname)).filter(Boolean);
      console.log(`[ATProto Posts API] Fetched ${users.length} likers for ${postUri}. Cursor: ${response.data.cursor}`);
      return { users, cursor: response.data.cursor };
    } else {
      console.error(`[ATProto Posts API] Failed to get likes for ${postUri}: No likes data in response.`);
      throw new Error('Failed to get likes: No likes data returned.');
    }
  } catch (error) {
    console.error(`[ATProto Posts API] Error getting likes for ${postUri}:`, error.name, error.message, error);
    let message = `Failed to get likes: ${error.message || 'Unknown error'}.`;
    if (error.name === 'XRPCError') {
       if (error.status === 404) message = 'Post not found.';
       else if (error.status === 401) message = 'Authentication required.';
       else message = `Get likes error: ${error.message || 'Server error'}. (Status: ${error.status})`;
    }
    throw new Error(message);
  }
}

/**
 * Fetches a list of users who reposted a post.
 * @async
 * @param {string} postUri - The AT URI of the post.
 * @param {number} [limit=50] - Max number of users to fetch.
 * @param {string} [cursor] - Cursor for pagination.
 * @returns {Promise<{users: Array<object>, cursor: string|undefined}>}
 *          List of transformed Enafore account objects and the next cursor.
 * @throws {Error} If fetching fails.
 */
export async function getPostReposters(postUri, limit = 50, cursor) {
  if (!agent.hasSession) throw new Error('No active session. Please login first.');
  if (!postUri) throw new Error('Post URI is required to get reposters.');

  console.log(`[ATProto Posts API] Getting reposters for post: ${postUri}`);
  try {
    const response = await agent.getRepostedBy({ uri: postUri, limit, cursor });
    if (response.success && response.data.repostedBy) {
      const pdsHostname = new URL(agent.service.toString()).hostname;
      const users = response.data.repostedBy.map(actor => transformProfileViewBasicToEnaforeAccount(actor, pdsHostname)).filter(Boolean);
      console.log(`[ATProto Posts API] Fetched ${users.length} reposters for ${postUri}. Cursor: ${response.data.cursor}`);
      return { users, cursor: response.data.cursor };
    } else {
      console.error(`[ATProto Posts API] Failed to get reposters for ${postUri}: No repostedBy data in response.`);
      throw new Error('Failed to get reposters: No repostedBy data returned.');
    }
  } catch (error) {
    console.error(`[ATProto Posts API] Error getting reposters for ${postUri}:`, error.name, error.message, error);
    let message = `Failed to get reposters: ${error.message || 'Unknown error'}.`;
     if (error.name === 'XRPCError') {
       if (error.status === 404) message = 'Post not found.';
       else if (error.status === 401) message = 'Authentication required.';
       else message = `Get reposters error: ${error.message || 'Server error'}. (Status: ${error.status})`;
    }
    throw new Error(message);
  }
}

/**
 * Fetches a post thread from the network.
 * @async
 * @param {string} postUri - The URI of the post for which to fetch the thread.
 * @param {number} [depth=6] - Maximum depth of parent posts to fetch.
 * @param {number} [parentHeight=80] - Max number of ancestors to fetch. (Note: bsky SDK uses parentHeight, not depth for ancestors)
 * @returns {Promise<object|null>} The transformed PostView object for the root of the thread, with .parent and .replies populated, or null on error.
 *                                 The structure will be nested PostView objects.
 * @throws {Error} If fetching fails.
 */
export async function getNetworkPostThread(postUri, depth, parentHeight) {
  if (!agent.hasSession) throw new Error('No active session. Please login first.'); // Or allow for anon if AppView supports
  if (!postUri) throw new Error('Post URI is required to fetch a thread.');

  console.log(`[ATProto Posts API] Fetching network thread for post: ${postUri}, depth: ${depth}, parentHeight: ${parentHeight}`);
  try {
    const response = await agent.getPostThread({ uri: postUri, depth, parentHeight });
    if (response.success && response.data.thread) {
      console.log(`[ATProto Posts API] Successfully fetched thread for ${postUri}.`);
      // The response.data.thread is a PostView. It needs to be transformed.
      // This transformation needs to be recursive for parents and replies.
      // For now, we return the raw thread data from API, transformation will be complex.
      // TODO: Implement recursive transformation of the thread PostView structure.
      // For now, actions/UI will receive the direct agent.getPostThread response structure.
      return response.data.thread;
    } else {
      console.error(`[ATProto Posts API] Failed to fetch thread for ${postUri}, success false or no thread data.`);
      throw new Error('Failed to fetch thread: No thread data returned.');
    }
  } catch (error) {
    console.error(`[ATProto Posts API] Error fetching network thread for ${postUri}:`, error.name, error.message, error);
    let message = `Failed to fetch thread: ${error.message || 'Unknown error'}.`;
    if (error.name === 'XRPCError') {
      if (error.status === 404 || (error.message && error.message.toLowerCase().includes('post not found'))) {
        message = 'Post not found.';
      } else if (error.status === 401 || error.error === 'AuthenticationRequired') {
        message = 'Authentication required to view this thread.';
      } else if (error.status >= 500) {
        message = 'The server encountered an error fetching the thread. Please try again later.';
      } else {
        message = `Fetch thread error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`;
      }
    }
    throw new Error(message);
  }
}
