import { store } from '../_store/store.js'
import { toast } from '../_components/toast/toast.js'
import { postStatus as apPostStatusToServer, putStatus as apPutStatusToServer } from '../_api/statuses.js'
import * as atprotoPostsApi from '../_api_atproto/posts.js'
import { addStatusOrNotification } from './addStatusOrNotification.js'
import { database } from '../_database/database.js'
import { emit } from '../_utils/eventBus.ts'
import { putMediaMetadata } from '../_api/media.js'
import { scheduleIdleTask } from '../_utils/scheduleIdleTask.js'
import { uniqById } from '../_utils/lodash-lite.js'
import { formatIntl } from '../_utils/formatIntl.js'
import { rehydrateStatusOrNotification } from './rehydrateStatusOrNotification.js'

export async function insertHandleForReply (realm, statusId) {
  const { currentInstance } = store.get()
  const status = await database.getStatus(currentInstance, statusId)
  const { currentVerifyCredentials } = store.get()
  const originalStatus = status.reblog || status
  let accounts = [originalStatus.account].concat(originalStatus.mentions || [])
    .filter(account => account.id !== currentVerifyCredentials.id)
  // Pleroma includes account in mentions as well, so make uniq
  accounts = uniqById(accounts)
  if (!store.getComposeData(realm, 'text') && accounts.length) {
    store.setComposeData(realm, {
      text: accounts.map(account => `@${account.acct} `).join('')
    })
  }
}

export async function postStatus (realm, text, inReplyToId, mediaIds, // mediaIds is for AP
  sensitive, spoilerText, visibility,
  mediaDescriptions, inReplyToUuid, poll, mediaFocalPoints, contentType, quoteId, localOnly, editId,
  mediaFiles = [] /* New parameter for atproto File objects */ ) {
  // For ATProto: inReplyToId should be an object { parentUri, parentCid, rootUri, rootCid }
  // mediaFiles for ATProto are actual File objects. mediaIds is for AP.
  // sensitive, spoilerText, visibility, poll, contentType, localOnly are Mastodon specific for now.
  const { currentInstance, accessToken, online, currentAccountProtocol } = store.get()

  if (!online) {
    toast.say('intl.cannotPostOffline')
    return
  }

  text = text || ''

  const mediaMetadata = (mediaIds || []).map((mediaId, idx) => {
    return {
      description: mediaDescriptions && mediaDescriptions[idx],
      focalPoint: mediaFocalPoints && mediaFocalPoints[idx]
    }
  })

  store.set({ postingStatus: true })
  try {
    await Promise.all(mediaMetadata.map(async ({ description, focalPoint }, i) => {
      description = description || ''
      focalPoint = focalPoint || [0, 0]
      focalPoint[0] = focalPoint[0] || 0
      focalPoint[1] = focalPoint[1] || 0
      if (description || focalPoint[0] || focalPoint[1]) {
        return putMediaMetadata(currentInstance, accessToken, mediaIds[i], description, focalPoint)
      }
    }))

    if (currentAccountProtocol === 'atproto') {
      if (editId) {
        console.warn('[Action compose] Editing posts is not yet supported for ATProto.')
        toast.say('Editing posts is not yet supported for Bluesky accounts.')
        store.set({ postingStatus: false })
        return
      }

      // Prepare data for atprotoPostsApi.createPost
      const atpPostDetails = { text }
      if (inReplyToId && typeof inReplyToId === 'object' && inReplyToId.parentUri && inReplyToId.parentCid) {
        atpPostDetails.replyToUri = inReplyToId.parentUri // This is the direct parent
        atpPostDetails.replyToCid = inReplyToId.parentCid // This is the direct parent's CID
        // For robust replies, root URI/CID should also be passed if available from `inReplyToId` object.
        // Example: atpPostDetails.replyRootUri = inReplyToId.rootUri; atpPostDetails.replyRootCid = inReplyToId.rootCid;
        // For now, _api_atproto/posts.js createPost expects replyToUri and replyToCid for the direct parent.
        // It will need to be enhanced if Enafore's inReplyToId contains separate root/parent details.
        if (inReplyToId?.rootUri && inReplyToId?.rootCid) { // Assuming inReplyToId might carry root info
            atpPostDetails.reply = {
                root: { uri: inReplyToId.rootUri, cid: inReplyToId.rootCid },
                parent: { uri: inReplyToId.parentUri, cid: inReplyToId.parentCid }
            }
        } else if (inReplyToId?.parentUri && inReplyToId?.parentCid) {
             atpPostDetails.reply = { // If only parent, parent is also root
                root: { uri: inReplyToId.parentUri, cid: inReplyToId.parentCid },
                parent: { uri: inReplyToId.parentUri, cid: inReplyToId.parentCid }
            }
        }
      }

      // Handle Media Uploads for ATProto
      if (mediaFiles && mediaFiles.length > 0) {
        const uploadedImageEmbeds = [];
        // mediaDescriptions is an array of strings corresponding to mediaFiles
        for (let i = 0; i < mediaFiles.length; i++) {
          const file = mediaFiles[i];
          const altText = mediaDescriptions && mediaDescriptions[i] ? mediaDescriptions[i] : '';
          try {
            console.log(`[Action compose] Uploading image ${i + 1} for ATProto post.`);
            const imageEmbed = await atprotoPostsApi.uploadImageAndGetEmbed(file, altText);
            if (imageEmbed) {
              uploadedImageEmbeds.push(imageEmbed);
            }
          } catch (uploadError) {
            console.error(`[Action compose] Failed to upload image ${file.name}:`, uploadError.message);
            toast.say(`Failed to upload ${file.name}: ${uploadError.message}`);
            // Decide if post should still proceed or fail entirely. For now, proceed without failed image.
          }
        }
        if (uploadedImageEmbeds.length > 0) {
          atpPostDetails.embed = {
            $type: 'app.bsky.embed.images',
            images: uploadedImageEmbeds // [{ image: BlobRef, alt: '...' }, ...]
          };
          console.log('[Action compose] Image embeds prepared for ATProto post:', atpPostDetails.embed);
        }
      }
      // TODO: Handle other embed types like quotes (app.bsky.embed.record) or external links (app.bsky.embed.external)
      // This would involve checking `quoteId` or other parameters and constructing the appropriate `embed` object.
      // If multiple embed types are possible (e.g. quote + images), it would be app.bsky.embed.recordWithMedia.

      // TODO: Handle facets (mentions, links, tags) - UI needs to generate these and pass them.
      // TODO: Handle langs - UI could provide this and pass it.

      const { uri: newPostUri, cid: newPostCid } = await atprotoPostsApi.createPost(atpPostDetails)
      console.log(`[Action compose] ATProto post created: ${newPostUri}`)

      // After posting, ATProto doesn't return the full post object.
      // We need to either fetch it, or construct a partial one to add to timelines.
      // For now, let's try to fetch it to get a full object for consistency.
      // This could be slow. A more optimistic update would construct a local partial status.
      // This also assumes `getAtprotoPost` can fetch and transform.
      // A better approach might be to use agent.getPostThread({ uri: newPostUri, depth: 0 })
      // then transform the result. For now, this is a placeholder for proper local insertion.

      // --- Placeholder for fetching the newly created post ---
      // const newPost = await store.fetchAndTransformAtprotoPost(newPostUri); // Conceptual
      // if (newPost) {
      //   addStatusOrNotification(currentInstance, 'home', newPost); // currentInstance is PDS hostname
      // } else {
      //   console.warn(`[Action compose] Could not fetch newly created ATProto post ${newPostUri} for timeline update.`)
      // }
      // For a simpler optimistic update (without fetching):
      // getCurrentAtprotoUser is async, so await it.
      const currentUser = await store.getCurrentAtprotoUser();

      if (!currentUser) {
        console.error('[Action compose] ATProto: Could not get current user for optimistic post. Aborting optimistic update.');
        // Post was still made, but local timeline won't update until next fetch.
        // UI should still be notified the post attempt was made.
        emit('postedStatus', realm, inReplyToUuid);
      } else {
        const optimisticPost = {
          id: newPostUri, // AT URI
          uri: newPostUri,
          cid: newPostCid,
          content: text, // record.text
          protocol: 'atproto',
          author: currentUser, // From store.getCurrentAtprotoUser()
          createdAt: atpPostDetails.createdAt || new Date().toISOString(), // from input or now
          indexedAt: new Date().toISOString(), // Optimistic indexedAt

          // Default/empty values for a new post
          replyCount: 0,
          repostCount: 0,
          likeCount: 0,
          media_attachments: atpPostDetails.embed?.$type === 'app.bsky.embed.images'
            ? atpPostDetails.embed.images.map(imgEmb => ({
                type: 'image', // Assuming all are images for now
                url: imgEmb.image.ref?.$link || '', // This is the CID link, not a direct viewable URL yet
                preview_url: '', // Bluesky image service might generate thumbs, or client can use fullsize
                remote_url: imgEmb.image.ref?.$link || '',
                description: imgEmb.alt,
                // id: needs a stable ID, maybe the CID string?
                id: imgEmb.image.ref?.$link,
              }))
            : [],
          card: null, // TODO: Populate if external link embed
          quote_post: null, // TODO: Populate if it was a quote post
          mentions: [], // TODO: Populate from facets
          tags: [],     // TODO: Populate from facets
          emojis: [],
          spoiler_text: '', // ATProto uses labels, direct mapping is complex
          sensitive: false, // TODO: Derive from labels if any were applied to self-post
          visibility: 'public', // ATProto posts are generally public
          application: { name: 'Enafore (atproto)' }, // Placeholder

          // Reply specific (if applicable)
          in_reply_to_id: atpPostDetails.replyToUri || null,
          in_reply_to_account_id: null, // Would need to fetch parent post's author DID
          replyParentUri: atpPostDetails.replyToUri || null,
          replyRootUri: atpPostDetails.replyRootUri || (atpPostDetails.replyToUri ? atpPostDetails.replyToUri : null), // If only parent, parent is root

          // ATProto specific viewer state for new post by current user
          viewer: {
            like: undefined, // No like URI yet
            repost: undefined, // No repost URI yet
          },
          myLikeUri: undefined,
          myRepostUri: undefined,
          favorited: false, // Not liked by self initially
          reblogged: false, // Not reposted by self initially
        };

        // Add to local store (e.g., home timeline)
        // currentInstance for atproto should be the PDS hostname
        addStatusOrNotification(currentInstance, 'home', optimisticPost);
        console.log('[Action compose] Optimistically added ATProto post to home timeline.')
        emit('postedStatus', realm, inReplyToUuid); // Notify UI
        // TODO: Fetch updated timeline or user feed to see the new post eventually for consistency,
        // or rely on streaming if that gets implemented for atproto.
      }

    } else { // ActivityPub
      if (editId) {
        const status = await apPutStatusToServer(currentInstance, accessToken, editId, text,
          inReplyToId, mediaIds, sensitive, spoilerText, visibility, poll, contentType, quoteId, localOnly)
        await database.insertStatus(currentInstance, status)
        await rehydrateStatusOrNotification({ status })
        emit('statusUpdated', status)
        emit('postedStatus', realm, inReplyToUuid)
      } else {
        const status = await apPostStatusToServer(currentInstance, accessToken, text,
          inReplyToId, mediaIds, sensitive, spoilerText, visibility, poll, contentType, quoteId, localOnly)
        addStatusOrNotification(currentInstance, 'home', status)
        emit('postedStatus', realm, inReplyToUuid)
      }
    }
    store.clearComposeData(realm)
    scheduleIdleTask(() => (mediaIds || []).forEach(mediaId => database.deleteCachedMediaFile(mediaId)))
  } catch (e) {
    console.error('[Action compose] Error:', e)
    toast.say(formatIntl('intl.unableToPost', { error: (e.message || '') }))
  } finally {
    store.set({ postingStatus: false })
  }
}

export function setReplySpoiler (realm, spoiler) {
  const contentWarning = store.getComposeData(realm, 'contentWarning')
  const contentWarningShown = store.getComposeData(realm, 'contentWarningShown')
  if (typeof contentWarningShown !== 'undefined' || contentWarning) {
    return // user has already interacted with the CW
  }
  store.setComposeData(realm, {
    contentWarning: spoiler,
    contentWarningShown: true
  })
}

const PRIVACY_LEVEL = {
  direct: 1,
  private: 2,
  unlisted: 3,
  public: 4
}

export function setReplyVisibility (realm, replyVisibility) {
  // return the most private between the user's preferred default privacy
  // and the privacy of the status they're replying to
  const postPrivacy = store.getComposeData(realm, 'postPrivacy')
  if (typeof postPrivacy !== 'undefined') {
    return // user has already set the postPrivacy
  }
  const { currentVerifyCredentials } = store.get()
  const defaultVisibility = currentVerifyCredentials.source.privacy || 'public'
  const visibility = PRIVACY_LEVEL[replyVisibility] < PRIVACY_LEVEL[defaultVisibility]
    ? replyVisibility
    : defaultVisibility
  store.setComposeData(realm, { postPrivacy: visibility })
}
