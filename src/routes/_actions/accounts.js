import { getAccount as getApAccount } from '../_api/user.js'
import { getRelationship as getApRelationship } from '../_api/relationships.js'
import atprotoAgent from '../_api_atproto/agent.js'
import { database } from '../_database/database.js'
import { store } from '../_store/store.js'
import { transformProfileViewToEnaforeAccount } from '../_api_atproto/posts.js'

// Helper to determine if an ID is a DID (very basic check)
function isDid (id) {
  return typeof id === 'string' && id.startsWith('did:')
}

async function _updateAccount (accountId, instanceName, accessToken) {
  const { currentAccountProtocol } = store.get() // Or infer from accountId or instanceName

  if (currentAccountProtocol === 'atproto' || isDid(accountId)) {
    const pdsHostname = instanceName // For ATProto, instanceName is the PDS hostname
    console.log(`[Actions/Accounts] ATProto: Updating account for DID ${accountId} on PDS ${pdsHostname}`)
    try {
      // 1. Try local DB first
      let profile = await database.getAtprotoAccount(pdsHostname, accountId)
      if (profile) {
        store.set({ currentAccountProfile: transformProfileViewToEnaforeAccount(profile, pdsHostname) })
      }

      // 2. Fetch from network
      const networkProfileResponse = await atprotoAgent.getProfile({ actor: accountId })
      if (networkProfileResponse?.data) {
        const transformedProfile = transformProfileViewToEnaforeAccount(networkProfileResponse.data, pdsHostname)
        await database.setAtprotoAccount(pdsHostname, networkProfileResponse.data) // Save raw ProfileViewDetail to DB
        store.set({ currentAccountProfile: transformedProfile })
        console.log(`[Actions/Accounts] ATProto: Fetched and set profile for ${accountId}`)
      } else {
        console.warn(`[Actions/Accounts] ATProto: No profile data from network for ${accountId}`)
        if (!profile) store.set({ currentAccountProfile: null }) // Clear if not even in DB
      }
    } catch (e) {
      console.error(`[Actions/Accounts] ATProto: Error updating account ${accountId}:`, e)
      store.set({ currentAccountProfile: null }) // Clear on error
    }
  } else { // ActivityPub
    console.log(`[Actions/Accounts] AP: Updating account for ID ${accountId} on instance ${instanceName}`)
    const localPromise = database.getAccount(instanceName, accountId)
    const remotePromise = getApAccount(instanceName, accessToken, accountId).then(account => {
      /* no await */ database.setAccount(instanceName, account)
      return account
    })

    try {
      store.set({ currentAccountProfile: (await localPromise) })
    } catch (e) {
      console.error(e)
    }
    try {
      store.set({ currentAccountProfile: (await remotePromise) })
    } catch (e) {
      console.error(e)
    }
  }
}

async function _updateRelationship (accountId, instanceName, accessToken) {
  const { currentAccountProtocol } = store.get()

  if (currentAccountProtocol === 'atproto' || isDid(accountId)) {
    const pdsHostname = instanceName
    console.log(`[Actions/Accounts] ATProto: Updating relationship for DID ${accountId} on PDS ${pdsHostname}`)
    // For ATProto, relationship data is often part of the ProfileView's 'viewer' state.
    // We assume _updateAccount has already fetched the latest profile which includes viewer state.
    // We just need to ensure currentAccountProfile (which should have viewer state) is used to derive relationship.
    const { currentAccountProfile } = store.get() // This should be the Enafore-transformed profile
    if (currentAccountProfile && currentAccountProfile.protocol === 'atproto' && currentAccountProfile.id === accountId) {
      // Transform viewer state from Enafore's ATProto profile structure to AP-like relationship object if needed,
      // or ensure AccountProfile component can use viewer state directly.
      // Enafore's AP relationship object: { id, following, followed_by, blocking, muting, requested }
      // ATProto viewer state: { muted, blocking (uri), followedBy (uri), following (uri) }
      const relationship = {
        id: accountId,
        following: !!currentAccountProfile.viewer?.following,
        followed_by: !!currentAccountProfile.viewer?.followedBy,
        blocking: !!currentAccountProfile.viewer?.blocking,
        muting: !!currentAccountProfile.viewer?.muted,
        requested: false, // ATProto doesn't have a direct "requested" state like AP follow requests visible this way
        // Pinafore specific viewer flags (already in currentAccountProfile.viewer if transformed by getCurrentAtprotoUser model)
        isFollowing: !!currentAccountProfile.viewer?.isFollowing,
        isFollowedBy: !!currentAccountProfile.viewer?.isFollowedBy,
        isBlockingThem: !!currentAccountProfile.viewer?.isBlockingThem,
        isBlockedByThem: !!currentAccountProfile.viewer?.isBlockedByThem,
        isMuting: !!currentAccountProfile.viewer?.isMuting,
      }
      store.set({ currentAccountRelationship: relationship })
      console.log(`[Actions/Accounts] ATProto: Set relationship from profile viewer state for ${accountId}`)
    } else {
      console.warn(`[Actions/Accounts] ATProto: Profile for ${accountId} not available or not ATProto to derive relationship.`)
      store.set({ currentAccountRelationship: null })
    }
  } else { // ActivityPub
    console.log(`[Actions/Accounts] AP: Updating relationship for ID ${accountId} on instance ${instanceName}`)
    const localPromise = database.getRelationship(instanceName, accountId)
    const remotePromise = getApRelationship(instanceName, accessToken, accountId).then(relationship => {
      if (relationship) {
        /* no await */ database.setRelationship(instanceName, relationship)
        return relationship
      }
    })
    try {
      store.set({ currentAccountRelationship: (await localPromise) })
    } catch (e) {
      console.error(e)
    }
  try {
    store.set({ currentAccountRelationship: await remotePromise })
  } catch (e) {
    console.error(e)
  }
}

export async function updateLocalRelationship (instanceName, accountId, relationship) {
  await database.setRelationship(instanceName, relationship)
  try {
    store.set({ currentAccountRelationship: relationship })
  } catch (e) {
    console.error(e)
  }
}

export async function clearProfileAndRelationship () {
  store.set({
    currentAccountProfile: null,
    currentAccountRelationship: null
  })
}

export async function updateProfileAndRelationship (accountId) {
  const { currentInstance, accessToken } = store.get()

  await clearProfileAndRelationship()
  await Promise.all([
    _updateAccount(accountId, currentInstance, accessToken),
    _updateRelationship(accountId, currentInstance, accessToken)
  ])
}

export async function updateRelationship (accountId) {
  const { currentInstance, accessToken } = store.get()

  await clearProfileAndRelationship()
  await _updateRelationship(accountId, currentInstance, accessToken)
}
