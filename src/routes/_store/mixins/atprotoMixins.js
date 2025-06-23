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

  Store.prototype.getCurrentAtprotoUser = async function () { // Made async
    const did = this.get().currentAtprotoSessionDid
    if (!did) {
      console.log('[Store Mixin] getCurrentAtprotoUser: No current DID.')
      return null
    }

    const session = this.get().atprotoSessions[did]
    if (!session) {
      console.log(`[Store Mixin] getCurrentAtprotoUser: No session found in store for DID ${did}.`)
      return null
    }

    // Session object from atprotoLoginApi contains: did, handle, email, accessJwt, refreshJwt
    // It does *not* contain full profile details like displayName, avatar from getProfile.
    // We need to fetch the profile from the database.

    const pdsHostname = new URL(getAgentPdsUrl() || this.get().atprotoPdsUrls[did] || 'https://bsky.social').hostname
    let userProfile = await getAtprotoAccount(pdsHostname, did)

    if (!userProfile) {
      console.warn(`[Store Mixin] getCurrentAtprotoUser: Profile for DID ${did} not found in DB. May need to fetch from network if agent is active.`)
      // Optionally, try to fetch from network if agent is available and has session, then store it.
      // This might be better handled during login/resumeSession to ensure DB is populated.
      // For now, we'll return based on what's in session and DB.
      // If profile is critical here, this function could trigger a network fetch.
    }

    // Construct the user object for UI, prioritizing DB profile data, fallback to session data.
    const displayName = userProfile?.displayName || session.handle;
    const avatar = userProfile?.avatar || null; // Prefer profile avatar
    const userForUI = {
      id: session.did,
      did: session.did,
      username: session.handle, // From session (guaranteed)
      handle: session.handle,   // From session
      displayName: displayName,
      avatar: avatar,
      // From profile if available
      description: userProfile?.description || '',
      followersCount: userProfile?.followersCount || 0,
      followsCount: userProfile?.followsCount || 0,
      postsCount: userProfile?.postsCount || 0,
      banner: userProfile?.banner || null,
      // General fields
      url: `https://bsky.app/profile/${session.did}`, // Example web URL
      pds: getAgentPdsUrl(),
      protocol: 'atproto',
      acct: `${session.handle}@${pdsHostname}`, // Enafore-style full account string
      // Raw data for debugging or more detailed views
      _session: session,
      _profile: userProfile || null
    }
    console.log(`[Store Mixin] getCurrentAtprotoUser returning for DID ${did}:`, userForUI) // Changed log to userForUI
    return userForUI
  }

  Store.prototype.fetchAtprotoNotifications = async function (limit = 30, cursor = null) {
    const currentDid = this.get().currentAtprotoSessionDid
    if (!currentDid || !this.get().isAtprotoSessionActive) {
      console.warn('[Store Mixin] fetchAtprotoNotifications: No active ATProto session.')
      this.set({ atprotoNotificationsLoading: false, atprotoNotificationsError: 'Not logged in.' })
      return
    }

    const pdsHostname = new URL(getAgentPdsUrl()).hostname
    const currentCursor = cursor || this.get().atprotoNotificationsCursor // Use passed cursor or stored one

    console.log(`[Store Mixin] fetchAtprotoNotifications called. DID: ${currentDid}, Limit: ${limit}, Cursor: ${currentCursor}`)
    this.set({ atprotoNotificationsLoading: true, atprotoNotificationsError: null })

    try {
      const { notifications: fetchedNotifications, cursor: newCursor } = await atprotoAPI.listNotifications(limit, currentCursor)

      // Save to DB
      await setAtprotoNotifications(pdsHostname, fetchedNotifications) // We don't pass cursor here, cursor is for the feed.
                                                                      // setAtprotoNotifications itself could call setAtprotoFeedCursor if needed.
      // For now, let's manage the MAIN_NOTIFICATIONS_FEED_ID cursor separately via atprotoFeeds.js if needed
      // Or, more simply, listNotifications is the source of truth for the "timeline" of notifications.
      // The DB storage of notifications is primarily for individual lookup and perhaps offline cache.
      // The `ATPROTO_NOTIFICATION_TIMELINES_STORE` is for ordering.

      // Update store state
      const existingNotifications = cursor ? this.get().atprotoNotifications : [] // If cursor, append. Else, replace.
      const allNotifications = [...existingNotifications, ...fetchedNotifications]
      // Simple de-duplication by notification URI (id)
      const uniqueNotifications = Array.from(new Map(allNotifications.map(n => [n.id, n])).values())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) // Sort newest first

      this.set({
        atprotoNotifications: uniqueNotifications,
        atprotoNotificationsCursor: newCursor || null, // Store the new cursor
        atprotoNotificationsLoading: false,
      })

      // Optionally, update unread count after fetching
      // await this.updateAtprotoUnreadCount(); // This might trigger another fetch, be careful.
      // Or, if listNotifications also implies "read up to this point", update seen.
      // For now, unread count is separate.

      console.log(`[Store Mixin] Fetched ${fetchedNotifications.length} ATProto notifications. New cursor: ${newCursor}. Total in store: ${uniqueNotifications.length}`)
    } catch (err) {
      console.error('[Store Mixin] fetchAtprotoNotifications error:', err.message, err)
      this.set({ atprotoNotificationsLoading: false, atprotoNotificationsError: err.message })
    }
  }

  Store.prototype.updateAtprotoUnreadCount = async function () {
    if (!this.get().isAtprotoSessionActive) return
    console.log('[Store Mixin] updateAtprotoUnreadCount called.')
    try {
      const count = await atprotoAPI.countUnreadNotifications()
      this.set({ atprotoUnreadNotificationCount: count })
      console.log(`[Store Mixin] ATProto unread notification count updated: ${count}`)
    } catch (err) {
      console.error('[Store Mixin] updateAtprotoUnreadCount error:', err.message, err)
      // Don't set global error for a background count update usually
    }
  }

  Store.prototype.markAtprotoNotificationsSeen = async function (seenAt = null) {
    if (!this.get().isAtprotoSessionActive) return
    console.log(`[Store Mixin] markAtprotoNotificationsSeen called. SeenAt: ${seenAt}`)
    this.set({ atprotoNotificationsLoading: true }) // Indicate activity
    try {
      await atprotoAPI.updateSeenNotifications(seenAt) // API call
      this.set({
        atprotoUnreadNotificationCount: 0, // Optimistically set unread count to 0
        atprotoNotificationsLoading: false
      })
      console.log('[Store Mixin] Marked ATProto notifications as seen.')
      // Optionally, re-fetch notifications or count to confirm, but often not needed immediately.
    } catch (err) {
      console.error('[Store Mixin] markAtprotoNotificationsSeen error:', err.message, err)
      this.set({ atprotoNotificationsLoading: false, atprotoNotificationsError: err.message })
    }
  }
}
