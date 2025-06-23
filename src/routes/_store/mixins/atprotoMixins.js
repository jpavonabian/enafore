import atprotoAgent, { setPdsUrl as setAgentPdsUrl, getPdsUrl as getAgentPdsUrl } from '../_api_atproto/agent.js'
import { login as atprotoLogin, logout as atprotoLogout, resumeAppSession as atprotoResumeAppSession, getActiveSessionData } from '../_api_atproto/auth.js'

export function atprotoMixins (Store) {
  Store.prototype.atprotoLogin = async function (identifier, password, pdsUrl) {
    console.log(`[Store Mixin] atprotoLogin called for identifier: ${identifier}, PDS: ${pdsUrl}`)
    this.set({ isLoading: true, error: null })
    try {
      // Ensure agent's PDS URL is set before login
      if (pdsUrl) {
        console.log(`[Store Mixin] Setting agent PDS URL to: ${pdsUrl}`)
        setAgentPdsUrl(pdsUrl) // This also updates localStorage via agent.js
      } else {
        const existingPds = this.get().atprotoPdsUrls[identifier] ||
                           (typeof localStorage !== 'undefined' && localStorage.getItem('atproto_pds_url')) ||
                           'https://bsky.social'
        console.log(`[Store Mixin] Using existing or default PDS URL: ${existingPds} for ${identifier}`)
        setAgentPdsUrl(existingPds)
      }

      const sessionData = await atprotoLogin(identifier, password, getAgentPdsUrl())
      console.log(`[Store Mixin] atprotoLogin API success for DID: ${sessionData.did}`)

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
        const currentSessions = this.get().atprotoSessions
        const currentPdsUrls = this.get().atprotoPdsUrls

        let changes = {}
        if (!currentSessions[session.did]) {
            changes.atprotoSessions = {...currentSessions, [session.did]: session }
        }
        const agentPds = getAgentPdsUrl() // Get PDS URL from agent, which should be persisted/set
        if (agentPds && !currentPdsUrls[session.did]) { // Only set if not already there or if different?
            changes.atprotoPdsUrls = {...currentPdsUrls, [session.did]: agentPds}
        }

        this.set({
          ...changes,
          currentAtprotoSessionDid: session.did,
          isAtprotoSessionActive: true,
          isLoading: false,
          error: null,
        })
        console.log(`[Store Mixin] Store updated after session resume. Current DID: ${session.did}`)
        return session
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
