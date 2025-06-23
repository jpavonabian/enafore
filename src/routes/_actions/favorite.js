import { favoriteStatus as apFavoriteStatus, unfavoriteStatus as apUnfavoriteStatus } from '../_api/favorite.js'
import * as atprotoPostsApi from '../_api_atproto/posts.js'
import { store } from '../_store/store.js'
import { toast } from '../_components/toast/toast.js'
import { database } from '../_database/database.js'
import { formatIntl } from '../_utils/formatIntl.js'

export async function setFavorited (statusId, favorited) {
  const { online } = store.get()
  if (!online) {
    /* no await */ toast.say(favorited ? 'intl.cannotFavoriteOffline' : 'intl.cannotUnfavoriteOffline')
    return
  }
  const { currentInstance, accessToken, currentAccountProtocol, atprotoNotifications } = store.get() // Assuming statusId is { uri, cid, likeUri } for atproto

  let networkPromise
  let statusObjectForStore // To get like URI for atproto un-favorite

  if (currentAccountProtocol === 'atproto') {
    const { uri, cid, likeUri } = statusId // Enafore's statusId will need to be an object for atproto containing these
    if (!uri || !cid) {
      console.error('[Action favorite] ATProto like/unlike missing URI or CID in statusId object:', statusId)
      toast.say('Error: Missing post information for like action.')
      return
    }
    if (!favorited && !likeUri) {
      console.error('[Action favorite] ATProto unlike missing likeUri in statusId object:', statusId)
      // Attempt to find the like URI from the current post data in the store if available
      // This is a fallback, ideally likeUri is passed in.
      // This requires `atprotoNotifications` to be the current timeline/post list.
      // A better approach would be to ensure the component calling setFavorited has the full post object.
      const postInStore = store.getPostByUri(uri) // Assumes such a getter exists that searches timelines
      if (postInStore && postInStore.my_like_uri) { // Assuming my_like_uri is stored on the transformed post
          console.warn(`[Action favorite] ATProto unlike missing likeUri, using fallback my_like_uri: ${postInStore.my_like_uri}`)
          statusId.likeUri = postInStore.my_like_uri;
          if (!statusId.likeUri) {
            toast.say('Error: Cannot unlike, like information missing.')
            return
          }
      } else {
        toast.say('Error: Cannot unlike, like information missing.')
        return;
      }
    }
    networkPromise = favorited
      ? atprotoPostsApi.likePost(uri, cid)
      : atprotoPostsApi.deleteLike(statusId.likeUri) // statusId.likeUri needs to be the URI of the like record
  } else { // ActivityPub
    networkPromise = favorited
      ? apFavoriteStatus(currentInstance, accessToken, statusId) // statusId is just the ID string for AP
      : apUnfavoriteStatus(currentInstance, accessToken, statusId)
  }

  // Optimistic update
  const idForStoreModification = currentAccountProtocol === 'atproto' ? statusId.uri : statusId;
  store.setStatusFavorited(currentInstance, idForStoreModification, favorited, currentAccountProtocol);
  // For ATProto, we also need to optimistically update like counts and potentially the viewer's like URI on the status object
  // This is more involved as it requires finding the status in various store locations.
  // For now, the boolean flag is set. Counts and specific like URI will update on next fetch or via setPostLikeUri.

  try {
    const response = await networkPromise
    if (currentAccountProtocol === 'atproto' && favorited && response && response.uri) {
      // Store the URI of the like record for future unliking and update the specific status object
      store.setPostLikeUri(currentInstance, statusId.uri, response.uri, favorited);
    } else if (currentAccountProtocol === 'atproto' && !favorited) {
      // Clear the like URI on successful unlike
      store.setPostLikeUri(currentInstance, statusId.uri, null, favorited);
    }

    // For ActivityPub, database.setStatusFavorited handles it.
    // For ATProto, we need a similar DB update for the post's like state/count and potentially the like record URI.
    // This might be part of a larger `updateAtprotoPostInDb` function.
    // For now, the optimistic update to the store is the main part.
    // The actual like count is on the post record and would be updated on next fetch.
    // We could also update the local post object in DB with new like count if API returned it.
    if (currentAccountProtocol !== 'atproto') {
        await database.setStatusFavorited(currentInstance, statusId, favorited)
    } else {
        // TODO: Persist the like state for atproto post in DB if needed beyond store's optimistic update
        // e.g., update a `is_liked_by_me` flag and `my_like_uri` on the stored ATProto post.
        // This would require a function like `database.setAtprotoPostLikedState(pdsHostname, postUri, liked, likeUri)`
        console.log(`[Action favorite] ATProto like/unlike for ${statusId.uri} successful. DB update for like state pending.`)
    }

  } catch (e) {
    console.error('[Action favorite] Error:', e)
    toast.say(favorited
      ? formatIntl('intl.unableToFavorite', { error: (e.message || '') })
      : formatIntl('intl.unableToUnfavorite', { error: (e.message || '') })
    )
    // Undo optimistic update
    store.setStatusFavorited(currentInstance, statusId, !favorited, currentAccountProtocol, true) // Pass true to indicate undo
  }
}
