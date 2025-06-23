import agent, { setPdsUrl, getPdsUrl, ensureSession } from './agent.js'

export async function login (identifier, password, pdsUrl) {
  console.log(`[ATProto Auth] Attempting login for ${identifier} on PDS: ${pdsUrl || getPdsUrl() || 'default'}`)
  // Set PDS URL before login attempt, this also updates localStorage
  if (pdsUrl && getPdsUrl() !== pdsUrl) {
    console.log(`[ATProto Auth] Setting PDS URL to: ${pdsUrl}`)
    setPdsUrl(pdsUrl)
    // If PDS changed, agent's internal session (if any) is for the old PDS.
    // The login call will establish a new session for the new PDS.
    // BskyAgent's login should handle this.
  } else if (!pdsUrl && typeof localStorage !== 'undefined') {
    // If no PDS URL provided to login, but one is in localStorage, ensure agent uses it
    const storedPds = localStorage.getItem('atproto_pds_url')
    if (storedPds && getPdsUrl() !== storedPds) {
      console.log(`[ATProto Auth] Using stored PDS URL: ${storedPds}`)
      setPdsUrl(storedPds)
    }
  }


  try {
    const response = await agent.login({ identifier, password })
    // The `persistSession` callback in agent.js handles storing the session.
    console.log(`[ATProto Auth] Login successful for ${response.data.handle} (DID: ${response.data.did})`)
    return response.data // { accessJwt, refreshJwt, handle, did, email, didDoc, active, status }
  } catch (error) {
    console.error(`[ATProto Auth] Login failed for ${identifier}:`, error.message, error)
    // Clear any potentially partially stored session info if login fails hard
    if (typeof localStorage !== 'undefined') {
        // localStorage.removeItem('atproto_session'); // persistSession in agent should handle 'clear' on error
    }
    throw error
  }
}

export async function resumeAppSession () {
  // This function is called on app startup to try and resume
  // It relies on the agent's constructor using persistSession correctly
  // and ensureSession can be an additional check or trigger.
  console.log('[ATProto Auth] Attempting to resume app session...')
  await ensureSession() // ensureSession now mostly checks and logs
  if (agent.hasSession) {
    console.log(`[ATProto Auth] Session successfully resumed for DID: ${agent.session.did}`)
    return agent.session
  }
  console.log('[ATProto Auth] No active session to resume.')
  return null
}

export async function logout () {
  console.log('[ATProto Auth] Attempting logout...')
  try {
    // BskyAgent does not have an explicit server-side logout method
    // as sessions are primarily JWT based and managed client-side for expiration.
    // Clearing the session locally is the main action.
    // The `persistSession` callback with 'clear' event handles removing from localStorage.
    agent.session = undefined; // Manually trigger the 'clear' if no direct logout method that does it.
                               // Or rely on a method that clears and triggers persistSession 'clear'.
                               // As of recent versions, setting agent.session = undefined
                               // might not trigger persistSession. A more direct clear might be needed if available,
                               // or manually clearing localStorage and agent state.
    console.log('[ATProto Auth] Agent session property cleared.')

    // Forcing the persistSession 'clear' by directly manipulating what it checks:
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('atproto_session');
        console.log('[ATProto Auth] Cleared atproto_session from localStorage.')
        // also clear PDS URL on logout? Or keep it for next login? User choice.
        // localStorage.removeItem('atproto_pds_url');
    }
    // Reset agent's internal session state if not already cleared by persistSession
    // This depends on BskyAgent's internal implementation details.
    // A robust way is to re-initialize the agent or ensure its session object is null/undefined.
    // For now, we assume agent.session = undefined is enough to signal no session.
    // agent.session = null; // Or some other method to clear it.

    console.log('[ATProto Auth] Logout successful, session cleared locally.')
  } catch (error) {
    console.error('[ATProto Auth] Error during logout:', error)
    // Still clear locally even if a server call (if any existed) failed
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('atproto_session');
        console.log('[ATProto Auth] Ensured atproto_session cleared from localStorage after error.')
    }
    // agent.session = undefined;
  }
}

export function getActiveSessionData () {
  if (agent.hasSession) {
    return agent.session
  }
  return null
}

export function getHandle () {
  return agent.hasSession ? agent.session.handle : null
}

export function getDid () {
  return agent.hasSession ? agent.session.did : null
}
