import { store } from '../_store/store.js'
import { toast } from '../_components/toast/toast.js'
import { postStatus as apPostStatusToServer, putStatus as apPutStatusToServer } from '../_api/statuses.js'
import * as atprotoPostsApi from '../_api_atproto/posts.js'
import { addStatusOrNotification } from './addStatusOrNotification.js'
import { database } from '../_database/database.js'
import { emit } from '../_utils/eventBus.ts'
import { putMediaMetadata } from '../_api/media.js'
import { scheduleIdleTask } from '../_utils/scheduleIdleTask.js'
import { uniqById } from '../_utils/lodash-lite.js'
import { formatIntl } from '../_utils/formatIntl.js'
import { rehydrateStatusOrNotification } from './rehydrateStatusOrNotification.js'

export async function insertHandleForReply (realm, statusId) {
  const { currentInstance } = store.get()
  const status = await database.getStatus(currentInstance, statusId)
  const { currentVerifyCredentials } = store.get()
  const originalStatus = status.reblog || status
  let accounts = [originalStatus.account].concat(originalStatus.mentions || [])
    .filter(account => account.id !== currentVerifyCredentials.id)
  // Pleroma includes account in mentions as well, so make uniq
  accounts = uniqById(accounts)
  if (!store.getComposeData(realm, 'text') && accounts.length) {
    store.setComposeData(realm, {
      text: accounts.map(account => `@${account.acct} `).join('')
    })
  }
}

export async function postStatus (realm, text, inReplyToId, mediaIds,
  sensitive, spoilerText, visibility,
  mediaDescriptions, inReplyToUuid, poll, mediaFocalPoints, contentType, quoteId, localOnly, editId) {
  // For ATProto: inReplyToId should be an object { parentUri, parentCid, rootUri, rootCid }
  // mediaIds for ATProto would be an array of prepared embed objects (e.g., image blob refs)
  // sensitive, spoilerText, visibility, poll, contentType, localOnly are Mastodon specific for now.
  const { currentInstance, accessToken, online, currentAccountProtocol } = store.get()

  if (!online) {
    toast.say('intl.cannotPostOffline')
    return
  }

  text = text || ''

  const mediaMetadata = (mediaIds || []).map((mediaId, idx) => {
    return {
      description: mediaDescriptions && mediaDescriptions[idx],
      focalPoint: mediaFocalPoints && mediaFocalPoints[idx]
    }
  })

  store.set({ postingStatus: true })
  try {
    await Promise.all(mediaMetadata.map(async ({ description, focalPoint }, i) => {
      description = description || ''
      focalPoint = focalPoint || [0, 0]
      focalPoint[0] = focalPoint[0] || 0
      focalPoint[1] = focalPoint[1] || 0
      if (description || focalPoint[0] || focalPoint[1]) {
        return putMediaMetadata(currentInstance, accessToken, mediaIds[i], description, focalPoint)
      }
    }))

    if (currentAccountProtocol === 'atproto') {
      if (editId) {
        console.warn('[Action compose] Editing posts is not yet supported for ATProto.')
        toast.say('Editing posts is not yet supported for Bluesky accounts.')
        store.set({ postingStatus: false })
        return
      }

      // Prepare data for atprotoPostsApi.createPost
      const atpPostDetails = { text }
      if (inReplyToId && typeof inReplyToId === 'object' && inReplyToId.parentUri && inReplyToId.parentCid) {
        atpPostDetails.replyToUri = inReplyToId.parentUri // This is the direct parent
        atpPostDetails.replyToCid = inReplyToId.parentCid // This is the direct parent's CID
        // For robust replies, root URI/CID should also be passed if available from `inReplyToId` object.
        // Example: atpPostDetails.replyRootUri = inReplyToId.rootUri; atpPostDetails.replyRootCid = inReplyToId.rootCid;
      }
      // TODO: Handle mediaIds (embeds) - requires image upload and BlobRef generation first
      // TODO: Handle facets (mentions, links, tags) - UI needs to generate these
      // TODO: Handle langs - UI could provide this

      const { uri: newPostUri, cid: newPostCid } = await atprotoPostsApi.createPost(atpPostDetails)
      console.log(`[Action compose] ATProto post created: ${newPostUri}`)

      // After posting, ATProto doesn't return the full post object.
      // We need to either fetch it, or construct a partial one to add to timelines.
      // For now, let's try to fetch it to get a full object for consistency.
      // This could be slow. A more optimistic update would construct a local partial status.
      // This also assumes `getAtprotoPost` can fetch and transform.
      // A better approach might be to use agent.getPostThread({ uri: newPostUri, depth: 0 })
      // then transform the result. For now, this is a placeholder for proper local insertion.

      // --- Placeholder for fetching the newly created post ---
      // const newPost = await store.fetchAndTransformAtprotoPost(newPostUri); // Conceptual
      // if (newPost) {
      //   addStatusOrNotification(currentInstance, 'home', newPost); // currentInstance is PDS hostname
      // } else {
      //   console.warn(`[Action compose] Could not fetch newly created ATProto post ${newPostUri} for timeline update.`)
      // }
      // For a simpler optimistic update (without fetching):
      const optimisticPost = {
        id: newPostUri, uri: newPostUri, cid: newPostCid, content: text, protocol: 'atproto',
        author: store.getCurrentAtprotoUser(), // This is async, so call it earlier or use cached user
        createdAt: new Date().toISOString(),
        // ... other essential fields for display ...
        // This needs to be a fully fleshed out Enafore status object
      };
      // addStatusOrNotification(currentInstance, 'home', optimisticPost) // This needs getCurrentAtprotoUser to be sync or data pre-fetched.
      console.log('[Action compose] TODO: Optimistically add ATProto post to timeline or re-fetch timeline.')
      emit('postedStatus', realm, inReplyToUuid) // Notify UI
      // TODO: Fetch updated timeline or user feed to see the new post.

    } else { // ActivityPub
      if (editId) {
        const status = await apPutStatusToServer(currentInstance, accessToken, editId, text,
          inReplyToId, mediaIds, sensitive, spoilerText, visibility, poll, contentType, quoteId, localOnly)
        await database.insertStatus(currentInstance, status)
        await rehydrateStatusOrNotification({ status })
        emit('statusUpdated', status)
        emit('postedStatus', realm, inReplyToUuid)
      } else {
        const status = await apPostStatusToServer(currentInstance, accessToken, text,
          inReplyToId, mediaIds, sensitive, spoilerText, visibility, poll, contentType, quoteId, localOnly)
        addStatusOrNotification(currentInstance, 'home', status)
        emit('postedStatus', realm, inReplyToUuid)
      }
    }
    store.clearComposeData(realm)
    scheduleIdleTask(() => (mediaIds || []).forEach(mediaId => database.deleteCachedMediaFile(mediaId)))
  } catch (e) {
    console.error('[Action compose] Error:', e)
    toast.say(formatIntl('intl.unableToPost', { error: (e.message || '') }))
  } finally {
    store.set({ postingStatus: false })
  }
}

export function setReplySpoiler (realm, spoiler) {
  const contentWarning = store.getComposeData(realm, 'contentWarning')
  const contentWarningShown = store.getComposeData(realm, 'contentWarningShown')
  if (typeof contentWarningShown !== 'undefined' || contentWarning) {
    return // user has already interacted with the CW
  }
  store.setComposeData(realm, {
    contentWarning: spoiler,
    contentWarningShown: true
  })
}

const PRIVACY_LEVEL = {
  direct: 1,
  private: 2,
  unlisted: 3,
  public: 4
}

export function setReplyVisibility (realm, replyVisibility) {
  // return the most private between the user's preferred default privacy
  // and the privacy of the status they're replying to
  const postPrivacy = store.getComposeData(realm, 'postPrivacy')
  if (typeof postPrivacy !== 'undefined') {
    return // user has already set the postPrivacy
  }
  const { currentVerifyCredentials } = store.get()
  const defaultVisibility = currentVerifyCredentials.source.privacy || 'public'
  const visibility = PRIVACY_LEVEL[replyVisibility] < PRIVACY_LEVEL[defaultVisibility]
    ? replyVisibility
    : defaultVisibility
  store.setComposeData(realm, { postPrivacy: visibility })
}
