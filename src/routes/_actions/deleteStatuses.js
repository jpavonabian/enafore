import { getIdsThatRebloggedThisStatus, getNotificationIdsForStatuses } from './statuses.js'
import { store } from '../_store/store.js'
import atprotoAgent from '../_api_atproto/agent.js' // For getting PDS URL if needed
import { isEqual } from '../_utils/lodash-lite.js'
import { database } from '../_database/database.js' // This should now expose deleteAtprotoPost
import { scheduleIdleTask } from '../_utils/scheduleIdleTask.js'

function filterItemIdsFromTimelines (instanceName, timelineFilter, idFilter) {
  const keys = ['timelineItemSummaries', 'timelineItemSummariesToAdd']
  const summaryFilter = _ => idFilter(_.id)

  keys.forEach(key => {
    const timelineData = store.getAllTimelineData(instanceName, key)
    Object.keys(timelineData).forEach(timelineName => {
      const summaries = timelineData[timelineName]
      if (!timelineFilter(timelineName)) {
        return
      }
      const filteredSummaries = summaries.filter(summaryFilter)
      if (!isEqual(summaries, filteredSummaries)) {
        console.log('deleting an item from timelineName', timelineName, 'for key', key)
        store.setForTimeline(instanceName, timelineName, {
          [key]: filteredSummaries
        })
      }
    })
  })
}

function deleteStatusIdsFromStore (instanceName, idsToDelete) {
  const idsToDeleteSet = new Set(idsToDelete)
  const idWasNotDeleted = id => !idsToDeleteSet.has(id)
  const notNotificationTimeline = timelineName => timelineName !== 'notifications'

  filterItemIdsFromTimelines(instanceName, notNotificationTimeline, idWasNotDeleted)
}

function deleteNotificationIdsFromStore (instanceName, idsToDelete) {
  const idsToDeleteSet = new Set(idsToDelete)
  const idWasNotDeleted = id => !idsToDeleteSet.has(id)
  const isNotificationTimeline = timelineName => timelineName === 'notifications'

  filterItemIdsFromTimelines(instanceName, isNotificationTimeline, idWasNotDeleted)
}

async function deleteStatusesAndNotifications (instanceName, statusIdsToDelete, notificationIdsToDelete) {
  deleteStatusIdsFromStore(instanceName, statusIdsToDelete)
  deleteNotificationIdsFromStore(instanceName, notificationIdsToDelete)
  await database.deleteStatusesAndNotifications(instanceName, statusIdsToDelete, notificationIdsToDelete)
  // Note: No specific atproto equivalent for bulk delete of notifications tied to statuses in this way.
  // ATProto post deletion is handled by deleteAtprotoPostFromDb.
}

async function doDeleteStatus (instanceName, statusId, protocol) { // Added protocol
  console.log(`[Delete Statuses] Deleting statusId: ${statusId}, Protocol: ${protocol}`)

  if (protocol === 'atproto') {
    const pdsHostname = new URL(store.get().atprotoPdsUrls[store.get().currentAtprotoSessionDid] || atprotoAgent.service.toString()).hostname;
    // For ATProto, statusId is the URI. We generally don't delete other people's reposts or related notifications directly.
    // The post itself is deleted. Related records (likes, reposts by others) will point to a deleted record.
    deleteStatusIdsFromStore(instanceName, [statusId]) // Remove from store timelines
    await database.deleteAtprotoPost(pdsHostname, statusId) // Call new DB delete function
    console.log(`[Delete Statuses] ATProto post ${statusId} deleted from DB and store.`)
  } else { // ActivityPub
    const rebloggedIds = await getIdsThatRebloggedThisStatus(instanceName, statusId)
    const statusIdsToDelete = Array.from(new Set([statusId].concat(rebloggedIds).filter(Boolean)))
    const notificationIdsToDelete = Array.from(new Set(await getNotificationIdsForStatuses(instanceName, statusIdsToDelete)))
    await deleteStatusesAndNotifications(instanceName, statusIdsToDelete, notificationIdsToDelete)
    console.log(`[Delete Statuses] ActivityPub status ${statusId} and related items deleted.`)
  }
}

// This is the function called `deleteStatusLocally` by `_actions/delete.js`
export function deleteStatus (instanceName, statusId, protocol = 'activitypub') { // Added protocol, default for existing calls
  scheduleIdleTask(() => {
    /* no await */ doDeleteStatus(instanceName, statusId, protocol)
  })
}
