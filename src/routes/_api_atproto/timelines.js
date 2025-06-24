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
  const { post, reply, reason } = feedViewPost;
  const session = getActiveSessionData(); // For checking current user interactions

  if (reason && reason.$type === 'app.bsky.feed.defs#reasonRepost') {
    // This item represents the REPOST ACTION.
    // `post` is the original post that was reposted.
    // `reason.by` is the reposter.
    // `reason.indexedAt` is the timestamp of the repost.

    const originalPostTransformed = transformAtprotoPostToEnaforeStatus({
      post: post, // The original post
      reply: post.reply, // Pass original post's reply context for the nested object
      reason: null // No reason for the nested original post
    });

    if (!originalPostTransformed) { // Should not happen if post is valid
        console.warn('[ATProto Transform] Failed to transform original post within a repost view:', feedViewPost);
        return null;
    }

    const reposterAccount = transformProfileViewBasicToEnaforeAccount(reason.by, null); // PDS for reposter acct might be unknown here

    // Construct a synthetic ID for this repost action in the timeline
    const syntheticRepostId = `repost:${reason.by.did}:${post.uri}`;

    return {
      id: syntheticRepostId,
      uri: syntheticRepostId, // Or link to original post: post.uri
      url: originalPostTransformed.url, // Link to the original post's web view
      content: '', // Repost action itself has no content
      plainTextContent: '',
      createdAt: reason.indexedAt, // Timestamp of the repost action
      editedAt: null,
      account: reposterAccount, // The user who reposted
      reblog: originalPostTransformed, // The original post is nested here
      reblogged_by: null, // Not applicable for the wrapper itself

      visibility: 'public', // Reposts are public
      sensitive: originalPostTransformed.sensitive, // Inherit sensitivity from original post
      spoilerText: originalPostTransformed.spoiler_text, // Inherit spoiler from original

      mediaAttachments: [], card: null, poll: null, quote: null, // No direct media/card/poll/quote on the repost action
      mentions: [], tags: [], emojis: [],
      application: reposterAccount?.application || { name: 'Unknown (via atproto)' }, // Could try to find reposting app if available later
      language: null, // Repost action has no language

      inReplyToId: null, // Repost is not a reply
      inReplyToAccountId: null,
      replyParentUri: null,
      replyRootUri: null,

      replyCount: 0, // Counts are for the repost action itself
      repostCount: 0,
      likeCount: 0,  // Cannot like/repost a repost action itself in ATProto

      favourited: false,
      reblogged: reason.by.did === session?.did, // Is this *my* repost of the original?
      myLikeUri: undefined,
      myRepostUri: (reason.by.did === session?.did) ? post.viewer?.repost : undefined, // URI of *my* repost record of original post
                                                                                    // This assumes post.viewer.repost is for *this current user's* repost.
                                                                                    // If reason.by is me, then this specific FeedViewPost *is* my repost.
                                                                                    // The actual URI of *this* repost record isn't directly in FeedViewPost.reason.
                                                                                    // This field is primarily for UI to know if it can "un-repost".
      client_isBookmarked: false,
      mutedConversation: false,
      pinned: false,
      localOnly: false,
      protocol: 'atproto',
      cid: null, // Repost action itself doesn't have a distinct CID in this view
      indexedAt: reason.indexedAt,
      viewer: null, // Viewer state for the repost action itself isn't a thing
      _raw: feedViewPost, // Keep the raw reason for context if needed
    };
  }

  // If not a repost, proceed with transforming the post itself:
  const enoStatus = {
    id: post.uri,
    uri: post.uri,
    content: post.record?.text || '',
    createdAt: post.record?.createdAt,
    author: transformProfileViewBasicToEnaforeAccount(post.author, null), // Use helper, PDS for acct might be unknown
    url: `https://bsky.app/profile/${post.author.did}/post/${post.uri.split('/').pop()}`,

    replyCount: post.replyCount || 0,
    repostCount: post.repostCount || 0,
    likeCount: post.likeCount || 0,
    protocol: 'atproto',
    cid: post.cid,
    indexedAt: post.indexedAt,
    language: post.record?.langs && post.record.langs.length > 0 ? post.record.langs[0] : null,

    myLikeUri: post.viewer?.like,
    myRepostUri: post.viewer?.repost,
    favorited: !!post.viewer?.like,
    reblogged: !!post.viewer?.repost,
    // client_isBookmarked is a UI/store-level concern, derived from ATPROTO_BOOKMARKS_STORE, not set here.
    mutedConversation: false,
    pinned: false,

    replyParentUri: null,
    replyRootUri: null,

    media_attachments: [],
    card: null,
    quote: null,

    plainTextContent: post.record?.text || '',
    editedAt: null,
    visibility: 'public',
    application: { name: post.record?.via || 'Unknown (via atproto)' },
    mentions: [],
    tags: [],
    emojis: [],
    poll: null,
    spoiler_text: '',
    sensitive: false,
    localOnly: false,
    _raw: feedViewPost // Keep the full FeedViewPost for _raw
  };

  // Handle embeds (images, external links, quoted posts)
  if (post.embed) {
    if (post.embed.$type === 'app.bsky.embed.images#view') {
      enoStatus.media_attachments = post.embed.images.map(img => ({
        id: img.thumb,
        type: 'image',
        url: img.fullsize,
        preview_url: img.thumb,
        remote_url: img.fullsize,
        description: img.alt,
        blurhash: null,
      }))
    } else if (post.embed.$type === 'app.bsky.embed.external#view') {
      enoStatus.card = {
        url: post.embed.external.uri,
        title: post.embed.external.title,
        description: post.embed.external.description,
        image: post.embed.external.thumb || null,
        type: 'link',
      }
    } else if (post.embed.$type === 'app.bsky.embed.record#view') {
      if (post.embed.record?.$type === 'app.bsky.feed.defs#postView') {
        enoStatus.quote = transformAtprotoPostToEnaforeStatus({ post: post.embed.record });
      } else if (post.embed.record?.$type === 'app.bsky.embed.record#viewRecord') {
         enoStatus.quote = transformAtprotoPostToEnaforeStatus({
            post: {
                uri: post.embed.record.uri,
                cid: post.embed.record.cid,
                author: post.embed.record.author,
                value: post.embed.record.value,
                indexedAt: post.embed.record.indexedAt || post.indexedAt,
                labels: post.embed.record.labels,
            }
        });
      } else if (post.embed.record?.$type === 'app.bsky.embed.record#viewNotFound' || post.embed.record?.$type === 'app.bsky.embed.record#viewBlocked') {
        enoStatus.quote = { error: post.embed.record.$type.split('#')[1] , uri: post.embed.record?.uri };
      }
    } else if (post.embed.$type === 'app.bsky.embed.recordWithMedia#view') {
        const recordEmbed = post.embed.record;
        if (recordEmbed?.record?.$type === 'app.bsky.feed.defs#postView') {
            enoStatus.quote = transformAtprotoPostToEnaforeStatus({ post: recordEmbed.record });
        } else if (recordEmbed?.record?.$type === 'app.bsky.embed.record#viewRecord') {
             enoStatus.quote = transformAtprotoPostToEnaforeStatus({
                post: {
                    uri: recordEmbed.record.uri, cid: recordEmbed.record.cid,
                    author: recordEmbed.record.author, value: recordEmbed.record.value,
                    indexedAt: recordEmbed.record.indexedAt || post.indexedAt, labels: recordEmbed.record.labels,
                }
            });
        } else if (recordEmbed?.record?.$type === 'app.bsky.embed.record#viewNotFound' || recordEmbed?.record?.$type === 'app.bsky.embed.record#viewBlocked') {
            enoStatus.quote = { error: recordEmbed.record.$type.split('#')[1], uri: recordEmbed.record?.uri };
        }

        const mediaEmbed = post.embed.media;
        if (mediaEmbed?.$type === 'app.bsky.embed.images#view') {
            enoStatus.media_attachments = mediaEmbed.images.map(img => ({
                id: img.thumb,
                type: 'image',
                url: img.fullsize,
                preview_url: img.thumb,
                remote_url: img.fullsize,
                description: img.alt,
                blurhash: null,
            }));
        } else if (mediaEmbed?.$type === 'app.bsky.embed.external#view') {
            enoStatus.card = {
                url: mediaEmbed.external.uri,
                title: mediaEmbed.external.title,
                description: mediaEmbed.external.description,
                image: mediaEmbed.external.thumb || null,
                type: 'link',
            };
        }
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
