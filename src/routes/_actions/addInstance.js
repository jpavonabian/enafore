import { getAccessTokenFromAuthCode, registerApplication, generateAuthLink } from '../_api/oauth.js'
import * as atprotoAPI from '../_api_atproto/auth.js' // ATProto auth functions
import { getInstanceInfo } from '../_api/instance.js'
import { goto } from '../../../__sapper__/client.js'
import { DEFAULT_THEME, switchToTheme } from '../_utils/themeEngine.js'
import { store } from '../_store/store.js'
import { updateVerifyCredentialsForInstance } from './instances.js'
import { updateCustomEmojiForInstance } from './emoji.js'
import { database } from '../_database/database.js'

const GENERIC_ERROR = `
  Is this a valid instance? Is a browser extension
  blocking the request? Are you in private browsing mode?
  If you believe this is a problem with your instance, please send
  <a href="https://github.com/enafore/enafore/blob/main/docs/Admin-Guide.md"
    target="_blank" rel="noopener">this link</a> to the administrator of your instance.`

function createKnownError (message) {
  const err = new Error(message)
  err.knownError = true
  return err
}

function getRedirectUri () {
  return `${location.origin}/settings/instances/add`
}

async function redirectToOauth () {
  let { instanceNameInSearch, loggedInInstances } = store.get()
  instanceNameInSearch = instanceNameInSearch.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase()
  if (Object.keys(loggedInInstances).includes(instanceNameInSearch)) {
    throw createKnownError(`You've already logged in to ${instanceNameInSearch}`)
  }
  const redirectUri = getRedirectUri()
  const registrationPromise = registerApplication(instanceNameInSearch, redirectUri)
  try {
    const instanceInfo = await getInstanceInfo(instanceNameInSearch)
    await database.setInstanceInfo(instanceNameInSearch, instanceInfo) // cache for later
  } catch (err) {
    // We get a 401 in limited federation mode, so we can just skip setting the instance info in that case.
    // It will be fetched automatically later.
    if (err.status !== 401) {
      throw err // this is a good way to test for typos in the instance name or some other problem
    }
  }
  const instanceData = await registrationPromise
  store.set({
    currentRegisteredInstanceName: instanceNameInSearch,
    currentRegisteredInstance: instanceData
  })
  store.save()
  const oauthUrl = generateAuthLink(
    instanceNameInSearch,
    instanceData.client_id,
    redirectUri
  )
  // setTimeout to allow the browser to *actually* save the localStorage data (fixes Safari bug apparently)
  setTimeout(() => {
    document.location.href = oauthUrl
  }, 200)
}

export async function logInToInstance () {
  store.set({
    logInToInstanceLoading: true,
    logInToInstanceError: null
  })

  // Get instanceName and type from store. instanceNameInSearch might be handle or PDS URL for atproto.
  const { instanceNameInSearch, instanceTypeToAdd = 'activitypub', atprotoPassword, atprotoPdsUrl } = store.get()
  // atprotoPassword and atprotoPdsUrl would need to be new fields in the store, set by the UI form
  console.log(`[Add Instance] Initiating login. Type: ${instanceTypeToAdd}, Identifier: ${instanceNameInSearch}, PDS: ${atprotoPdsUrl || 'default'}`)

  try {
    if (instanceTypeToAdd === 'atproto') {
      console.log('[Add Instance] Starting ATProto login flow.')
      // instanceNameInSearch is the handle (e.g., username.bsky.social)
      // atprotoPdsUrl is the PDS server (e.g., https://bsky.social) - can be optional if default
      // atprotoPassword is the app password
      if (!atprotoPassword) {
        console.error('[Add Instance] ATProto password missing.')
        throw createKnownError('Password is required for ATProto login.')
      }
      // Use store's atprotoLogin action, which handles agent and store updates
      await store.atprotoLogin(instanceNameInSearch, atprotoPassword, atprotoPdsUrl)
      console.log('[Add Instance] ATProto login successful via store action.')
      // Success: update UI, clear form, navigate
      store.set({
        instanceNameInSearch: '',
        atprotoPassword: '', // Clear password from store state
        atprotoPdsUrl: '',
      })
      // currentInstance and currentAccountProtocol are set by the store mixin
      store.save()
      goto('/')
    } else { // Existing ActivityPub OAuth flow
      console.log('[Add Instance] Starting ActivityPub OAuth flow.')
      await redirectToOauth()
    }
  } catch (err) {
    console.error(`[Add Instance] Login failed for ${instanceNameInSearch} (Type: ${instanceTypeToAdd}):`, err)
    const error = `${(err.message || err.name).replace(/\.$/, '')}. ` +
      (err.knownError ? '' : (navigator.onLine ? GENERIC_ERROR : 'Are you offline?'))
    // Re-fetch instanceNameInSearch in case it was cleared by a failed store.atprotoLogin attempt
    const currentInstanceNameInSearch = store.get().instanceNameInSearch || instanceNameInSearch
    store.set({
      logInToInstanceError: error,
      logInToInstanceErrorForText: instanceNameInSearch
    })
  } finally {
    store.set({ logInToInstanceLoading: false })
  }
}

async function registerNewInstance (code) {
  const { currentRegisteredInstanceName, currentRegisteredInstance } = store.get()
  const redirectUri = getRedirectUri()
  const instanceData = await getAccessTokenFromAuthCode(
    currentRegisteredInstanceName,
    currentRegisteredInstance.client_id,
    currentRegisteredInstance.client_secret,
    code,
    redirectUri
  )
  const { loggedInInstances, loggedInInstancesInOrder, instanceThemes } = store.get()
  instanceThemes[currentRegisteredInstanceName] = DEFAULT_THEME
  loggedInInstances[currentRegisteredInstanceName] = instanceData
  if (!loggedInInstancesInOrder.includes(currentRegisteredInstanceName)) {
    loggedInInstancesInOrder.push(currentRegisteredInstanceName)
  }
  store.set({
    instanceNameInSearch: '',
    currentRegisteredInstanceName: null,
    currentRegisteredInstance: null,
    loggedInInstances,
    currentInstance: currentRegisteredInstanceName,
    loggedInInstancesInOrder,
    instanceThemes,
    currentAccountProtocol: 'activitypub', // Set protocol for ActivityPub
    // Clear ATProto active state
    currentAtprotoSessionDid: null,
    isAtprotoSessionActive: false,
    atprotoNotificationsCursor: null, // Also reset any ATP specific pagination/data
    atprotoNotifications: [],
    atprotoUnreadNotificationCount: 0
  })
  store.save()
  const { enableGrayscale } = store.get()
  switchToTheme(DEFAULT_THEME, enableGrayscale)
  // fire off these requests so they're cached
  /* no await */ updateVerifyCredentialsForInstance(currentRegisteredInstanceName)
  /* no await */ updateCustomEmojiForInstance(currentRegisteredInstanceName)
  goto('/')
}

export async function handleOauthCode (code) {
  try {
    store.set({ logInToInstanceLoading: true })
    await registerNewInstance(code)
  } catch (err) {
    store.set({ logInToInstanceError: `${err.message || err.name}. Failed to connect to instance.` })
  } finally {
    store.set({ logInToInstanceLoading: false })
  }
}
