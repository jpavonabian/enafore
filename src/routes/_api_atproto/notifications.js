import agent from './agent.js'
import { transformAtprotoPostToEnaforeStatus } from './timelines.js' // For embedded posts

/**
 * Transforms an ATProto notification item into Enafore's notification structure.
 * @param {object} atpNotification - The notification object from agent.listNotifications().
 * @returns {object} An Enafore-compatible notification object.
 */
export function transformAtprotoNotification (atpNotification) {
  if (!atpNotification || !atpNotification.uri) {
    return null // Or throw error
  }

  const enoNotification = {
    id: atpNotification.uri, // URI of the notification record itself can serve as a unique ID
    type: atpNotification.reason, // e.g., 'like', 'repost', 'follow', 'mention', 'reply', 'quote'
    createdAt: atpNotification.indexedAt, // Timestamp of the notification
    account: null, // The account that caused the notification
    status: null, // The status that is the subject of the notification (if applicable)
    protocol: 'atproto',
    _raw: atpNotification, // Keep raw data for debugging or more detailed views
  }

  // Actor who performed the action
  if (atpNotification.author) {
    enoNotification.account = {
      id: atpNotification.author.did,
      did: atpNotification.author.did,
      handle: atpNotification.author.handle,
      displayName: atpNotification.author.displayName || atpNotification.author.handle,
      avatar: atpNotification.author.avatar || null,
      acct: atpNotification.author.handle, // Enafore style
      username: atpNotification.author.handle,
      protocol: 'atproto',
      // Add other fields Enafore UI might expect for an account
      url: `https://bsky.app/profile/${atpNotification.author.did}`,
    }
  }

  // If the notification is about a post (like, reply, mention, quote, repost of your post)
  // The subject of the notification is often a post.
  // listNotifications provides the subject post directly in `atpNotification.record` if it's a direct notification on a record,
  // or sometimes the details are within reasonSubject if it's a more indirect notification.
  // The exact structure of `atpNotification.record` or `atpNotification.reasonSubject` depends on the notification type.

  // For 'mention', 'reply', 'quote', 'like', 'repost' on one of *your* posts,
  // `atpNotification.record` is usually the post that was actioned upon (your post).
  // However, the `agent.listNotifications()` returns a list of `Notification` objects,
  // where `record` is the *actual record that caused the notification* (e.g. the like record, the reply post).
  // The `reasonSubject` often points to *your* post that was liked/replied to.

  // Example: For a 'like', `atpNotification.record` is the like record (`app.bsky.feed.like`).
  // `atpNotification.reasonSubject` would be the URI of *your post* that was liked.
  // The SDK doesn't automatically fetch and embed the full `reasonSubject` post.
  // This means `transformAtprotoNotification` might need to only store URIs,
  // and the UI layer or a subsequent hydration step would fetch the actual post content if needed.

  // For simplicity here, if `atpNotification.record` looks like a post (e.g. for a mention in a post, or a reply post),
  // we can try to transform it. This is a common pattern for replies and mentions.
  if (atpNotification.record && atpNotification.record.$type === 'app.bsky.feed.post') {
    // This case applies if the notification *is* a post, e.g., a reply or a post mentioning you.
    // We need to reconstruct a FeedViewPost-like structure if transformAtprotoPostToEnaforeStatus expects it.
    // This is a simplified assumption for now.
    const minimalFeedViewPost = {
        post: {
            uri: atpNotification.uri, // URI of the notification-causing record (the reply/mention post)
            cid: atpNotification.cid, // CID of that record
            author: atpNotification.author, // Author of the reply/mention post
            record: atpNotification.record, // The post record itself
            indexedAt: atpNotification.indexedAt,
            // Missing: embed, replyCount, likeCount, repostCount, labels etc. unless listNotifications provides them.
            // These would need to be fetched separately if required for display within the notification.
        }
        // reply & reason might be absent or different in this context
    };
    enoNotification.status = transformAtprotoPostToEnaforeStatus(minimalFeedViewPost);
  } else if (atpNotification.reasonSubject && typeof atpNotification.reasonSubject === 'string' && atpNotification.reasonSubject.startsWith('at://')) {
    // If reasonSubject is a URI, it likely points to the post that is the subject of the notification
    // e.g., your post that was liked or reposted.
    // We don't have the full post details here, just its URI.
    // Store the URI; UI can fetch details if needed.
    enoNotification.status = {
        uri: atpNotification.reasonSubject,
        id: atpNotification.reasonSubject,
        protocol: 'atproto',
        // Mark as partial, so UI knows to fetch more details if necessary
        _isPartial: true
    };
  }

  return enoNotification
}


/**
 * Fetches a list of notifications.
 * @param {number} [limit] - Max number of notifications to fetch.
 * @param {string} [cursor] - Cursor for pagination.
 * @returns {Promise<{notifications: Array<object>, cursor: string|undefined}>}
 */
export async function listNotifications (limit, cursor) {
  if (!agent.hasSession) throw new Error('No active session. Please login first.')
  console.log('[ATProto Notifications API] Listing notifications:', { limit, cursor })
  try {
    const response = await agent.listNotifications({ limit, cursor })
    const transformedNotifications = response.data.notifications.map(transformAtprotoNotification).filter(n => n !== null)

    console.log(`[ATProto Notifications API] Fetched ${transformedNotifications.length} notifications. New cursor: ${response.data.cursor}`)
    return {
      notifications: transformedNotifications,
      cursor: response.data.cursor
    }
  } catch (error) {
    console.error('[ATProto Notifications API] Error listing notifications:', error.name, error.message, error)
    let message = `Failed to list notifications: ${error.message || 'Unknown error'}.`
    if (error.name === 'XRPCError') {
      if (error.status === 401 || error.error === 'AuthenticationRequired' || error.error === 'ExpiredToken') {
        message = 'Your session has expired. Please log in again.'
      } else if (error.status >= 500) {
        message = 'The server encountered an error fetching notifications. Please try again later.'
      } else {
        message = `Notification list error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`
      }
    }
    throw new Error(message)
  }
}

/**
 * Gets the count of unread notifications.
 * @returns {Promise<number>} Count of unread notifications.
 */
export async function countUnreadNotifications () {
  if (!agent.hasSession) throw new Error('No active session. Please login first.')
  console.log('[ATProto Notifications API] Counting unread notifications')
  try {
    const response = await agent.countUnreadNotifications()
    console.log(`[ATProto Notifications API] Unread count: ${response.data.count}`)
    return response.data.count
  } catch (error) {
    console.error('[ATProto Notifications API] Error counting unread notifications:', error.name, error.message, error)
    let message = `Failed to count unread notifications: ${error.message || 'Unknown error'}.`
     if (error.name === 'XRPCError') {
      if (error.status === 401 || error.error === 'AuthenticationRequired' || error.error === 'ExpiredToken') {
        message = 'Your session has expired. Please log in again.'
      } else if (error.status >= 500) {
        message = 'The server encountered an error counting notifications. Please try again later.'
      } else {
        message = `Notification count error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`
      }
    }
    // It might be preferable to return 0 or a specific error object rather than throwing for counts
    // For now, re-throwing a generic message.
    throw new Error(message)
  }
}

/**
 * Updates the last seen time for notifications.
 * @param {string} [seenAt] - ISO timestamp. Defaults to now if not provided.
 * @returns {Promise<void>}
 */
export async function updateSeenNotifications (seenAt) {
  if (!agent.hasSession) throw new Error('No active session. Please login first.')
  const timestamp = seenAt || new Date().toISOString()
  console.log(`[ATProto Notifications API] Updating seen notifications timestamp to: ${timestamp}`)
  try {
    await agent.updateSeenNotifications(timestamp)
    console.log(`[ATProto Notifications API] Successfully updated seen notifications timestamp.`)
  } catch (error) {
    console.error(`[ATProto Notifications API] Error updating seen notifications timestamp:`, error.name, error.message, error)
    let message = `Failed to update seen notifications: ${error.message || 'Unknown error'}.`
     if (error.name === 'XRPCError') {
      if (error.status === 401 || error.error === 'AuthenticationRequired' || error.error === 'ExpiredToken') {
        message = 'Your session has expired. Please log in again.'
      } else if (error.status >= 500) {
        message = 'The server encountered an error. Please try again later.'
      } else {
        message = `Update seen notifications error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`
      }
    }
    throw new Error(message)
  }
}

// TODO:
// - Database integration: Need stores for notifications (ATPROTO_NOTIFICATIONS_STORE) and
//   a timeline-like store for them (ATPROTO_NOTIFICATION_TIMELINES_STORE).
// - Hydration of partial statuses: The `transformAtprotoNotification` currently creates partial
//   status objects if only a URI is available. A mechanism to fetch full details for these
//   statuses when they are about to be displayed might be needed.
// - Handle all notification reasons: Ensure `transformAtprotoNotification` correctly maps all
//   possible `atpNotification.reason` types and extracts relevant data.
// - Enafore specific notification fields: Map any other fields Enafore's UI expects for notifications.
