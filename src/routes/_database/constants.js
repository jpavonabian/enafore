export const STATUSES_STORE = 'statuses-v4'
export const STATUS_TIMELINES_STORE = 'status_timelines-v4'
export const META_STORE = 'meta-v4'
export const ACCOUNTS_STORE = 'accounts-v4'
export const RELATIONSHIPS_STORE = 'relationships-v4'
export const NOTIFICATIONS_STORE = 'notifications-v4'
export const NOTIFICATION_TIMELINES_STORE = 'notification_timelines-v4'
export const PINNED_STATUSES_STORE = 'pinned_statuses-v4'
export const THREADS_STORE = 'threads-v4'

export const TIMESTAMP = '__pinafore_ts'
export const ACCOUNT_ID = '__pinafore_acct_id'
export const STATUS_ID = '__pinafore_status_id'
export const REBLOG_ID = '__pinafore_reblog_id'
export const USERNAME_LOWERCASE = '__pinafore_acct_lc'

export const DB_VERSION_INITIAL = 9
export const DB_VERSION_SEARCH_ACCOUNTS = 10
export const DB_VERSION_SNOWFLAKE_IDS = 12 // 11 skipped because of mistake deployed to dev.pinafore.social
export const DB_VERSION_ATPROTO_STORES = 13 // New version for adding ATProto stores

// Using an object for these so that unit tests can change them
export const DB_VERSION_CURRENT = { version: 13 } // Update to new current version
export const CURRENT_TIME = { now: () => Date.now() }

// ATProto Stores
export const ATPROTO_ACCOUNTS_STORE = 'atproto_accounts-v1'
export const ATPROTO_POSTS_STORE = 'atproto_posts-v1'
export const ATPROTO_TIMELINES_STORE = 'atproto_timelines-v1'
export const ATPROTO_FEED_CURSORS_STORE = 'atproto_feed_cursors-v1'

// ATProto Indexes (example, actual names might be properties of records)
export const ATPROTO_HANDLE_INDEX = 'handle'
export const ATPROTO_AUTHOR_DID_CREATED_AT_INDEX = 'authorDid_createdAt'
export const ATPROTO_CREATED_AT_INDEX = 'createdAt'
export const ATPROTO_CID_INDEX = 'cid'
export const ATPROTO_REPLY_ROOT_URI_INDEX = 'replyRootUri'
export const ATPROTO_REPLY_PARENT_URI_INDEX = 'replyParentUri'
export const ATPROTO_FEED_URI_INDEX = 'feedUri' // For ATPROTO_TIMELINES_STORE
