import { store } from '../_store/store.js'
import { toast } from '../_components/toast/toast.js'
import { bookmarkStatus as apBookmarkStatus, unbookmarkStatus as apUnbookmarkStatus } from '../_api/bookmark.js'
// ATProto bookmarks are client-side and handled by atprotoMixins in the store directly.
// No direct API calls to atprotoPostsApi for bookmarks in the same way as likes/reposts.
import { database } from '../_database/database.js' // For AP database updates
import { formatIntl } from '../_utils/formatIntl.js'

export async function setStatusBookmarkedOrUnbookmarked (statusId, bookmarked) {
  // For ATProto, statusId should be the post URI string.
  // For AP, statusId is the status ID string.
  const { currentInstance, accessToken, currentAccountProtocol } = store.get()

  try {
    if (currentAccountProtocol === 'atproto') {
      const postUri = typeof statusId === 'object' ? statusId.uri : statusId; // Ensure we get the URI string
      if (!postUri) {
        console.error('[Action bookmark] ATProto: Missing post URI for bookmark action.', statusId)
        toast.say('Error: Missing post information for bookmark action.')
        return
      }
      console.log(`[Action bookmark] ATProto: ${bookmarked ? 'Bookmarking' : 'Unbookmarking'} post ${postUri}`)
      if (bookmarked) {
        await store.addAtprotoBookmark(postUri) // This mixin handles store and DB
      } else {
        await store.removeAtprotoBookmark(postUri) // This mixin handles store and DB
      }
      // Toast messages are handled within the store mixins for ATProto bookmarks.
      // store.setStatusBookmarked is also effectively handled by the mixins updating client_isBookmarked.
    } else { // ActivityPub
      console.log(`[Action bookmark] AP: ${bookmarked ? 'Bookmarking' : 'Unbookmarking'} status ${statusId} on ${currentInstance}`)
      if (bookmarked) {
        await apBookmarkStatus(currentInstance, accessToken, statusId)
      } else {
        await apUnbookmarkStatus(currentInstance, accessToken, statusId)
      }
      if (bookmarked) {
        /* no await */ toast.say('intl.bookmarkedStatus')
      } else {
        /* no await */ toast.say('intl.unbookmarkedStatus')
      }
      // Optimistic UI update for AP
      store.setStatusBookmarked(currentInstance, statusId, bookmarked, currentAccountProtocol)
      // Persist to DB for AP
      await database.setStatusBookmarked(currentInstance, statusId, bookmarked)
    }
  } catch (e) {
    console.error('[Action bookmark] Error:', e)
    /* no await */toast.say(
      bookmarked
        ? formatIntl('intl.unableToBookmark', { error: (e.message || '') })
        : formatIntl('intl.unableToUnbookmark', { error: (e.message || '') })
    )
    // For AP, we might want to revert optimistic update.
    // For ATProto, the store mixins might handle their own error states or reversions if necessary.
    if (currentAccountProtocol !== 'atproto') {
      store.setStatusBookmarked(currentInstance, statusId, !bookmarked, currentAccountProtocol, true) // Undo optimistic
    }
  }
}
    )
  }
}
