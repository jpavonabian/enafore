import atprotoAgent, { setPdsUrl as setAgentPdsUrl, getPdsUrl as getAgentPdsUrl } from '../_api_atproto/agent.js'
import { login as atprotoLogin, logout as atprotoLogout, resumeAppSession as atprotoResumeAppSession, getActiveSessionData } from '../_api_atproto/auth.js'
import { setAtprotoAccount, getAtprotoAccount } from '../_database/atprotoAccounts.js'
import { BskyAgent } from '@atproto/api' // For fetching profile after login

export function atprotoMixins (Store) {
  Store.prototype.atprotoLogin = async function (identifier, password, pdsUrl) {
    console.log(`[Store Mixin] atprotoLogin called for identifier: ${identifier}, PDS: ${pdsUrl}`)
    this.set({ isLoading: true, error: null })
    let sessionData
    try {
      // Ensure agent's PDS URL is set before login
      const effectivePdsUrl = pdsUrl || this.get().atprotoPdsUrls[identifier] || (typeof localStorage !== 'undefined' && localStorage.getItem('atproto_pds_url')) ||'https://bsky.social'
      if (getAgentPdsUrl() !== effectivePdsUrl) {
        console.log(`[Store Mixin] Setting agent PDS URL to: ${effectivePdsUrl}`)
        setAgentPdsUrl(effectivePdsUrl)
      }

      sessionData = await atprotoLoginApi(identifier, password, getAgentPdsUrl())
      console.log(`[Store Mixin] atprotoLogin API success for DID: ${sessionData.did}`)

      // After successful login, fetch and store the user's profile
      try {
        // Use the main agent which now has the session
        const profile = await atprotoAgent.getProfile({ actor: sessionData.did })
        if (profile && profile.data) {
          await setAtprotoAccount(new URL(getAgentPdsUrl()).hostname, profile.data)
          console.log(`[Store Mixin] User profile for ${sessionData.did} stored in DB.`)
        }
      } catch (profileError) {
        console.error(`[Store Mixin] Failed to fetch or store profile for ${sessionData.did} after login:`, profileError)
        // Continue without profile, or handle error more gracefully
      }

      const newAtprotoSessions = { ...this.get().atprotoSessions }
      newAtprotoSessions[sessionData.did] = sessionData

      const newAtprotoPdsUrls = { ...this.get().atprotoPdsUrls }
      newAtprotoPdsUrls[sessionData.did] = getAgentPdsUrl()

      this.set({
        atprotoSessions: newAtprotoSessions,
        currentAtprotoSessionDid: sessionData.did,
        atprotoPdsUrls: newAtprotoPdsUrls,
        isAtprotoSessionActive: true,
        isLoading: false,
        error: null,
        currentAccountProtocol: 'atproto',
      })
      console.log(`[Store Mixin] Store updated after successful atproto login. Current DID: ${sessionData.did}`)
      return sessionData
    } catch (err) {
      console.error('[Store Mixin] atprotoLogin error:', err.message, err)
      // If login fails, sessionData might be undefined.
      // If it was a PDS connection issue, sessionData.did might not exist.
      const failedLoginIdentifier = sessionData?.did || identifier;
      const pdsHostForFailedLogin = new URL(getAgentPdsUrl() || 'https://bsky.social').hostname;
      const existingPdsForFailedLogin = this.get().atprotoPdsUrls[failedLoginIdentifier];

      if (!existingPdsForFailedLogin && pdsHostForFailedLogin) {
        // Store the PDS URL even if login failed, so user doesn't have to re-enter it
        // Useful if only password was wrong.
        const newAtprotoPdsUrls = { ...this.get().atprotoPdsUrls };
        newAtprotoPdsUrls[failedLoginIdentifier] = getAgentPdsUrl(); // Store PDS for the identifier used
        this.set({ atprotoPdsUrls: newAtprotoPdsUrls });
        console.log(`[Store Mixin] Saved PDS URL ${getAgentPdsUrl()} for identifier ${failedLoginIdentifier} despite login failure.`);
      }
      this.set({ isLoading: false, error: err.message, isAtprotoSessionActive: false })
      throw err
    }
  }

  Store.prototype.atprotoLogout = async function () {
    const currentDid = this.get().currentAtprotoSessionDid
    console.log(`[Store Mixin] atprotoLogout called. Current DID: ${currentDid}`)
    this.set({ isLoading: true })
    try {
      await atprotoLogout() // Clears session in agent & localStorage
      console.log(`[Store Mixin] atprotoLogout API call finished.`)

      const newAtprotoSessions = { ...this.get().atprotoSessions }
      if (currentDid) {
        delete newAtprotoSessions[currentDid]
        console.log(`[Store Mixin] Removed session for ${currentDid} from store.`)
      }

      this.set({
        atprotoSessions: newAtprotoSessions,
        currentAtprotoSessionDid: null,
        isAtprotoSessionActive: false,
        isLoading: false,
        error: null,
        currentAccountProtocol: null,
      })
      console.log('[Store Mixin] Store updated after successful atproto logout.')
    } catch (err) {
      this.set({ isLoading: false, error: err.message })
      this.set({ currentAtprotoSessionDid: null, isAtprotoSessionActive: false }) // Ensure local state is cleared
      console.error('[Store Mixin] atprotoLogout error:', err.message, err)
    }
  }

  Store.prototype.atprotoResumeSession = async function () {
    console.log('[Store Mixin] atprotoResumeSession called.')
    this.set({ isLoading: true })
    try {
      const session = await atprotoResumeAppSession()
      if (session && session.did) {
        console.log(`[Store Mixin] Session resumed via API for DID: ${session.did}`)

        // Ensure PDS URL is correctly set in the agent from persisted store value if available
        const pdsHostname = new URL(getAgentPdsUrl()).hostname // agent's current PDS
        const storedPdsUrlForUser = this.get().atprotoPdsUrls[session.did]
        if (storedPdsUrlForUser && getAgentPdsUrl() !== storedPdsUrlForUser) {
            console.log(`[Store Mixin] Resumed session for ${session.did}, PDS mismatch. Agent: ${getAgentPdsUrl()}, Store: ${storedPdsUrlForUser}. Setting agent PDS to stored value.`)
            setAgentPdsUrl(storedPdsUrlForUser)
        }

        // Attempt to fetch profile from DB, then from network if not found or stale
        let userProfile = await getAtprotoAccount(pdsHostname, session.did)
        if (!userProfile) {
          console.log(`[Store Mixin] Profile for ${session.did} not in DB, fetching from network...`)
          try {
            const profileFromNet = await atprotoAgent.getProfile({ actor: session.did })
            if (profileFromNet && profileFromNet.data) {
              await setAtprotoAccount(pdsHostname, profileFromNet.data)
              userProfile = profileFromNet.data
              console.log(`[Store Mixin] Fetched and stored profile for ${session.did} from network.`)
            }
          } catch (profileError) {
            console.error(`[Store Mixin] Failed to fetch profile for ${session.did} during session resume:`, profileError)
          }
        } else {
          console.log(`[Store Mixin] Profile for ${session.did} found in DB.`)
        }
        // session object from resumeAppSessionApi already contains { did, handle, email, accessJwt, refreshJwt }
        // userProfile contains { did, handle, displayName, description, avatar, etc. }
        // We store the full session object from auth API in atprotoSessions.
        // The DB stores the public profile.

        const currentSessions = this.get().atprotoSessions
        const currentPdsUrls = this.get().atprotoPdsUrls

        let changes = {}
        // Ensure the session object from API is in the store
        if (!currentSessions[session.did] || JSON.stringify(currentSessions[session.did]) !== JSON.stringify(session)) {
            changes.atprotoSessions = {...currentSessions, [session.did]: session }
        }
        // Ensure PDS URL is in the store
        const agentPds = getAgentPdsUrl()
        if (agentPds && (!currentPdsUrls[session.did] || currentPdsUrls[session.did] !== agentPds)) {
            changes.atprotoPdsUrls = {...currentPdsUrls, [session.did]: agentPds}
        }

        this.set({
          ...changes,
          currentAtprotoSessionDid: session.did,
          isAtprotoSessionActive: true,
          isLoading: false,
          error: null,
          currentAccountProtocol: 'atproto', // Set current protocol
        })
        console.log(`[Store Mixin] Store updated after session resume. Current DID: ${session.did}`)
        return session // This is the session object from auth, not the profile
      } else {
        console.log('[Store Mixin] No session to resume from API.')
        this.set({
          currentAtprotoSessionDid: null,
          isAtprotoSessionActive: false,
          isLoading: false,
        })
        return null
      }
    } catch (err) {
      this.set({ isLoading: false, error: err.message, currentAtprotoSessionDid: null, isAtprotoSessionActive: false })
      console.error('[Store Mixin] atprotoResumeSession error:', err.message, err)
      return null
    }
  }

  Store.prototype.getAtprotoSession = function (did) {
    const sessions = this.get().atprotoSessions
    return did ? sessions[did] : sessions[this.get().currentAtprotoSessionDid]
  }

  Store.prototype.getCurrentAtprotoUser = function () {
    const did = this.get().currentAtprotoSessionDid
    if (!did) return null
    const session = this.get().atprotoSessions[did]
    if (!session) return null
    // Return a structure similar to Enafore's existing user/account objects for consistency
    return {
      id: session.did, // Or a more Enafore-like ID if necessary
      did: session.did,
      username: session.handle,
      handle: session.handle,
      displayName: session.displayName || session.handle, // Fallback display name
      avatar: session.avatar || null, // User's avatar URL
      email: session.email, // If available
      pds: getAgentPdsUrl(), // PDS URL
      protocol: 'atproto',
      // Add other fields Enafore UI might expect, with defaults
      // acct: `${session.handle}@${new URL(getAgentPdsUrl()).hostname}`, // Example full acct
    }
  }
}
