import agent from './agent.js'
import {නේ } from '../_utils/ajax.js' // Not strictly needed here, but good for consistency if other utils are used

/**
 * Creates a new post (skeet).
 * @param {object} postDetails
 * @param {string} postDetails.text - The text content of the post.
 * @param {Array<object>} [postDetails.facets] - Rich text facets (mentions, links, tags).
 * @param {object} [postDetails.embed] - A single top-level embed object (e.g., for images, external link, quote post).
 *                                        Example image embed: { $type: 'app.bsky.embed.images', images: [{ image: blobRef, alt: 'alt text' }] }
 * @param {string} [postDetails.replyToUri] - AT URI of the post being replied to (for root).
 * @param {string} [postDetails.replyToCid] - CID of the post being replied to (for parent).
 * @param {Array<string>} [postDetails.langs] - Language codes (e.g., ['en', 'ja']).
 * @returns {Promise<object>} Object containing `uri` and `cid` of the new post.
 */
export async function createPost ({ text, facets, embed, replyToUri, replyToCid, langs }) { // Changed 'embeds' to 'embed'
  if (!agent.hasSession) throw new Error('No active session. Please login first.')
  console.log('[ATProto Posts API] Creating post:', { text, embed, replyToUri })

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

  if (embed) { // Changed from 'embeds && embeds.length > 0'
    postRecord.embed = embed;
  }

  if (replyToUri && replyToCid) {
    postRecord.reply = {
      root: { uri: replyToUri, cid: replyToCid }, // Should be the original post in the thread
      parent: { uri: replyToUri, cid: replyToCid } // Should be the direct parent post
      // SDK might adjust root/parent if only one is given, or if they are the same.
      // If replying to a reply, root is the start of thread, parent is the post directly replied to.
    }
    // If only replying to a root post, root and parent are the same.
    // This logic needs to be set correctly by the calling UI/action based on context.
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
 * Uploads an image and returns the embed object for a post.
 * @param {File} file - The image file object.
 * @param {string} [altText=''] - Alt text for the image.
 * @returns {Promise<object|null>} The image embed object or null if upload fails.
 * Example embed: { $type: 'app.bsky.embed.images', images: [{ image: blobRef, alt: 'alt text' }] }
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
