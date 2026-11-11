const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { MINUTE_MS, segment } = require('./dmAttachmentDelivery');
const { dmMessageSession, inDmConversation, writeDmMessage } = require('./dmConversations');

const filenames = new Map([
  ['image/jpeg', 'photo.jpg'],
  ['image/png', 'photo.png'],
  ['image/webp', 'photo.webp'],
]);
const MAX_BYTES = 10 * 1024 * 1024 - 1;
const denied = () => new HttpsError('permission-denied', '目前無法存取這張私訊照片。');
const invalid = () =>
  new HttpsError('invalid-argument', '請選擇小於 10 MB 的 JPG、PNG 或 WebP 照片。');

function photoFolder(conversationId, senderId, messageId) {
  const mediaId = createHash('sha256')
    .update(JSON.stringify([senderId, messageId]))
    .digest('hex');
  return `conversations/${conversationId}/photos/${mediaId}`;
}

function generation(metadata) {
  const value = metadata?.generation;
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw denied();
  return value;
}

function matchesPhotoHeader(bytes, mime) {
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png')
    return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  return (
    mime === 'image/webp' &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  );
}

// Signed POST policies can be replayed until they expire. Publish a create-only copy
// under a key for which we never issue a POST, then pin that copy's generation.
async function publishPhoto(bucket, path, publishedPath, mime, session) {
  const draft = bucket.file(path);
  const [meta] = await draft.getMetadata();
  const sourceGeneration = generation(meta);
  if (
    meta.metadata?.uploader !== session.uid ||
    meta.metadata?.messageid !== session.messageId ||
    meta.contentType !== mime ||
    meta.contentEncoding ||
    !Number.isSafeInteger(Number(meta.size)) ||
    Number(meta.size) <= 0 ||
    Number(meta.size) > MAX_BYTES
  )
    throw denied();
  const source = bucket.file(path, { generation: sourceGeneration });
  const [header] = await source.download({ start: 0, end: 11, validation: false });
  if (!matchesPhotoHeader(header, mime)) throw invalid();
  const published = bucket.file(publishedPath);
  try {
    await source.copy(published, {
      preconditionOpts: { ifGenerationMatch: 0 },
      contentType: mime,
      cacheControl: 'private, no-store',
      metadata: { uploader: session.uid, messageid: session.messageId },
    });
  } catch (error) {
    if (Number(error?.code) !== 412) throw error;
  }
  const [saved] = await published.getMetadata();
  if (
    saved.metadata?.uploader !== session.uid ||
    saved.metadata?.messageid !== session.messageId ||
    saved.contentType !== mime ||
    saved.metadata?.firebaseStorageDownloadTokens ||
    !meta.crc32c ||
    saved.crc32c !== meta.crc32c ||
    saved.size !== meta.size
  )
    throw denied();
  return { version: generation(saved), draft: source };
}

function createDmPhotos({ db, getBucket, now = Date.now }) {
  async function delivery(request) {
    const session = dmMessageSession(request);
    const { uid, conversationId, messageId } = session;
    const { action, size, fileName, contentType, mediaId } = request.data;
    if (action === 'uploadPhoto') {
      if (
        !filenames.has(contentType) ||
        filenames.get(contentType) !== fileName ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > MAX_BYTES
      )
        throw invalid();
      await inDmConversation(
        db,
        session,
        ({ existing }) => {
          if (existing) throw denied();
        },
        { allowMissing: true, requireCanonicalProfile: true },
      );
      const folder = photoFolder(conversationId, uid, messageId);
      const path = `${folder}/${fileName}`;
      const fields = {
        'Content-Type': contentType,
        'x-goog-meta-uploader': uid,
        'x-goog-meta-messageid': messageId,
      };
      const expires = now() + MINUTE_MS;
      const [policy] = await getBucket()
        .file(path)
        .generateSignedPostPolicyV4({
          expires,
          fields,
          conditions: [['content-length-range', size, size]],
        });
      return {
        method: 'POST',
        url: policy.url,
        fields: policy.fields,
        mediaId: folder.split('/').at(-1),
        path,
        expiresAt: new Date(expires).toISOString(),
      };
    }

    if (
      action !== 'read' ||
      request.data.folder !== 'photos' ||
      !segment(mediaId) ||
      !/^sent\.(jpg|png|webp)$/.test(fileName)
    )
      throw invalid();
    const path = `conversations/${conversationId}/photos/${mediaId}/${fileName}`;
    const version = await inDmConversation(
      db,
      session,
      ({ existing: row }) => {
        if (
          row?.type !== 'image' ||
          row.recalledAt ||
          row.attachmentPath !== path ||
          path !== photoFolder(conversationId, row.senderId, messageId) + '/' + fileName
        )
          throw denied();
        return generation({ generation: row.attachmentGeneration });
      },
      { requireCanonicalProfile: true },
    );
    const expires = now() + MINUTE_MS;
    const [url] = await getBucket()
      .file(path, { generation: version })
      .getSignedUrl({ version: 'v4', action: 'read', expires });
    return { url, expiresAt: new Date(expires).toISOString() };
  }

  async function send(request) {
    const session = dmMessageSession(request);
    const { uid, conversationId, messageId } = session;
    const { path } = request.data;
    const folder = photoFolder(conversationId, uid, messageId);
    const entry = [...filenames].find(([, name]) => path === folder + '/' + name);
    if (!entry) throw invalid();
    const publishedPath = folder + '/' + entry[1].replace('photo.', 'sent.');
    const receipt = { conversationId, messageId };
    function replay({ existing: row }) {
      if (!row) return false;
      if (row.senderId !== uid || row.type !== 'image' || row.attachmentPath !== publishedPath) {
        throw new HttpsError('already-exists', '這個訊息編號已使用。');
      }
      return true;
    }
    if (await inDmConversation(db, session, replay, { allowMissing: true, requireCanonicalProfile: true })) return receipt;
    let published;
    try {
      published = await publishPhoto(getBucket(), path, publishedPath, entry[0], session);
    } catch (error) {
      // A parallel attempt can finish and remove the staging object before this read.
      if (Number(error?.code) !== 404) throw error;
      if (await inDmConversation(db, session, replay, { allowMissing: true, requireCanonicalProfile: true })) return receipt;
      throw new HttpsError('not-found', '找不到已上傳的照片。');
    }
    const { version, draft } = published;
    await inDmConversation(
      db,
      session,
      (context) => {
        if (replay(context)) return;
        writeDmMessage(context, session, {
          type: 'image',
          content: '照片',
          attachmentPath: publishedPath,
          attachmentGeneration: version,
        });
      },
      { allowMissing: true, requireCanonicalProfile: true },
    );
    // The committed message always points to the immutable copy. A cleanup failure
    // cannot turn a delivered message into a failed send or delete a subsequent upload.
    await draft.delete().catch(() => {});
    return receipt;
  }
  return { delivery, send };
}

module.exports = { createDmPhotos };
