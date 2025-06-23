import { store } from '../_store/store.js'
import { deleteStatus as apDeleteStatus } from '../_api/delete.js'
import * as atprotoPostsApi from '../_api_atproto/posts.js'
import { toast } from '../_components/toast/toast.js'
import { deleteStatus as deleteStatusLocally } from './deleteStatuses.js' // This likely needs protocol awareness too
import { formatIntl } from '../_utils/formatIntl.js'

export async function doDeleteStatus (statusId) { // statusId for ATProto should be post URI
  const { currentInstance, accessToken, currentAccountProtocol } = store.get()

  let networkPromise
  let idForLocalDelete = statusId // For AP, statusId is the ID. For ATProto, it's the URI.

  try {
    if (currentAccountProtocol === 'atproto') {
      if (typeof statusId !== 'string' || !statusId.startsWith('at://')) {
        console.error('[Action Delete] Invalid statusId for ATProto delete, expected post URI:', statusId)
        toast.say('Error: Invalid post information for delete.')
        throw new Error('Invalid post URI for ATProto delete.')
      }
      networkPromise = atprotoPostsApi.deletePost(statusId)
      // idForLocalDelete remains statusId (the URI)
    } else { // ActivityPub
      networkPromise = apDeleteStatus(currentInstance, accessToken, statusId)
      // idForLocalDelete remains statusId (the numeric/string ID)
    }

    const deletedResponse = await networkPromise // For AP, this is the deleted status. For ATProto, it's void.

    // deleteStatusLocally needs to be protocol-aware or handle both types of IDs.
    // It likely removes the status from various store arrays (timelines, etc.) and DB.
    deleteStatusLocally(currentInstance, idForLocalDelete, currentAccountProtocol)

    toast.say('intl.statusDeleted')

    // For AP, deletedStatus was returned. For ATProto, response is void, but we can return a success indicator.
    return currentAccountProtocol === 'atproto' ? { success: true, id: idForLocalDelete } : deletedResponse
  } catch (e) {
    console.error('[Action Delete] Error:', e)
    toast.say(formatIntl('intl.unableToDelete', { error: (e.message || '') }))
    throw e // Re-throw to allow UI to handle if needed
  }
}
