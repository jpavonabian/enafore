import {
  ACCOUNTS_STORE, DB_VERSION_SNOWFLAKE_IDS, DB_VERSION_INITIAL,
  DB_VERSION_SEARCH_ACCOUNTS, META_STORE,
  NOTIFICATION_TIMELINES_STORE,
  NOTIFICATIONS_STORE, PINNED_STATUSES_STORE,
  REBLOG_ID, RELATIONSHIPS_STORE,
  STATUS_ID,
  STATUS_TIMELINES_STORE,
  STATUSES_STORE, THREADS_STORE,
  TIMESTAMP, USERNAME_LOWERCASE,
  // ATProto constants
  ATPROTO_ACCOUNTS_STORE,
  ATPROTO_POSTS_STORE,
  ATPROTO_TIMELINES_STORE,
  ATPROTO_FEED_CURSORS_STORE,
  ATPROTO_HANDLE_INDEX,
  ATPROTO_AUTHOR_DID_CREATED_AT_INDEX,
  ATPROTO_CREATED_AT_INDEX,
  ATPROTO_CID_INDEX,
  ATPROTO_REPLY_ROOT_URI_INDEX,
  ATPROTO_REPLY_PARENT_URI_INDEX,
  ATPROTO_FEED_URI_INDEX,
  DB_VERSION_ATPROTO_STORES,
  // Notification stores for ATProto
  ATPROTO_NOTIFICATIONS_STORE,
  ATPROTO_NOTIFICATION_TIMELINES_STORE,
  DB_VERSION_ATPROTO_NOTIFICATION_STORES,
  // Bookmark store for ATProto
  ATPROTO_BOOKMARKS_STORE,
  ATPROTO_BOOKMARKED_AT_INDEX,
  DB_VERSION_ATPROTO_BOOKMARKS_STORE
} from './constants.js'
import { toReversePaddedBigInt } from '../_utils/statusIdSorting.js'

function initialMigration (db, tx, done) {
  function createObjectStore (name, init, indexes) {
    const store = init
      ? db.createObjectStore(name, init)
      : db.createObjectStore(name)
    if (indexes) {
      Object.keys(indexes).forEach(indexKey => {
        store.createIndex(indexKey, indexes[indexKey])
      })
    }
  }

  createObjectStore(STATUSES_STORE, { keyPath: 'id' }, {
    [TIMESTAMP]: TIMESTAMP,
    [REBLOG_ID]: REBLOG_ID
  })
  createObjectStore(STATUS_TIMELINES_STORE, null, {
    statusId: ''
  })
  createObjectStore(NOTIFICATIONS_STORE, { keyPath: 'id' }, {
    [TIMESTAMP]: TIMESTAMP,
    [STATUS_ID]: STATUS_ID
  })
  createObjectStore(NOTIFICATION_TIMELINES_STORE, null, {
    notificationId: ''
  })
  createObjectStore(ACCOUNTS_STORE, { keyPath: 'id' }, {
    [TIMESTAMP]: TIMESTAMP
  })
  createObjectStore(RELATIONSHIPS_STORE, { keyPath: 'id' }, {
    [TIMESTAMP]: TIMESTAMP
  })
  createObjectStore(THREADS_STORE, null, {
    statusId: ''
  })
  createObjectStore(PINNED_STATUSES_STORE, null, {
    statusId: ''
  })
  createObjectStore(META_STORE)
  done()
}

function addSearchAccountsMigration (db, tx, done) {
  tx.objectStore(ACCOUNTS_STORE)
    .createIndex(USERNAME_LOWERCASE, USERNAME_LOWERCASE)
  done()
}

function snowflakeIdsMigration (db, tx, done) {
  const stores = [STATUS_TIMELINES_STORE, NOTIFICATION_TIMELINES_STORE]
  let storeDoneCount = 0

  // Here we have to convert the old "reversePaddedBigInt" format to the new
  // one which is compatible with Pleroma-style snowflake IDs.
  stores.forEach(store => {
    const objectStore = tx.objectStore(store)
    const cursor = objectStore.openCursor()
    cursor.onsuccess = e => {
      const { result } = e.target
      if (result) {
        const { key, value } = result
        // key is timeline name plus delimiter plus reverse padded big int
        const newKey = key.split('\u0000')[0] + '\u0000' + toReversePaddedBigInt(value)

        objectStore.delete(key).onsuccess = () => {
          objectStore.add(value, newKey).onsuccess = () => {
            result.continue()
          }
        }
      } else {
        if (++storeDoneCount === stores.length) {
          done()
        }
      }
    }
  })
}

function atprotoStoresMigration (db, tx, done) {
  // Helper to create object stores, copied from initialMigration
  function createObjectStore (name, init, indexes) {
    const store = init
      ? db.createObjectStore(name, init)
      : db.createObjectStore(name)
    if (indexes) {
      Object.keys(indexes).forEach(indexKey => {
        // Ensure index options are correct if any are needed (e.g., unique: false)
        store.createIndex(indexKey, indexes[indexKey], { unique: false })
      })
    }
  }

  // ATPROTO_ACCOUNTS_STORE
  createObjectStore(ATPROTO_ACCOUNTS_STORE, { keyPath: 'did' }, {
    [ATPROTO_HANDLE_INDEX]: 'handle', // Assuming 'handle' is a direct property
    // indexedAt: 'indexedAt' // If we add an indexedAt field for caching
  })

  // ATPROTO_POSTS_STORE
  createObjectStore(ATPROTO_POSTS_STORE, { keyPath: 'uri' }, {
    [ATPROTO_AUTHOR_DID_CREATED_AT_INDEX]: ['author.did', 'createdAt'], // Compound index
    [ATPROTO_CREATED_AT_INDEX]: 'createdAt',
    [ATPROTO_CID_INDEX]: 'cid',
    [ATPROTO_REPLY_ROOT_URI_INDEX]: 'replyRootUri',     // Assuming these fields exist on the stored post object
    [ATPROTO_REPLY_PARENT_URI_INDEX]: 'replyParentUri', // Assuming these fields exist
  })

  // ATPROTO_TIMELINES_STORE
  // Key will be composite: feedUri + '\u0000' + sortableKey (e.g., timestamp + postUri)
  // Value will be postUri
  // This store helps retrieve an ordered list of post URIs for a given feed.
  createObjectStore(ATPROTO_TIMELINES_STORE, null, { // autoIncrementing primary key might be simpler if key structure is complex
     // No specific indexes defined here yet, queries will primarily be by key (feedUri prefix)
     // If we store objects like { feedUri, postUri, sortKey }, then we can index feedUri.
     // For now, keeping it simple as a key-value store where key itself contains feedUri.
  })
  // Example of an index if storing objects:
  // createObjectStore(ATPROTO_TIMELINES_STORE, {keyPath: 'id', autoIncrement: true}, {
  // [ATPROTO_FEED_URI_INDEX]: 'feedUri'
  // })


  // ATPROTO_FEED_CURSORS_STORE
  createObjectStore(ATPROTO_FEED_CURSORS_STORE, { keyPath: 'feedUri' })

  done()
}

export const migrations = [
  {
    version: DB_VERSION_INITIAL,
    migration: initialMigration
  },
  {
    version: DB_VERSION_SEARCH_ACCOUNTS,
    migration: addSearchAccountsMigration
  },
  {
    version: DB_VERSION_SNOWFLAKE_IDS,
    migration: snowflakeIdsMigration
  },
  {
    version: DB_VERSION_ATPROTO_STORES,
    migration: atprotoStoresMigration
  },
  {
    version: DB_VERSION_ATPROTO_NOTIFICATION_STORES,
    migration: atprotoNotificationStoresMigration
  },
  {
    version: DB_VERSION_ATPROTO_BOOKMARKS_STORE,
    migration: atprotoBookmarksStoreMigration
  }
]

// Helper function (can be kept local or moved to a common place if used by other migrations too)
function createObjectStoreHelper (db, name, init, indexes) {
  const store = init
    ? db.createObjectStore(name, init)
    : db.createObjectStore(name)
  if (indexes) {
    Object.keys(indexes).forEach(indexKey => {
      store.createIndex(indexKey, indexes[indexKey], { unique: false })
    })
  }
}


function atprotoNotificationStoresMigration (db, tx, done) {
  // ATPROTO_NOTIFICATIONS_STORE
  // Stores transformed notification objects.
  // Keyed by notification URI.
  createObjectStoreHelper(db, ATPROTO_NOTIFICATIONS_STORE, { keyPath: 'id' }, { // 'id' will be the notification URI
    [ATPROTO_CREATED_AT_INDEX]: 'createdAt', // 'createdAt' is 'indexedAt' from ATProto notification
    // Add other indexes as needed, e.g., by notification type or if reasonSubject is stored and indexed.
    // 'type': 'type' // if 'type' (reason) is indexed
  })

  // ATPROTO_NOTIFICATION_TIMELINES_STORE
  // Similar to ATPROTO_TIMELINES_STORE, this will store ordered notification URIs for a "notifications" feed.
  // Key: "notifications_feed" + '\u0000' + sortableKey (e.g., timestamp + notificationUri)
  // Value: notificationUri
  // The "feedUri" concept here is just a fixed string like "notifications_all" or "notifications_unread"
  createObjectStoreHelper(db, ATPROTO_NOTIFICATION_TIMELINES_STORE, null, {
    // No specific indexes defined here yet for the timeline itself.
    // Queries will be by key prefix (e.g., "notifications_all").
  })

  done()
}

function atprotoBookmarksStoreMigration(db, tx, done) {
  // ATPROTO_BOOKMARKS_STORE
  // KeyPath: 'postUri'
  // Value: { postUri: string, bookmarkedAt: string (ISO) }
  // Index: 'bookmarkedAt'
  createObjectStoreHelper(db, ATPROTO_BOOKMARKS_STORE,
    { keyPath: 'postUri' },
    { [ATPROTO_BOOKMARKED_AT_INDEX]: 'bookmarkedAt' }
  );
  done();
}
