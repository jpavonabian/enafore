import agent from './agent.js'
import { getActiveSessionData } from './auth.js'

// Helper to transform atproto post/feed view to Enafore's status structure
function transformAtprotoPostToEnaforeStatus (feedViewPost) {
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
    },
    replyCount: post.replyCount || 0,
    repostCount: post.repostCount || 0,
    likeCount: post.likeCount || 0,
    protocol: 'atproto',
    cid: post.cid, // Content ID of the post record
    indexedAt: post.indexedAt, // When the post was indexed by the AppView

    // Embeds (images, external links, other posts)
    media_attachments: [],
    card: null, // For external link previews

    // Enafore specific fields with defaults or placeholders
    visibility: 'public', // ATProto posts are generally public on AppViews
    application: { name: 'Unknown (via atproto)' }, // Placeholder
    mentions: [], // To be parsed from record.facets or text
    tags: [],     // To be parsed from record.facets or text
    emojis: [],   // Custom emojis, not standard in quite the same way
    spoiler_text: '', // Content warnings are handled differently (labels)
    sensitive: false, // Derived from labels
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
    }
    // reply.root could also be mapped if Enafore uses it
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

  // TODO: Parse facets for mentions and tags
  // post.record.facets
  if (post.record?.facets) {
    post.record.facets.forEach(facet => {
      facet.features.forEach(feature => {
        if (feature.$type === 'app.bsky.richtext.facet#mention') {
          enoStatus.mentions.push({
            id: feature.did, // DID of the mentioned user
            username: '', // Handle might not be in facet, would need resolving or be part of link text
            url: `/profile/${feature.did}`, // Placeholder URL scheme
            acct: feature.did, // Store DID
          })
        } else if (feature.$type === 'app.bsky.richtext.facet#tag') {
          enoStatus.tags.push({
            name: feature.tag,
            url: `/tags/${feature.tag}`, // Placeholder URL scheme
          })
        }
      })
    })
  }

  // TODO: Handle labels for sensitivity/content warnings
  // post.author.labels, post.labels
  const allLabels = (post.author.labels || []).concat(post.labels || []);
  if (allLabels.some(label => ['porn', 'sexual', 'nudity', 'gore'].includes(label.val))) {
      enoStatus.sensitive = true;
      // Note: Bluesky uses granular labels. Enafore uses a single 'sensitive' flag and 'spoiler_text'.
      // A direct mapping for spoiler_text from labels is complex.
      // Could use a generic spoiler if sensitive, or if specific 'content-warning' type labels are used.
  }


  return enoStatus
}


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
    if (params.feed && params.feed.startsWith('at://')) { // This is a custom feed URI
        console.log(`[ATProto Timeline] Calling agent.app.bsky.feed.getFeed with params:`, params)
        response = await agent.app.bsky.feed.getFeed(params)
    } else { // Default "Following" timeline or other named algorithms if supported by getTimeline directly
        if (params.feed) {
          params.algorithm = params.feed; // agent.getTimeline uses 'algorithm' query param
          console.log(`[ATProto Timeline] Using algorithm '${params.algorithm}' for agent.getTimeline.`)
        } else {
          console.log(`[ATProto Timeline] Using default 'Following' feed for agent.getTimeline.`)
        }
        delete params.feed;
        console.log(`[ATProto Timeline] Calling agent.getTimeline with params:`, params)
        response = await agent.getTimeline(params)
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
    console.error(`[ATProto Timeline] Failed to fetch timeline (Algorithm: ${algorithm}, Cursor: ${cursor}):`, error)
    if (error.name === 'XRPCError' && (error.status === 401 || error.message.includes('Authentication Required') || error.message.includes('ExpiredToken'))) {
      console.warn('[ATProto Timeline] Session expired or invalid.')
      throw new Error('Session expired or invalid. Please login again.')
    }
    throw error
  }
}
