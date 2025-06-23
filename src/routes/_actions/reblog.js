import { store } from '../_store/store.js'
import { toast } from '../_components/toast/toast.js'
import { reblogStatus as apReblogStatus, unreblogStatus as apUnreblogStatus } from '../_api/reblog.js'
import * as atprotoPostsApi from '../_api_atproto/posts.js'
import { database } from '../_database/database.js'
import { formatIntl } from '../_utils/formatIntl.js'

export async function setReblogged (statusId, reblogged) {
  const { online, currentInstance, accessToken, currentAccountProtocol } = store.get() // Combined get()

  if (!online) {
    toast.say(reblogged ? 'intl.cannotReblogOffline' : 'intl.cannotUnreblogOffline')
    return
  }

  let networkPromise

  if (currentAccountProtocol === 'atproto') {
    // For ATProto, statusId needs to be an object: { uri, cid, repostUri }
    // uri and cid are for the post being reposted.
    // repostUri is the URI of the repost record itself, needed for un-reposting.
    const { uri, cid, repostUri: existingRepostUri } = statusId
    if (!uri || !cid) {
      console.error('[Action reblog] ATProto repost/unrepost missing URI or CID in statusId object:', statusId)
      toast.say('Error: Missing post information for repost action.')
      return
    }
    if (!reblogged && !existingRepostUri) {
      console.error('[Action reblog] ATProto unrepost missing repostUri in statusId object:', statusId)
      // Attempt to find the repost URI from the current post data in the store if available
      const postInStore = store.getPostByUri(uri) // Assumes such a getter
      if (postInStore && postInStore.my_repost_uri) { // Assuming my_repost_uri is stored
          console.warn(`[Action reblog] ATProto unrepost missing repostUri, using fallback my_repost_uri: ${postInStore.my_repost_uri}`)
          statusId.repostUri = postInStore.my_repost_uri;
           if (!statusId.repostUri) {
            toast.say('Error: Cannot un-repost, repost information missing.')
            return
          }
      } else {
        toast.say('Error: Cannot un-repost, repost information missing.')
        return;
      }
    }
    networkPromise = reblogged
      ? atprotoPostsApi.repostPost(uri, cid)
      : atprotoPostsApi.deleteRepost(statusId.repostUri)
  } else { // ActivityPub
    networkPromise = reblogged
      ? apReblogStatus(currentInstance, accessToken, statusId) // statusId is just ID string for AP
      : apUnreblogStatus(currentInstance, accessToken, statusId)
  }

  // Optimistic update
  const idForStoreModification = currentAccountProtocol === 'atproto' ? statusId.uri : statusId;
  store.setStatusReblogged(currentInstance, idForStoreModification, reblogged, currentAccountProtocol);
  // Similar to likes, counts and specific repost URI will update on next fetch or via setPostRepostUri.

  try {
    const response = await networkPromise
    if (currentAccountProtocol === 'atproto' && reblogged && response && response.uri) {
      // Store the URI of the repost record for future un-reposting
      store.setPostRepostUri(currentInstance, statusId.uri, response.uri, reblogged);
    } else if (currentAccountProtocol === 'atproto' && !reblogged) {
      // Clear the repost URI on successful un-repost
      store.setPostRepostUri(currentInstance, statusId.uri, null, reblogged);
    }

    if (currentAccountProtocol !== 'atproto') {
      await database.setStatusReblogged(currentInstance, statusId, reblogged)
    } else {
       // DB update for repost state is now handled by store.setPostRepostUri -> getAtprotoPost/setAtprotoPost
       console.log(`[Action reblog] ATProto repost/unrepost for ${statusId.uri} successful. DB persistence handled by store mixin.`)
    }
  } catch (e) {
    console.error('[Action reblog] Error:', e)
    toast.say(reblogged
      ? formatIntl('intl.failedToReblog', { error: (e.message || '') })
      : formatIntl('intl.failedToUnreblog', { error: (e.message || '') })
    )
    // Undo optimistic update
    store.setStatusReblogged(currentInstance, statusId, !reblogged, currentAccountProtocol, true) // Pass true for undo
  }
}
