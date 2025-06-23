import agent from './agent.js'
import { getActiveSessionData } from './auth.js'

/**
 * Transforms an ATProto FeedViewPost (or a similar PostView structure) into Enafore's common status object format.
 * This function is crucial for adapting Bluesky/ATProto data to Enafore's existing UI components and data handling logic.
 * @param {object} feedViewPost - The FeedViewPost object from ATProto (e.g., from getTimeline, getAuthorFeed).
 *                                It typically includes `post` (PostView), and optional `reply`, `reason`.
 * @returns {object|null} An Enafore-compatible status object, or null if input is invalid.
 */
function transformAtprotoPostToEnaforeStatus (feedViewPost) {
  // Ensure post and author exist, as they are fundamental
  if (!feedViewPost || !feedViewPost.post || !feedViewPost.post.author) {
    console.warn('[ATProto Transform] Invalid feedViewPost object received, missing post or author:', feedViewPost);
    return null;
  }
  const { post, reply, reason } = feedViewPost

  // Basic structure from post author and record
  const enoStatus = {
    id: post.uri, // AT URI is a good unique ID
    uri: post.uri,
    content: post.record?.text || '', // Text content
    createdAt: post.record?.createdAt,
    author: {
      id: post.author.did, // Use DID as a stable ID
      did: post.author.did,
      handle: post.author.handle,
      displayName: post.author.displayName || post.author.handle,
      avatar: post.author.avatar || null, // Ensure null if undefined
      // Enafore specific account fields might need defaults or be omitted
      acct: post.author.handle, // Or format like handle@pds
      username: post.author.handle,
      url: `https://bsky.app/profile/${post.author.did}`, // Author's profile URL
    },
    url: `https://bsky.app/profile/${post.author.did}/post/${post.uri.split('/').pop()}`, // Post's web URL

    replyCount: post.replyCount || 0,
    repostCount: post.repostCount || 0,
    likeCount: post.likeCount || 0,
    protocol: 'atproto',
    cid: post.cid, // Content ID of the post record
    indexedAt: post.indexedAt, // When the post was indexed by the AppView
    language: post.record?.langs && post.record.langs.length > 0 ? post.record.langs[0] : null,

    // Viewer's interaction state with this specific post
    myLikeUri: post.viewer?.like,
    myRepostUri: post.viewer?.repost,
    // Enafore's boolean flags based on viewer state
    favorited: !!post.viewer?.like,
    reblogged: !!post.viewer?.repost,
    // TODO: bookmarked, muted - if viewer state includes these in future ATProto versions

    // Fields for DB indexes and threading
    replyParentUri: null,
    replyRootUri: null,

    // Embeds (images, external links, other posts)
    media_attachments: [],
    card: null, // For external link previews

    // Enafore specific fields with defaults or placeholders
    visibility: 'public', // ATProto posts are generally public on AppViews
    application: { name: post.record?.via || 'Unknown (via atproto)' }, // Use 'via' if available
    mentions: [],
    tags: [],
    emojis: [],   // Remains empty, ATProto handles emojis differently
    poll: null,   // Explicitly null as not supported by app.bsky.feed.post
    spoiler_text: '',
    sensitive: false,
  }

  // Handle embeds (images, external links, quoted posts)
  if (post.embed) {
    if (post.embed.$type === 'app.bsky.embed.images#view') {
      enoStatus.media_attachments = post.embed.images.map(img => ({
        id: img.thumb, // No stable ID from Mastodon, use thumb URI for now
        type: 'image', // Assuming image, could be video if supported
        url: img.fullsize,
        preview_url: img.thumb,
        remote_url: img.fullsize,
        description: img.alt,
        blurhash: null, // ATProto doesn't typically provide blurhash here
      }))
    } else if (post.embed.$type === 'app.bsky.embed.external#view') {
      enoStatus.card = {
        url: post.embed.external.uri,
        title: post.embed.external.title,
        description: post.embed.external.description,
        image: post.embed.external.thumb || null, // URL of preview image
        type: 'link',
      }
    } else if (post.embed.$type === 'app.bsky.embed.record#view') {
      // This is a quote post (or reply to a post being quoted)
      // The actual quoted post is in post.embed.record
      // We can represent this as a 'card' or a specific quote structure if Enafore supports it
      // For simplicity, could add to card or a custom 'quote_post' field
      if (post.embed.record.$type === 'app.bsky.feed.defs#postView') { // Check if it's a valid post view
        enoStatus.quote_post = transformAtprotoPostToEnaforeStatus({ post: post.embed.record });
      } else if (post.embed.record.$type === 'app.bsky.embed.record#viewNotFound') {
        enoStatus.quote_post = { error: 'quoted post not found' }
      }
    } else if (post.embed.$type === 'app.bsky.embed.recordWithMedia#view') {
        // Combines a record (e.g. quote post) and media.
        // Handle both post.embed.record.record and post.embed.media
        if (post.embed.record?.record?.$type === 'app.bsky.feed.defs#postView') {
            enoStatus.quote_post = transformAtprotoPostToEnaforeStatus({ post: post.embed.record.record });
        }
        if (post.embed.media?.$type === 'app.bsky.embed.images#view') {
            enoStatus.media_attachments = post.embed.media.images.map(img => ({ /* ... as above ... */ }));
        }
        // Similar for other media types if any
    }
  }

  // Handle replies
  if (reply) {
    if (reply.parent) {
      enoStatus.in_reply_to_id = reply.parent.uri // URI of the parent post
      enoStatus.in_reply_to_account_id = reply.parent.author.did // DID of parent post's author
      enoStatus.replyParentUri = reply.parent.uri
    }
    if (reply.root) {
      enoStatus.replyRootUri = reply.root.uri
      // If Enafore has a specific field for root post ID, map it here too.
      // e.g., enoStatus.conversation_id = reply.root.uri (if that's how Enafore handles it)
    }
  }

  // Handle reposts (reason for the post appearing in the feed)
  if (reason && reason.$type === 'app.bsky.feed.defs#reasonRepost') {
    enoStatus.reblog = transformAtprotoPostToEnaforeStatus({ post: post }); // The 'post' is the reblogged item
    // The author of the *repost action* is reason.by
    enoStatus.reblogged_by = {
        id: reason.by.did,
        did: reason.by.did,
        handle: reason.by.handle,
        displayName: reason.by.displayName || reason.by.handle,
        avatar: reason.by.avatar || null,
        acct: reason.by.handle,
        username: reason.by.handle,
    };
    // The created_at of the enoStatus should be the repost's indexedAt time
    enoStatus.createdAt = reason.indexedAt;
    // The ID of this feed item should ideally reflect the repost action's URI if available and distinct
    // For now, the post URI is used, but this could lead to collisions if not careful with list keys
  }

  // Parse facets for mentions and tags
  if (post.record?.facets) {
    const textEncoder = new TextEncoder(); // For byte slice
    const originalTextBytes = textEncoder.encode(post.record.text || "");

    post.record.facets.forEach(facet => {
      facet.features.forEach(feature => {
        // Extract the segment of text this facet applies to
        let segment = ''
        if (originalTextBytes.length > 0 && facet.index && typeof facet.index.byteStart !== 'undefined' && typeof facet.index.byteEnd !== 'undefined') {
            // Ensure byteStart and byteEnd are within bounds
            const byteStart = Math.max(0, facet.index.byteStart);
            const byteEnd = Math.min(originalTextBytes.length, facet.index.byteEnd);
            if (byteStart < byteEnd) {
                 segment = new TextDecoder().decode(originalTextBytes.slice(byteStart, byteEnd));
            }
        }

        if (feature.$type === 'app.bsky.richtext.facet#mention') {
          // The segment for a mention *is* the handle (e.g., "@handle.bsky.social")
          // We need to strip the "@" for username if Enafore expects that.
          const username = segment.startsWith('@') ? segment.substring(1) : segment;
          enoStatus.mentions.push({
            id: feature.did, // DID of the mentioned user
            username: username, // Store the handle text from the facet
            url: `/@${username}`, // More Enafore-like URL (will need base instance/PDS or be relative)
                                 // Or generate based on DID if preferred: `/profile/${feature.did}`
            acct: username, // Store handle as acct for consistency with AP display
          })
        } else if (feature.$type === 'app.bsky.richtext.facet#tag') {
          // The segment for a tag *is* the tag text (e.g., "#tagname")
          // We need to strip the "#" for name if Enafore expects that.
          const tagName = segment.startsWith('#') ? segment.substring(1) : segment;
          if (feature.tag === tagName) { // Sanity check if feature.tag is the same as derived from segment
            enoStatus.tags.push({
              name: tagName,
              url: `/tags/${tagName}`, // Placeholder URL scheme
            })
          } else {
            // If feature.tag (from lex) and segment differ, prefer feature.tag if it exists and is valid
            // This case should be rare if record.text and facets are in sync.
             enoStatus.tags.push({
              name: feature.tag, // feature.tag is the authoritative tag value without '#'
              url: `/tags/${feature.tag}`,
            })
          }
        } else if (feature.$type === 'app.bsky.richtext.facet#link') {
          // Could potentially map links to cards if Enafore uses cards for general links
          // For now, these are just part of the rich text.
        }
      })
    })
  }

  // Handle labels for sensitivity/content warnings
  // Combine labels from the post itself and from the author's profile
  const postLabels = post.labels?.map(label => label.val) || [];
  const authorLabels = post.author.labels?.map(label => label.val) || []; // Labels on the author profile itself
  const allApplicableLabels = new Set([...postLabels, ...authorLabels]);

  // Standard Bluesky content labels that imply sensitivity
  const sensitiveCategories = [
    'porn', 'sexual', 'nudity', // Sexual content
    'gore', 'corpse', 'self-harm', // Violence, self-harm
    // Consider 'nsfl' as a general sensitive flag if present
    // 'graphic-media' could also imply sensitivity
  ];

  // Check for specific content warning labels like "!warn" or "cw"
  // These often precede a user-defined spoiler text.
  const contentWarningLabel = allApplicableLabels.has('!warn') || allApplicableLabels.has('cw');

  if (sensitiveCategories.some(cat => allApplicableLabels.has(cat))) {
    enoStatus.sensitive = true;
  }

  // Attempt to derive spoiler_text if a content warning label is used
  // This is a heuristic. Bluesky doesn't have a dedicated spoiler_text field like Mastodon.
  // Some clients might use a convention like "cw: [spoiler text]" or put it after a "!warn" label.
  // For now, if there's a generic 'content-warning' type label, we might just set a generic spoiler.
  // Or, if a label itself contains the warning text (e.g. some custom label schemes).
  // This part is highly dependent on conventions Enafore wants to adopt for Bluesky content.

  // Example: if a post is labeled 'nsfw' but not with a more specific category, mark sensitive.
  if (allApplicableLabels.has('nsfw') && !enoStatus.sensitive) {
      enoStatus.sensitive = true;
  }

  // If the post is marked as sensitive and no specific spoiler text can be derived from record.text + facets,
  // a generic spoiler might be used by the UI based on enoStatus.sensitive = true.
  // Enafore's `spoiler_text` is often user-defined. ATProto's `!warn` label is the closest.
  // If a `!warn` label is present on the *post itself* (not the author), we could try to infer.
  if (post.labels?.some(l => l.val === '!warn')) {
      enoStatus.sensitive = true; // Ensure sensitive is true if !warn is used
      // A more advanced approach would be to look for text following the "!warn" facet if such a facet existed.
      // For now, a generic spoiler text if !warn is present and sensitive.
      if (!enoStatus.spoiler_text && enoStatus.sensitive) {
          enoStatus.spoiler_text = "Content Warning"; // Generic spoiler
      }
  }

  // Check for "hide" label from moderation services (like Bluesky's default mod service)
  // This might indicate content that should be collapsed or behind a click-through by default.
  if (allApplicableLabels.has('hide')) {
      // Enafore doesn't have a direct "hidden_by_moderation" state on status object.
      // This might be handled by filtering logic before display, or by setting sensitive + generic spoiler.
      if (!enoStatus.sensitive) {
          enoStatus.sensitive = true;
          enoStatus.spoiler_text = enoStatus.spoiler_text || "Content Warning (moderation)";
      }
  }


  return enoStatus
}

/**
 * Fetches a timeline (feed) from ATProto.
 * This can be the user's following feed, an author's feed, or a custom feed by URI.
 * @async
 * @param {string} [algorithm] - The feed identifier.
 *                             - If `undefined` or a known non-URI algorithm name (e.g., 'home_following_feed'), fetches the user's "Following" timeline.
 *                             - If a DID or handle string (e.g., `did:plc:xyz` or `handle.bsky.social`), fetches that user's author feed.
 *                             - If an `at://` URI, fetches that custom feed generator.
 * @param {number} [limit=30] - Number of items to fetch.
 * @param {string} [cursor] - Cursor for pagination.
 * @returns {Promise<{items: Array<object>, headers: object}>}
 *          An object containing an array of transformed Enafore status objects and a headers object with `_atproto_cursor`.
 * @throws {Error} If fetching fails or no active session.
 */
export async function getTimeline (algorithm, limit, cursor) {
  const session = getActiveSessionData()
  if (!session) {
    console.warn('[ATProto Timeline] No active session for getTimeline.')
    throw new Error('No active session. Please login first.')
  }
  console.log(`[ATProto Timeline] Fetching timeline. Algorithm: ${algorithm}, Limit: ${limit}, Cursor: ${cursor}`)

  try {
    const params = { limit, cursor }
    if (algorithm) { // 'algorithm' here can be a feed generator URI for getFeed, or options for getTimeline
      params.feed = algorithm
    }

    let response;
    // Check if 'algorithm' is an actor DID or handle for getAuthorFeed
    // A simple heuristic: if it contains 'did:plc:' or often has more than one dot (e.g., handle.bsky.social)
    // and is not an at:// URI. This needs to be robust.
    // A better way would be for the caller in timeline.js to specify the type of feed.
    // For now, let's assume if 'algorithm' is passed and not an at:// URI, it might be an actor.
    // This will be refined when timeline.js calls this.

    const isActorFeedRequest = params.feed && (params.feed.startsWith('did:') || params.feed.includes('.')); // Simple check
    const isCustomFeedUri = params.feed && params.feed.startsWith('at://');

    if (isCustomFeedUri) {
        console.log(`[ATProto Timeline] Calling agent.app.bsky.feed.getFeed for ${params.feed} with params:`, params)
        response = await agent.app.bsky.feed.getFeed(params) // params include { feed, limit, cursor }
    } else if (isActorFeedRequest) {
        // 'params.feed' here is actually the actor identifier
        const actor = params.feed;
        console.log(`[ATProto Timeline] Calling agent.getAuthorFeed for actor: ${actor} with params:`, { limit: params.limit, cursor: params.cursor })
        response = await agent.getAuthorFeed({ actor, limit: params.limit, cursor: params.cursor })
    } else { // Default "Following" timeline or other named algorithms if supported by getTimeline directly
        let algoParam = params.feed; // if 'algorithm' was passed in params.feed
        if (params.feed) {
          console.log(`[ATProto Timeline] Using algorithm '${algoParam}' for agent.getTimeline.`)
        } else {
          console.log(`[ATProto Timeline] Using default 'Following' feed for agent.getTimeline.`)
        }
        // agent.getTimeline expects 'algorithm' in its direct params, not in a 'feed' property.
        console.log(`[ATProto Timeline] Calling agent.getTimeline with params:`, { algorithm: algoParam, limit: params.limit, cursor: params.cursor })
        response = await agent.getTimeline({ algorithm: algoParam, limit: params.limit, cursor: params.cursor })
    }

    console.log(`[ATProto Timeline] Received ${response.data.feed.length} items. New cursor: ${response.data.cursor}`)
    const items = response.data.feed.map(transformAtprotoPostToEnaforeStatus)

    const headers = {
      _atproto_cursor: response.data.cursor,
      // To somewhat adapt to Enafore's Link header for pagination:
      // This is a conceptual adaptation. Enafore's UI will need to understand this.
      link: response.data.cursor
            ? `<url_placeholder?cursor=${response.data.cursor}>; rel="next"`
            : ''
    }
    // console.log('[ATProto Timeline] Transformed items:', items)
    return { items, headers }

  } catch (error) {
    console.error(`[ATProto Timeline] Failed to fetch timeline (Algorithm/Actor: ${algorithm}, Cursor: ${cursor}):`, error.name, error.message, error)
    let message = `Failed to fetch timeline: ${error.message || 'Unknown error'}`
    if (error.name === 'XRPCError') {
      if (error.status === 401 || error.error === 'AuthenticationRequired' || error.error === 'ExpiredToken') {
        message = 'Your session has expired. Please log in again.'
      } else if (error.status === 400 && error.error === 'InvalidRequest') {
        message = 'There was an issue with the request for this feed.'
         if (error.message && error.message.toLowerCase().includes('feed not found') || error.message.toLowerCase().includes('could not resolve feed')) {
            message = `Feed not found or could not be resolved: ${algorithm || 'default'}.`
        } else if (error.message && error.message.toLowerCase().includes('actor not found')) {
            message = `User profile not found: ${algorithm}.`
        }
      } else if (error.status === 404) {
         message = `Feed or user not found: ${algorithm || 'default'}.`
      } else if (error.status >= 500) {
        message = 'The server encountered an error trying to fetch this feed. Please try again later.'
      } else {
        message = `Timeline error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`
      }
    } else if (error.message.includes('NetworkError') || error.message.includes('fetch failed')) {
        message = 'Network error. Could not connect to the server to fetch timeline.'
    }
    throw new Error(message)
  }
}
