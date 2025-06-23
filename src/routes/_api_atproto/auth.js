import agent, { setPdsUrl, getPdsUrl, ensureSession } from './agent.js'

/**
 * Logs into an ATProto account (PDS).
 * Sets the PDS URL on the agent if provided or found in localStorage.
 * The session is persisted by the agent's `persistSession` callback.
 * @async
 * @param {string} identifier - User's handle or DID.
 * @param {string} password - User's app password.
 * @param {string} [pdsUrl] - Optional PDS URL. If not provided, uses agent's current or persisted PDS URL.
 * @returns {Promise<object>} The session data object from `agent.login()`.
 * @throws {Error} If login fails, throws an error with a user-friendly message.
 */
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
    return response.data
  } catch (error) {
    console.error(`[ATProto Auth] Login failed for ${identifier}:`, error.name, error.message, error)
    let message = 'Login failed. Please check your handle and password.'
    if (error.name === 'XRPCError') {
      // XRPCError has status and error (code string)
      if (error.status === 401 || error.status === 400 && error.error === 'InvalidRequest') { // InvalidRequest can be bad handle/pass
        message = 'Invalid handle or password. Please try again.'
      } else if (error.status === 500) {
        message = 'The server encountered an error. Please try again later.'
      } else {
        message = `Login error: ${error.message || 'Unknown server error'}. (Status: ${error.status})`
      }
    } else if (error.message.includes('NetworkError') || error.message.includes('fetch failed')) {
        message = 'Network error. Could not connect to the server. Please check your internet connection and PDS URL.'
    }
    throw new Error(message) // Re-throw with a potentially more user-friendly message
  }
}

/**
 * Attempts to resume an existing ATProto session.
 * Relies on the agent's `persistSession` mechanism and `ensureSession` helper.
 * @async
 * @returns {Promise<object|null>} The session data object if resumed successfully, otherwise null.
 */
export async function resumeAppSession () {
  console.log('[ATProto Auth] Attempting to resume app session...')
  try {
    await ensureSession()
    if (agent.hasSession) {
      console.log(`[ATProto Auth] Session successfully resumed for DID: ${agent.session.did}`)
      return agent.session
    }
    console.log('[ATProto Auth] No active session to resume.')
    return null
  } catch (error) {
    // Errors during ensureSession might be from an attempted refresh token usage that failed.
    console.warn('[ATProto Auth] Error during session resumption attempt:', error.name, error.message)
    // Don't necessarily throw here, as failing to resume isn't a critical app error,
    // just means user needs to log in.
    return null;
  }
}

/**
 * Logs out of the current ATProto session.
 * Clears the session from the agent and persisted storage (via `persistSession` callback and manual localStorage clear).
 * @async
 */
export async function logout () {
  console.log('[ATProto Auth] Attempting logout...')
  try {
    // No server-side action for agent.logout() as of current SDK, session is client-managed.
    // Clearing agent's session object and persisted data is key.
    agent.session = undefined;
    console.log('[ATProto Auth] Agent session property cleared.')

    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('atproto_session'); // persistSession callback should handle this
        console.log('[ATProto Auth] Cleared atproto_session from localStorage (manual).')
    }
    console.log('[ATProto Auth] Logout successful, session cleared locally.')
  } catch (error) { // Should generally not error if just clearing local state
    console.error('[ATProto Auth] Error during local logout:', error.name, error.message)
    // Still ensure local state is cleared as much as possible
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('atproto_session');
    }
    // No need to re-throw for local logout error usually.
  }
}

/**
 * Retrieves the active ATProto session data from the agent.
 * @returns {object|null} The session object if a session is active, otherwise null.
 */
export function getActiveSessionData () {
  if (agent.hasSession) {
    return agent.session
  }
  return null
}

/**
 * Gets the handle of the currently authenticated ATProto user.
 * @returns {string|null} The user's handle or null if no active session.
 */
export function getHandle () {
  return agent.hasSession ? agent.session.handle : null
}

/**
 * Gets the DID of the currently authenticated ATProto user.
 * @returns {string|null} The user's DID or null if no active session.
 */
export function getDid () {
  return agent.hasSession ? agent.session.did : null
}
