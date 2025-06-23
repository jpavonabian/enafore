import { observers } from './observers/observers.js'
import { computations } from './computations/computations.js'
import { mixins } from './mixins/mixins.js'
import { LocalStorageStore } from './LocalStorageStore.js'
import { observe } from 'svelte-extras'
import { isKaiOS } from '../_utils/userAgent/isKaiOS.js'
import * as atprotoAPI from '../_api_atproto/auth.js' // ATProto auth functions
import atprotoAgent from '../_api_atproto/agent.js' // ATProto agent

const persistedState = {
  // ATProto specific persisted state
  atprotoSessions: {}, // Store by DID: { did, handle, email, accessJwt, refreshJwt }
  currentAtprotoSessionDid: null, // DID of the currently active ATProto session
  atprotoPdsUrls: {}, // Store by DID: PDS URL associated with that account

  alwaysShowFocusRing: false,
  autoplayGifs: !(
    !ENAFORE_IS_BROWSER || matchMedia('(prefers-reduced-motion: reduce)').matches
  ),
  composeData: {},
  currentInstance: null,
  currentRegisteredInstanceName: undefined,
  currentRegisteredInstance: undefined,
  // we disable scrollbars by default on iOS
  disableCustomScrollbars:
    ENAFORE_IS_BROWSER && /iP(?:hone|ad|od)/.test(navigator.userAgent),
  bottomNav: false,
  centerNav: false,
  disableFollowRequestCount: false,
  hideLongPosts: true,
  disableFavCounts: false,
  disableFollowerCounts: false,
  disableHotkeys: false,
  disableInfiniteScroll: false,
  disableLongAriaLabels: false,
  disableNotificationBadge: false,
  disableNotificationSound: (() => {
    try {
      return localStorage.getItem('store_disableNotificationBadge') === 'true'
    } catch (e) {
      return false
    }
  })(),
  disableReblogCounts: false,
  disableRelativeTimestamps: false,
  disableTapOnStatus: false,
  enableGrayscale: false,
  hideCards: false,
  leftRightChangesFocus: isKaiOS(),
  instanceNameInSearch: '',
  instanceThemes: {},
  instanceSettings: {},
  loggedInInstances: {},
  loggedInInstancesInOrder: [],
  markMediaAsSensitive: false,
  showAllSpoilers: false,
  neverMarkMediaAsSensitive: false,
  ignoreBlurhash: false,
  omitEmojiInDisplayNames: undefined,
  pinnedPages: {},
  pushSubscriptions: {},
  lastPings: {},
  reduceMotion:
    !ENAFORE_IS_BROWSER || matchMedia('(prefers-reduced-motion: reduce)').matches,
  underlineLinks: false,
  iconColors: '',
  lastContentTypes: {}
}

const nonPersistedState = {
  customEmoji: {},
  unexpiredInstanceFilters: {},
  followRequestCounts: {},
  instanceInfos: {},
  instanceLists: {},
  instanceFilters: {},
  online: !ENAFORE_IS_BROWSER || navigator.onLine,
  pinnedStatuses: {},
  polls: {},
  pushNotificationsSupport:
    ENAFORE_IS_BROWSER &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'getKey' in PushSubscription.prototype,
  queryInSearch: '',
  repliesShown: {},
  sensitivesShown: {},
  spoilersShown: {},
  statusModifications: {},
  verifyCredentials: {},
  statusTranslationContents: {},
  statusTranslations: {},
  instanceDataReady: {},

  // ATProto specific non-persisted state
  currentAtprotoAgentState: null, // Could store agent readiness or errors
  isAtprotoSessionActive: false, // Derived, but useful to have explicitly
  currentAccountProtocol: null, // 'activitypub' or 'atproto'
}

const state = Object.assign({}, persistedState, nonPersistedState)
export const keysToStoreInLocalStorage = new Set(Object.keys(persistedState))

export class PinaforeStore extends LocalStorageStore {
  constructor (state) {
    super(state, keysToStoreInLocalStorage)
  }
}

PinaforeStore.prototype.observe = observe

export const store = new PinaforeStore(state)

mixins(PinaforeStore)
computations(store)
observers(store)

if (ENAFORE_IS_BROWSER) {
  window.__store = store // for debugging
}
