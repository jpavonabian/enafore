import { store } from '../_store/store.js'
import { getTimeline as getActivityPubTimeline } from '../_api/timelines.js'
import { getTimeline as getAtprotoTimeline } from '../_api_atproto/timelines.js'
import { toast } from '../_components/toast/toast.js'
import { mark, stop } from '../_utils/marks.js'
import { concat, mergeArrays } from '../_utils/arrays.js'
import { compareTimelineItemSummaries } from '../_utils/statusIdSorting.js'
import { isEqual, uniqById } from '../_utils/lodash-lite.js'
import { database } from '../_database/database.js'
import { getStatus, getStatusContext } from '../_api/statuses.js'
import { emit } from '../_utils/eventBus.ts'
import { TIMELINE_BATCH_SIZE } from '../_static/timelines.js'
import { timelineItemToSummary } from '../_utils/timelineItemToSummary.ts'
import { addStatusesOrNotifications } from './addStatusOrNotification.js'
import { scheduleIdleTask } from '../_utils/scheduleIdleTask.js'
import { sortItemSummariesForThread, sortItemSummariesForNotificationBatch } from '../_utils/sortItemSummaries.ts'
import { rehydrateStatusOrNotification } from './rehydrateStatusOrNotification.js'
import li from 'li'

async function storeFreshTimelineItemsInDatabase (instanceName, timelineName, items) {
  console.log('storeFreshTimelineItemsInDatabase start', timelineName)
  await database.insertTimelineItems(instanceName, timelineName, items)
  console.log('storeFreshTimelineItemsInDatabase inserted', timelineName)
}

async function updateStatus_ (instanceName, accessToken, statusId) {
  const status = await getStatus(instanceName, accessToken, statusId)
  await database.insertStatus(instanceName, status)
  return status
}

export async function updateStatus (instanceName, accessToken, statusId) {
  const status = await updateStatus_(instanceName, accessToken, statusId)
  await rehydrateStatusOrNotification({ status })
  emit('statusUpdated', status)
  return status
}

async function updateStatusAndThread (instanceName, accessToken, timelineName, statusId) {
  const [status, context] = await Promise.all([
    updateStatus_(instanceName, accessToken, statusId),
    getStatusContext(instanceName, accessToken, statusId).catch((e) => {
      console.warn(e)
      return { ancestors: [], descendants: [] }
    })
  ])
  const newStatuses = concat(context.ancestors, status, context.descendants)
  await database.insertTimelineItems(
    instanceName,
    timelineName,
    newStatuses
  )
  addStatusesOrNotifications(instanceName, timelineName, newStatuses)
}

async function fetchFreshThreadFromNetwork (instanceName, accessToken, statusId) {
  const [status, context] = await Promise.all([
    getStatus(instanceName, accessToken, statusId),
    getStatusContext(instanceName, accessToken, statusId)
  ])
  return concat(context.ancestors, status, context.descendants)
}

async function fetchThreadFromNetwork (instanceName, accessToken, timelineName) {
  const statusId = timelineName.split('/').slice(-1)[0]

  // For threads, we do several optimizations to make it a bit faster to load.
  // The vast majority of statuses have no replies and aren't in reply to anything,
  // so we want that to be as fast as possible.
  const status = await database.getStatus(instanceName, statusId)
  if (!status) {
    // If for whatever reason the status is not cached, fetch everything from the network
    // and wait for the result. This happens in very unlikely cases (e.g. loading /statuses/<id>
    // where <id> is not cached locally) but is worth covering.
    return fetchFreshThreadFromNetwork(instanceName, accessToken, statusId)
  }

  if (!status.in_reply_to_id) {
    // status is not a reply to another status (fast path)
    // Update the status and thread asynchronously, but return just the status for now
    // Any replies to the status will load asynchronously
    /* no await */ updateStatusAndThread(instanceName, accessToken, timelineName, statusId)
    return [status]
  }
  // status is a reply to some other status, meaning we don't want some
  // jerky behavior where it suddenly scrolls into place. Update the status asynchronously
  // but grab the thread now
  scheduleIdleTask(() => updateStatus(instanceName, accessToken, statusId))
  const context = await getStatusContext(instanceName, accessToken, statusId)
  return concat(context.ancestors, status, context.descendants)
}

async function fetchTimelineItemsFromNetwork (instanceName, accessToken, timelineName, lastTimelineItemId) {
  const { currentAccountProtocol } = store.get()
  console.log(`[Timeline Action] fetchTimelineItemsFromNetwork for ${instanceName}, timeline: ${timelineName}, protocol: ${currentAccountProtocol}, lastItemId/cursor: ${lastTimelineItemId}`)

  if (timelineName.startsWith('status/')) { // special case - this is a list of descendents and ancestors
    // TODO: ATProto thread fetching if currentAccountProtocol is 'atproto'
    console.log(`[Timeline Action] Fetching thread for status: ${timelineName.split('/')[1]}`)
    // For now, falls through to ActivityPub version or needs its own ATProto thread logic
    return fetchThreadFromNetwork(instanceName, accessToken, timelineName)
  } else { // normal timeline
    if (currentAccountProtocol === 'atproto') {
      console.log(`[Timeline Action] Fetching ATProto timeline. Enafore timeline: ${timelineName}`)
      // For ATProto, lastTimelineItemId is the cursor.
      // timelineName could be 'home', 'discover', or a feed URI (at://...)
      let atprotoAlgorithm = timelineName // This needs proper mapping
      if (timelineName === 'home') {
        atprotoAlgorithm = undefined; // Default 'Following' feed for getAtprotoTimeline
        console.log(`[Timeline Action] Mapped Enafore 'home' to default ATProto 'Following' feed.`)
      }
      // TODO: map other Enafore timelineNames (e.g., 'local', 'federated', 'notifications') to ATProto algorithms or feed URIs

      const { items, headers } = await getAtprotoTimeline(atprotoAlgorithm, TIMELINE_BATCH_SIZE, lastTimelineItemId)
      console.log(`[Timeline Action] ATProto timeline fetched. Items: ${items.length}, New Cursor: ${headers._atproto_cursor}`)
      // Store cursor for next fetch. Enafore uses timelineNextPageId.
      // The getAtprotoTimeline returns _atproto_cursor in headers.
      store.setForTimeline(instanceName, timelineName, { timelineNextPageId: headers._atproto_cursor })
      return items
    } else {
      console.log(`[Timeline Action] Fetching ActivityPub timeline for ${instanceName}, timeline: ${timelineName}`)
      const { items } = await getActivityPubTimeline(instanceName, accessToken, timelineName, lastTimelineItemId, null, TIMELINE_BATCH_SIZE)
      console.log(`[Timeline Action] ActivityPub timeline fetched. Items: ${items.length}`)
      return items
    }
  }
}
async function addPagedTimelineItems (instanceName, timelineName, items) {
  console.log('addPagedTimelineItems, length:', items.length)
  mark('addPagedTimelineItemSummaries')
  const newSummaries = items.map(item => timelineItemToSummary(item, instanceName))
  await addPagedTimelineItemSummaries(instanceName, timelineName, newSummaries)
  stop('addPagedTimelineItemSummaries')
}

export async function addPagedTimelineItemSummaries (instanceName, timelineName, newSummaries) {
  const [type, statusId] = timelineName.split('/')
  const oldSummaries = store.getForTimeline(instanceName, timelineName, 'timelineItemSummaries')

  if (type === 'notifications') {
    newSummaries = sortItemSummariesForNotificationBatch(newSummaries)
  }

  let mergedSummaries = uniqById(concat(oldSummaries || [], newSummaries))

  if (type === 'status') {
    mergedSummaries = sortItemSummariesForThread(mergedSummaries, statusId)
  }

  if (!isEqual(oldSummaries, mergedSummaries)) {
    store.setForTimeline(instanceName, timelineName, { timelineItemSummaries: mergedSummaries })
  }
}

async function fetchPagedItems (instanceName, accessToken, timelineName) {
  const { timelineNextPageId } = store.get() // This is used as 'max_id' for AP or 'cursor' for ATProto
  const { currentAccountProtocol } = store.get()
  console.log(`[Timeline Action] fetchPagedItems for ${instanceName}, timeline: ${timelineName}, protocol: ${currentAccountProtocol}, current next page ID/cursor: ${timelineNextPageId}`)

  let items
  let newNextPageId

  if (currentAccountProtocol === 'atproto') {
    console.log(`[Timeline Action] Paging ATProto timeline: ${timelineName}`)
    // TODO: Map Enafore timelineName to ATProto algorithm/feed URI for paged fetch
    let atprotoAlgorithm = timelineName
    if (timelineName === 'home') {
        atprotoAlgorithm = undefined;
        console.log(`[Timeline Action] Mapped Enafore 'home' to default ATProto 'Following' feed for paging.`)
    }
    // TODO: map other Enafore timelineNames

    const { items: atpItems, headers: atpHeaders } = await getAtprotoTimeline(atprotoAlgorithm, TIMELINE_BATCH_SIZE, timelineNextPageId)
    items = atpItems
    newNextPageId = atpHeaders._atproto_cursor // Use the returned cursor
    console.log(`[Timeline Action] ATProto paged fetch. Items: ${items.length}, New Cursor: ${newNextPageId}`)
    // Note: atproto_cursor might be undefined if no more items
  } else {
    console.log(`[Timeline Action] Paging ActivityPub timeline for ${instanceName}, timeline: ${timelineName}`)
    const { items: apItems, headers: apHeaders } = await getActivityPubTimeline(instanceName, accessToken, timelineName, timelineNextPageId, null, TIMELINE_BATCH_SIZE)
    items = apItems
    const linkHeader = apHeaders.get('Link')
    const parsedLinkHeader = li.parse(linkHeader)
    const nextUrl = parsedLinkHeader && parsedLinkHeader.next
    newNextPageId = nextUrl && (new URL(nextUrl)).searchParams.get('max_id')
    console.log(`[Timeline Action] ActivityPub paged fetch. Items: ${items.length}, Next Max ID: ${newNextPageId}`)
  }

  console.log('[Timeline Action] Updating timelineNextPageId in store to:', newNextPageId)
  store.setForTimeline(instanceName, timelineName, { timelineNextPageId: newNextPageId })

  console.log('[Timeline Action] Storing fresh paged items in database...')
  await storeFreshTimelineItemsInDatabase(instanceName, timelineName, items) // This DB might need protocol awareness

  console.log('[Timeline Action] Adding paged items to store summaries...')
  await addPagedTimelineItems(instanceName, timelineName, items)
}

async function fetchTimelineItems (instanceName, accessToken, timelineName, online) {
  mark('fetchTimelineItems')
  const { lastTimelineItemId } = store.get()
  let items
  let stale = false
  if (!online) {
    items = await database.getTimeline(instanceName, timelineName, lastTimelineItemId, TIMELINE_BATCH_SIZE)
    stale = true
  } else {
    try {
      console.log('fetchTimelineItemsFromNetwork')
      items = await fetchTimelineItemsFromNetwork(instanceName, accessToken, timelineName, lastTimelineItemId)
      await storeFreshTimelineItemsInDatabase(instanceName, timelineName, items)
    } catch (e) {
      console.error(e)
      /* no await */ toast.say('intl.showingOfflineContent')
      items = await database.getTimeline(instanceName, timelineName, lastTimelineItemId, TIMELINE_BATCH_SIZE)
      stale = true
    }
  }
  stop('fetchTimelineItems')
  return { items, stale }
}

async function addTimelineItems (instanceName, timelineName, items, stale) {
  console.log('addTimelineItems, length:', items.length)
  mark('addTimelineItemSummaries')
  const newSummaries = items.map(item => timelineItemToSummary(item, instanceName))
  addTimelineItemSummaries(instanceName, timelineName, newSummaries, stale)
  stop('addTimelineItemSummaries')
}

export async function addTimelineItemSummaries (instanceName, timelineName, newSummaries, newStale) {
  const [type, statusId] = timelineName.split('/')
  const oldSummaries = store.getForTimeline(instanceName, timelineName, 'timelineItemSummaries')
  const oldStale = store.getForTimeline(instanceName, timelineName, 'timelineItemSummariesAreStale')

  if (type === 'notifications') {
    newSummaries = sortItemSummariesForNotificationBatch(newSummaries)
  }

  let mergedSummaries = uniqById(mergeArrays(oldSummaries || [], newSummaries, compareTimelineItemSummaries))

  if (type === 'status') {
    mergedSummaries = sortItemSummariesForThread(mergedSummaries, statusId)
  }

  if (!isEqual(oldSummaries, mergedSummaries)) {
    store.setForTimeline(instanceName, timelineName, { timelineItemSummaries: mergedSummaries })
  }
  if (oldStale !== newStale) {
    store.setForTimeline(instanceName, timelineName, { timelineItemSummariesAreStale: newStale })
  }
}

async function fetchTimelineItemsAndPossiblyFallBack () {
  console.log('fetchTimelineItemsAndPossiblyFallBack')
  mark('fetchTimelineItemsAndPossiblyFallBack')
  const {
    currentTimeline,
    currentInstance,
    accessToken,
    online
  } = store.get()

  if (currentTimeline === 'favorites' || currentTimeline === 'bookmarks') {
    // Always fetch favorites from the network, we currently don't have a good way of storing
    // these in IndexedDB because of "internal ID" system Mastodon uses to paginate these
    await fetchPagedItems(currentInstance, accessToken, currentTimeline)
  } else {
    const { items, stale } = await fetchTimelineItems(currentInstance, accessToken, currentTimeline, online)
    await addTimelineItems(currentInstance, currentTimeline, items, stale)
  }
  stop('fetchTimelineItemsAndPossiblyFallBack')
}

export async function setupTimeline () {
  console.log('setupTimeline')
  mark('setupTimeline')
  // If we don't have any item summaries, or if the current item summaries are stale
  // (i.e. via offline mode), then we need to re-fetch
  // Also do this if it's a thread, because threads change pretty frequently and
  // we don't have a good way to update them.
  const {
    timelineItemSummaries,
    timelineItemSummariesAreStale,
    currentTimeline
  } = store.get()
  console.log({ timelineItemSummaries, timelineItemSummariesAreStale, currentTimeline })
  if (!timelineItemSummaries ||
    timelineItemSummariesAreStale ||
    currentTimeline.startsWith('status/')) {
    await fetchTimelineItemsAndPossiblyFallBack()
  }
  stop('setupTimeline')
}

export async function fetchMoreItemsAtBottomOfTimeline (instanceName, timelineName) {
  console.log('setting runningUpdate: true')
  store.setForTimeline(instanceName, timelineName, { runningUpdate: true })
  await fetchTimelineItemsAndPossiblyFallBack()
  console.log('setting runningUpdate: false')
  store.setForTimeline(instanceName, timelineName, { runningUpdate: false })
}

export async function showMoreItemsForTimeline (instanceName, timelineName) {
  mark('showMoreItemsForTimeline')
  let itemSummariesToAdd = store.getForTimeline(instanceName, timelineName, 'timelineItemSummariesToAdd') || []
  itemSummariesToAdd = itemSummariesToAdd.sort(compareTimelineItemSummaries).reverse()
  addTimelineItemSummaries(instanceName, timelineName, itemSummariesToAdd, false)
  store.setForTimeline(instanceName, timelineName, {
    timelineItemSummariesToAdd: [],
    shouldShowHeader: false,
    showHeader: false
  })
  stop('showMoreItemsForTimeline')
}

export function showMoreItemsForCurrentTimeline () {
  const { currentInstance, currentTimeline } = store.get()
  return showMoreItemsForTimeline(
    currentInstance,
    currentTimeline
  )
}

export async function showMoreItemsForThread (instanceName, timelineName) {
  mark('showMoreItemsForThread')
  const itemSummariesToAdd = store.getForTimeline(instanceName, timelineName, 'timelineItemSummariesToAdd')
  const timelineItemSummaries = store.getForTimeline(instanceName, timelineName, 'timelineItemSummaries')
  const timelineItemIds = new Set(timelineItemSummaries.map(_ => _.id))
  // TODO: update database and do the thread merge correctly
  for (const itemSummaryToAdd of itemSummariesToAdd) {
    if (!timelineItemIds.has(itemSummaryToAdd.id)) {
      timelineItemSummaries.push(itemSummaryToAdd)
    }
  }
  const statusId = timelineName.split('/').slice(-1)[0]
  const sortedTimelineItemSummaries = sortItemSummariesForThread(timelineItemSummaries, statusId)
  store.setForTimeline(instanceName, timelineName, {
    timelineItemSummariesToAdd: [],
    timelineItemSummaries: sortedTimelineItemSummaries
  })
  stop('showMoreItemsForThread')
}
