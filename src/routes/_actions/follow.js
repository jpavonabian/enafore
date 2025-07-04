import { store } from '../_store/store.js'
import { followAccount as apFollowAccount, unfollowAccount as apUnfollowAccount } from '../_api/follow.js'
import atprotoAgent from '../_api_atproto/agent.js'
import { toast } from '../_components/toast/toast.js'
import { updateLocalRelationship, updateProfileAndRelationship } from './accounts.js' // Added updateProfileAndRelationship
import { formatIntl } from '../_utils/formatIntl.js'

// Helper to determine if an ID is a DID (very basic check) - might be duplicated, consider centralizing
function isDid (id) {
  return typeof id === 'string' && id.startsWith('did:')
}

export async function setAccountFollowed (accountId, follow, toastOnSuccess) {
  const { currentInstance, accessToken, currentAccountProtocol, currentAtprotoSessionDid } = store.get()
  // Determine target protocol: if current user is ATProto, assume target is ATProto if it's a DID.
  // Otherwise, rely on currentAccountProtocol for actions taken by the logged-in user on their own platform.
  // A more robust solution might involve fetching the target account's protocol if unknown.
  const targetIsLikelyAtproto = isDid(accountId) && (currentAccountProtocol === 'atproto' || !currentAccountProtocol);

  try {
    let relationship // This will be the AP-style relationship object for store update

    if (targetIsLikelyAtproto) {
      console.log(`[Actions/Follow] ATProto: ${follow ? 'Following' : 'Unfollowing'} ${accountId}`)
      if (!currentAtprotoSessionDid) {
        throw new Error('Not logged in to ATProto account.')
      }
      const pdsHostname = currentInstance; // Assuming currentInstance is PDS hostname for ATProto

      if (follow) {
        await atprotoAgent.follow(accountId) // accountId is the DID of the target
      } else {
        // To unfollow, we need the URI of the follow record.
        // This should be available in the target user's profile's viewer.following state.
        // Or, if this is the current user's profile, it's in their own session/profile.
        // For simplicity, we'll re-fetch the profile to get the latest state including the follow URI.
        // A more optimized version would get this from the already loaded currentAccountProfile.
        const profileToUnfollow = await atprotoAgent.getProfile({actor: accountId});
        const followUri = profileToUnfollow?.data?.viewer?.following;
        if (!followUri) {
            throw new Error(`Could not find follow record URI to unfollow ${accountId}. Are you sure you are following them?`);
        }
        await atprotoAgent.deleteFollow(followUri)
      }
      // After action, update profile & relationship in store to reflect new state
      // This will fetch the latest profile, which includes the updated viewer state.
      await updateProfileAndRelationship(accountId) // This action needs to be ATProto aware

    } else { // ActivityPub
      console.log(`[Actions/Follow] AP: ${follow ? 'Following' : 'Unfollowing'} ${accountId} on ${currentInstance}`)
      if (follow) {
        relationship = await apFollowAccount(currentInstance, accessToken, accountId)
      } else {
        relationship = await apUnfollowAccount(currentInstance, accessToken, accountId)
      }
      // updateLocalRelationship is AP specific for now, as it takes an AP relationship object.
      // For ATProto, updateProfileAndRelationship should handle updating the store.
      await updateLocalRelationship(currentInstance, accountId, relationship)
    }

    if (toastOnSuccess) {
      /* no await */ toast.say(follow ? 'intl.followedAccount' : 'intl.unfollowedAccount')
    }
  } catch (e) {
    console.error(e)
    /* no await */ toast.say(follow
      ? formatIntl('intl.unableToFollow', { error: (e.message || '') })
      : formatIntl('intl.unableToUnfollow', { error: (e.message || '') })
    )
  }
}
