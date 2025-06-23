import atprotoAgent, { setPdsUrl as setAgentPdsUrl, getPdsUrl as getAgentPdsUrl } from '../_api_atproto/agent.js'
import * as atprotoAPI from '../_api_atproto/auth.js' // Keep consistent with other API imports
import * as atprotoNotificationsAPI from '../_api_atproto/notifications.js' // For notifications
import * as atprotoPostsApi from '../_api_atproto/posts.js' // For getPostLikes, getPostReposters
import { setAtprotoAccount, getAtprotoAccount } from '../_database/atprotoAccounts.js'
import { setAtprotoPost, getAtprotoPost } from '../_database/atprotoPosts.js' // For persisting like/repost states
import { setAtprotoNotifications } from '../_database/atprotoNotifications.js' // For saving notifications
import { toast } from '../../_components/toast/toast.js' // For user feedback on bookmark actions
import { database } from '../_database/database.js' // For getAtprotoFeedCursor, setAtprotoFeedCursor
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

      sessionData = await atprotoAPI.login(identifier, password, getAgentPdsUrl()) // Changed to atprotoAPI.login
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
        // Clear ActivityPub active state
        currentInstance: null,
        currentRegisteredInstanceName: null,
        // Any other AP specific active timeline data might also need clearing here
        // e.g., if there are AP specific notification arrays in the root of the store:
        // apNotificationItems: [],
        // apUnreadNotificationCount: 0,
        // For now, focusing on core instance/session identifiers.
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
      await atprotoAPI.logout() // Changed to atprotoAPI.logout
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
      const session = await atprotoAPI.resumeAppSession() // Changed to atprotoAPI.resumeAppSession
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
    let cursorToUse = cursor || this.get().atprotoNotificationsCursor
    const notifFeedIdentifier = 'notifications_all'; // Stable key for notifications feed cursor

    if (!cursorToUse && typeof cursor !== 'string') { // Initial fetch or refresh, try DB
        const dbCursor = await database.getAtprotoFeedCursor(pdsHostname, notifFeedIdentifier);
        if (typeof dbCursor === 'string') {
            console.log(`[Store Mixin] fetchAtprotoNotifications: Using cursor from DB for ${notifFeedIdentifier}: ${dbCursor}`);
            cursorToUse = dbCursor;
        }
    }

    console.log(`[Store Mixin] fetchAtprotoNotifications called. DID: ${currentDid}, Limit: ${limit}, Cursor: ${cursorToUse}`)
    this.set({ atprotoNotificationsLoading: true, atprotoNotificationsError: null })

    try {
      const { notifications: fetchedNotifications, cursor: newApiCursor } = await atprotoNotificationsAPI.listNotifications(limit, cursorToUse)

      // Save notifications to their respective DB stores
      await setAtprotoNotifications(pdsHostname, fetchedNotifications)

      // Save the new cursor to DB and Svelte store
      await database.setAtprotoFeedCursor(pdsHostname, notifFeedIdentifier, newApiCursor);
      console.log(`[Store Mixin] fetchAtprotoNotifications: Stored new cursor for ${notifFeedIdentifier} (DB): ${newApiCursor}`);

      // Update store state
      const existingNotifications = cursorToUse ? this.get().atprotoNotifications : [] // If cursorToUse had a value, append. Else, replace.
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
      const count = await atprotoNotificationsAPI.countUnreadNotifications()
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
      await atprotoNotificationsAPI.updateSeenNotifications(seenAt) // API call
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

  // Helper function to find and update a status in all relevant timeline caches within the store
  // This is a simplified version. A real implementation would need to iterate through various timeline arrays
  // where full status objects are stored (e.g., different `timelineData_timelineItemSummaries[instance][timeline]` arrays,
  // or a potential central cache of fully hydrated posts if Enafore uses one).
  // For now, it focuses on `timelineData_timelineItemSummaries`.
  function _updateAtprotoStatusInAllTimelines(storeInstance, postUri, updateFn) {
    const storeState = storeInstance.get();
    let changed = false;
    const keysToUpdate = []; // Collect keys of timelines that changed to set them specifically

    for (const stateKey in storeState) {
      // Check if this state property holds timeline data (could be timelineItemSummaries or other relevant structures)
      if (stateKey.startsWith('timelineData_') && typeof storeState[stateKey] === 'object' && storeState[stateKey] !== null) {
        const timelineDataGroup = storeState[stateKey]; // e.g., storeState.timelineData_timelineItemSummaries

        for (const instanceName in timelineDataGroup) { // instanceName here is pdsHostname for atproto
          const instanceTimelines = timelineDataGroup[instanceName];
          if (typeof instanceTimelines === 'object' && instanceTimelines !== null) {
            for (const timelineName in instanceTimelines) {
              let items = instanceTimelines[timelineName];
              if (Array.isArray(items)) {
                let itemUpdatedInThisTimeline = false;
                const newItems = items.map(item => {
                  // Check if it's the target post and an atproto post
                  if (item && item.id === postUri && item.protocol === 'atproto') {
                    changed = true;
                    itemUpdatedInThisTimeline = true;
                    return updateFn(item); // Apply the update function
                  }
                  return item;
                });
                if (itemUpdatedInThisTimeline) {
                  // This direct modification might not trigger Svelte's reactivity if items is a nested object.
                  // It's often better to do this.set({ [stateKey]: newTimelineDataGroup })
                  timelineDataGroup[instanceName][timelineName] = newItems;
                  keysToUpdate.push(stateKey);
                }
              }
            }
          }
        }
      }
    }
    if (changed) {
      // To ensure reactivity, update the top-level keys that were modified.
      const finalChanges = {};
      new Set(keysToUpdate).forEach(key => finalChanges[key] = { ...storeState[key] });
      if (Object.keys(finalChanges).length > 0) {
        storeInstance.set(finalChanges);
        console.log(`[Store Mixin Helper] Updated status ${postUri} in relevant cached timelines.`);
      }
    }
  }


  Store.prototype.setPostLikeUri = function (pdsHostname, postUri, likeRecordUri, isLiked) {
    console.log(`[Store Mixin] setPostLikeUri for post ${postUri}. Like URI: ${likeRecordUri}, Is Liked: ${isLiked}`)
    _updateAtprotoStatusInAllTimelines(this, postUri, (status) => {
      const newStatus = { ...status };
      newStatus.myLikeUri = likeRecordUri;
      newStatus.favorited = isLiked; // Keep Enafore's boolean flag consistent

      // Optimistic count update
      if (typeof newStatus.likeCount !== 'number') newStatus.likeCount = 0;
      const oldIsLiked = status.myLikeUri && status.myLikeUri !== null; // Infer previous liked state

      if (isLiked && !oldIsLiked) {
        newStatus.likeCount++;
      } else if (!isLiked && oldIsLiked) {
        newStatus.likeCount = Math.max(0, newStatus.likeCount - 1);
      }
      // Ensure viewer state is updated if it exists (more aligned with bsky app.bsky.feed.defs#postView)
      newStatus.viewer = { ...(newStatus.viewer || {}), like: likeRecordUri };

      console.log(`[Store Mixin] Optimistically updated post ${postUri}: liked=${isLiked}, likeCount=${newStatus.likeCount}, likeUri=${likeRecordUri}`);
      return newStatus;
    });

    // Persist this change to the specific post in ATPROTO_POSTS_STORE
    getAtprotoPost(pdsHostname, postUri).then(postFromDb => {
      if (postFromDb) {
        const updatedPostForDb = { ...postFromDb };
        updatedPostForDb.myLikeUri = likeRecordUri;
        updatedPostForDb.viewer = { ...(updatedPostForDb.viewer || {}), like: likeRecordUri };
        if (typeof updatedPostForDb.likeCount !== 'number') updatedPostForDb.likeCount = 0;

        const oldIsLiked = postFromDb.myLikeUri && postFromDb.myLikeUri !== null;
        if (isLiked && !oldIsLiked) {
          updatedPostForDb.likeCount++;
        } else if (!isLiked && oldIsLiked) {
          updatedPostForDb.likeCount = Math.max(0, updatedPostForDb.likeCount - 1);
        }
        // Also update the 'favorited' boolean for consistency if it's stored in DB model
        updatedPostForDb.favorited = isLiked;

        setAtprotoPost(pdsHostname, updatedPostForDb)
          .then(() => console.log(`[Store Mixin DB] Persisted like state for post ${postUri}`))
          .catch(err => console.error(`[Store Mixin DB] Error persisting like state for post ${postUri}:`, err));
      } else {
        console.warn(`[Store Mixin DB] Post ${postUri} not found in DB for persisting like state.`)
      }
    }).catch(err => console.error(`[Store Mixin DB] Error fetching post ${postUri} for persisting like state:`, err));
  }

  Store.prototype.setPostRepostUri = function (pdsHostname, postUri, repostRecordUri, isReposted) {
    console.log(`[Store Mixin] setPostRepostUri for post ${postUri}. Repost URI: ${repostRecordUri}, Is Reposted: ${isReposted}`)
    _updateAtprotoStatusInAllTimelines(this, postUri, (status) => {
      const newStatus = { ...status };
      newStatus.myRepostUri = repostRecordUri;
      newStatus.reblogged = isReposted; // Keep Enafore's boolean flag consistent

      if (typeof newStatus.repostCount !== 'number') newStatus.repostCount = 0;
      const oldIsReposted = status.myRepostUri && status.myRepostUri !== null;

      if (isReposted && !oldIsReposted) {
        newStatus.repostCount++;
      } else if (!isReposted && oldIsReposted) {
        newStatus.repostCount = Math.max(0, newStatus.repostCount - 1);
      }
      newStatus.viewer = { ...(newStatus.viewer || {}), repost: repostRecordUri };

      console.log(`[Store Mixin] Optimistically updated post ${postUri}: reposted=${isReposted}, repostCount=${newStatus.repostCount}, repostUri=${repostRecordUri}`);
      return newStatus;
    });

    // Persist this change to the specific post in ATPROTO_POSTS_STORE
    getAtprotoPost(pdsHostname, postUri).then(postFromDb => {
      if (postFromDb) {
        const updatedPostForDb = { ...postFromDb };
        updatedPostForDb.myRepostUri = repostRecordUri;
        updatedPostForDb.viewer = { ...(updatedPostForDb.viewer || {}), repost: repostRecordUri };
        if (typeof updatedPostForDb.repostCount !== 'number') updatedPostForDb.repostCount = 0;

        const oldIsReposted = postFromDb.myRepostUri && postFromDb.myRepostUri !== null;
        if (isReposted && !oldIsReposted) {
          updatedPostForDb.repostCount++;
        } else if (!isReposted && oldIsReposted) {
          updatedPostForDb.repostCount = Math.max(0, updatedPostForDb.repostCount - 1);
        }
        // Also update the 'reblogged' boolean for consistency if it's stored in DB model
        updatedPostForDb.reblogged = isReposted;

        setAtprotoPost(pdsHostname, updatedPostForDb)
          .then(() => console.log(`[Store Mixin DB] Persisted repost state for post ${postUri}`))
          .catch(err => console.error(`[Store Mixin DB] Error persisting repost state for post ${postUri}:`, err));
      } else {
        console.warn(`[Store Mixin DB] Post ${postUri} not found in DB for persisting repost state.`)
      }
    }).catch(err => console.error(`[Store Mixin DB] Error fetching post ${postUri} for persisting repost state:`, err));
  }

  // --- Client-Side Bookmarks for ATProto ---

  Store.prototype.loadAtprotoBookmarks = async function () {
    const currentDid = this.get().currentAtprotoSessionDid;
    if (!currentDid || !this.get().isAtprotoSessionActive) {
      console.warn('[Store Mixin] loadAtprotoBookmarks: No active ATProto session.');
      this.set({ atprotoBookmarkedPostUris: new Set(), atprotoBookmarksList: [] });
      return;
    }
    const pdsHostname = new URL(getAgentPdsUrl() || this.get().atprotoPdsUrls[currentDid] || 'https://bsky.social').hostname;
    console.log(`[Store Mixin] loadAtprotoBookmarks for PDS: ${pdsHostname}, User DID: ${currentDid}`);
    this.set({ atprotoBookmarksLoading: true, atprotoBookmarksError: null });

    try {
      const bookmarks = await database.getAllAtprotoBookmarks(pdsHostname); // Load all, no limit for now
      const uris = new Set(bookmarks.map(b => b.postUri));

      // For atprotoBookmarksList, we'll store the raw {postUri, bookmarkedAt} from DB.
      // The UI component displaying the bookmarks list will be responsible for fetching
      // full post details for each URI using store.getOrFetchPostByUri or similar.
      this.set({
        atprotoBookmarkedPostUris: uris,
        atprotoBookmarksList: bookmarks.sort((a,b) => new Date(b.bookmarkedAt).getTime() - new Date(a.bookmarkedAt).getTime()), // newest first
        atprotoBookmarksLoading: false,
      });
      console.log(`[Store Mixin] Loaded ${uris.size} ATProto bookmark URIs.`);
    } catch (err) {
      console.error('[Store Mixin] loadAtprotoBookmarks error:', err.message, err);
      this.set({ atprotoBookmarksLoading: false, atprotoBookmarksError: err.message, atprotoBookmarkedPostUris: new Set(), atprotoBookmarksList: [] });
    }
  };

  Store.prototype.addAtprotoBookmark = async function (postUri) {
    const currentDid = this.get().currentAtprotoSessionDid;
    if (!currentDid || !this.get().isAtprotoSessionActive || !postUri) return;
    const pdsHostname = new URL(getAgentPdsUrl() || this.get().atprotoPdsUrls[currentDid] || 'https://bsky.social').hostname;
    console.log(`[Store Mixin] addAtprotoBookmark for post: ${postUri}`);

    try {
      const newBookmarkRecord = await database.addAtprotoBookmark(pdsHostname, postUri);

      const newUris = new Set(this.get().atprotoBookmarkedPostUris || []);
      newUris.add(postUri);

      let newBookmarksList = [...(this.get().atprotoBookmarksList || [])];
      if (!newBookmarksList.find(bm => bm.postUri === postUri)) {
          newBookmarksList.unshift(newBookmarkRecord); // Add to top (newest)
          newBookmarksList.sort((a,b) => new Date(b.bookmarkedAt).getTime() - new Date(a.bookmarkedAt).getTime());
      }

      this.set({ atprotoBookmarkedPostUris: newUris, atprotoBookmarksList: newBookmarksList });
      _updateAtprotoStatusInAllTimelines(this, postUri, (status) => ({ ...status, client_isBookmarked: true })); // Add client-side flag
      console.log(`[Store Mixin] Added ATProto bookmark for ${postUri}.`);
      toast.say('Bookmarked!'); // User feedback
    } catch (err) {
      console.error('[Store Mixin] addAtprotoBookmark error:', err.message, err);
      toast.say(`Failed to add bookmark: ${err.message}`);
    }
  };

  Store.prototype.removeAtprotoBookmark = async function (postUri) {
    const currentDid = this.get().currentAtprotoSessionDid;
    if (!currentDid || !this.get().isAtprotoSessionActive || !postUri) return;
    const pdsHostname = new URL(getAgentPdsUrl() || this.get().atprotoPdsUrls[currentDid] || 'https://bsky.social').hostname;
    console.log(`[Store Mixin] removeAtprotoBookmark for post: ${postUri}`);

    try {
      await database.removeAtprotoBookmark(pdsHostname, postUri);

      const newUris = new Set(this.get().atprotoBookmarkedPostUris || []);
      newUris.delete(postUri);

      const newList = (this.get().atprotoBookmarksList || []).filter(bm => bm.postUri !== postUri);

      this.set({ atprotoBookmarkedPostUris: newUris, atprotoBookmarksList: newList });
      _updateAtprotoStatusInAllTimelines(this, postUri, (status) => ({ ...status, client_isBookmarked: false }));
      console.log(`[Store Mixin] Removed ATProto bookmark for ${postUri}.`);
      toast.say('Bookmark removed.'); // User feedback
    } catch (err) {
      console.error('[Store Mixin] removeAtprotoBookmark error:', err.message, err);
      toast.say(`Failed to remove bookmark: ${err.message}`);
    }
  };

  Store.prototype.isPostAtprotoBookmarked = function (postUri) {
    const uris = this.get().atprotoBookmarkedPostUris;
    // Ensure uris is initialized (e.g. by loadAtprotoBookmarks) before checking
    if (uris === null && this.get().isAtprotoSessionActive && !this.get().atprotoBookmarksLoading) {
      // If uris is null (not loaded yet) and we are logged in and not currently loading, trigger a load.
      // This is a bit of a side-effect in a getter, might be better to ensure loadAtprotoBookmarks
      // is called on app init or when user logs into ATProto.
      // For now, just return false if not loaded to avoid triggering async load here.
      console.warn("[Store Mixin] isPostAtprotoBookmarked: Bookmarks not loaded yet. Call loadAtprotoBookmarks on app/session init.")
      return false;
    }
    return uris ? uris.has(postUri) : false;
  };
}
