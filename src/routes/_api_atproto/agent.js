import { BskyAgent } from '@atproto/api'

// Attempt to retrieve persisted session data
// This is a placeholder. In a real app, you'd get this from localStorage or secure storage.
const persistedSession = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('atproto_session')) : null
const persistedPdsUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('atproto_pds_url') : null

const agent = new BskyAgent({
  service: persistedPdsUrl || 'https://bsky.social', // Default PDS, can be overridden
  persistSession: (evt, session) => {
    // This callback is called by the agent when the session changes
    if (typeof localStorage !== 'undefined') {
      if (evt === 'update' && session) {
        localStorage.setItem('atproto_session', JSON.stringify(session))
      } else if (evt === 'clear') {
        localStorage.removeItem('atproto_session')
      }
    }
  }
})

// If there was a persisted session, the BskyAgent's constructor with persistSession
// should attempt to load it. We log this for debugging.
// console.log('Agent initialized. Attempted to load persisted session. Current session status:', agent.hasSession, agent.session);


export const setPdsUrl = (pdsUrl) => {
  if (agent.service.toString() !== pdsUrl) {
    agent.service = new URL(pdsUrl)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('atproto_pds_url', pdsUrl)
    }
    // If PDS changes, the current session might be for a different PDS.
    // The agent should ideally handle this, or we might need to clear session.
    // For now, we assume the user/app will manage re-login if PDS changes fundamentally.
    console.log('PDS URL set to:', pdsUrl)
  }
}

export const getPdsUrl = () => {
  return agent.service.toString()
}

// Function to explicitly try resuming session if needed, e.g. on app load.
// BskyAgent with persistSession should handle this, but this can be a manual trigger.
export const ensureSession = async () => {
  if (!agent.hasSession && persistedSession) {
    try {
      // The agent should have loaded the session via persistSession if available.
      // If not, a specific resume might be needed, or it implies the session is invalid/cleared.
      // This is more of a check.
      // Forcing a resume if persistSession didn't pick it up (older SDKs or specific scenarios)
      // await agent.resumeSession(persistedSession); // This was for older versions or direct session object passing
      // With current BskyAgent, `persistSession` handles loading. If it's not loaded, it means no valid session was found.
      console.log('ensureSession: Agent has session:', agent.hasSession, 'Persisted session found:', !!persistedSession)
    } catch (error) {
      console.warn('Failed to explicitly resume session in ensureSession:', error)
      // If resume fails, clear stored session as it might be corrupt or invalid
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('atproto_session')
      }
    }
  }
  return agent.hasSession
}

export default agent
