// Monopoly admin state persistence — S3 (falls back to in-memory when creds missing).
//
// Layout in bucket:
//   monopoly/state.json         — { decks: {...}, logos: {...} }
//   monopoly/logos/<uuid>.<ext> — uploaded logo binaries

const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const monopolyData = require('./monopoly-data');

const STATE_KEY = 'monopoly/state.json';
const LOGO_PREFIX = 'monopoly/logos/';

const S3_ENDPOINT = process.env.S3_ENDPOINT || '';
const S3_REGION = process.env.S3_REGION || 'us-east-1';
const S3_BUCKET = process.env.S3_BUCKET || '';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';
const MONOPOLY_IMAGE_BASE = process.env.MONOPOLY_IMAGE_BASE || '';

const s3Enabled = !!(S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);

let s3 = null;
if (s3Enabled) {
  s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    forcePathStyle: true,
  });
}

// In-memory cache, also serves as fallback when S3 disabled.
let state = null;

function classicDeck() {
  return {
    name: 'Классическая',
    locked: true,
    groups: JSON.parse(JSON.stringify(monopolyData.groups)),
    properties: JSON.parse(JSON.stringify(monopolyData.properties)),
    transport: JSON.parse(JSON.stringify(monopolyData.transport)),
    utilities: JSON.parse(JSON.stringify(monopolyData.utilities)),
    board: JSON.parse(JSON.stringify(monopolyData.board)),
  };
}

function emptyState() {
  return { decks: { classic: classicDeck() }, logos: {} };
}

async function streamToString(body) {
  if (typeof body.transformToString === 'function') return body.transformToString();
  return await new Promise((resolve, reject) => {
    const chunks = [];
    body.on('data', (c) => chunks.push(c));
    body.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    body.on('error', reject);
  });
}

async function loadFromS3() {
  if (!s3) return emptyState();
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: STATE_KEY }));
    const text = await streamToString(res.Body);
    const parsed = JSON.parse(text);
    if (!parsed.decks) parsed.decks = {};
    if (!parsed.logos) parsed.logos = {};
    // Always ensure classic deck exists and is fresh
    parsed.decks.classic = classicDeck();
    return parsed;
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return emptyState();
    }
    console.error('[monopoly-store] S3 load failed:', err.message);
    return emptyState();
  }
}

async function saveToS3() {
  if (!s3 || !state) return;
  // Never persist the classic deck — regenerate on load
  const toSave = { ...state, decks: { ...state.decks } };
  delete toSave.decks.classic;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: STATE_KEY,
      Body: JSON.stringify(toSave, null, 2),
      ContentType: 'application/json',
    }));
  } catch (err) {
    console.error('[monopoly-store] S3 save failed:', err.message);
    throw err;
  }
}

async function init() {
  state = s3Enabled ? await loadFromS3() : emptyState();
  console.log(`[monopoly-store] initialized (S3 ${s3Enabled ? 'enabled' : 'disabled'}, decks: ${Object.keys(state.decks).length}, logos: ${Object.keys(state.logos).length})`);
}

function getState() { return state; }

function getDeck(deckId) {
  if (!state) return classicDeck();
  return state.decks[deckId] || state.decks.classic;
}

function listDecks() {
  if (!state) return [{ id: 'classic', name: 'Классическая', locked: true }];
  return Object.entries(state.decks).map(([id, d]) => ({ id, name: d.name, locked: !!d.locked }));
}

async function saveDeck(deckId, deck) {
  if (!state) throw new Error('store not initialized');
  if (state.decks[deckId]?.locked && deckId === 'classic') {
    throw new Error('classic deck is read-only — duplicate first');
  }
  state.decks[deckId] = { ...deck, locked: false };
  await saveToS3();
  return state.decks[deckId];
}

async function deleteDeck(deckId) {
  if (!state) throw new Error('store not initialized');
  if (deckId === 'classic') throw new Error('cannot delete classic');
  delete state.decks[deckId];
  await saveToS3();
}

function logoPublicUrl(key) {
  if (MONOPOLY_IMAGE_BASE) {
    const sep = MONOPOLY_IMAGE_BASE.endsWith('/') ? '' : '/';
    const keyWithoutPrefix = key.startsWith('monopoly/') ? key.substring('monopoly/'.length) : key;
    return `${MONOPOLY_IMAGE_BASE}${sep}${keyWithoutPrefix}`;
  }
  if (!S3_ENDPOINT || !S3_BUCKET) return null;
  const ep = S3_ENDPOINT.replace(/\/$/, '');
  return `${ep}/${S3_BUCKET}/${key}`;
}

async function uploadLogo({ buffer, mimetype, name, tags }) {
  if (!state) throw new Error('store not initialized');
  if (!s3) throw new Error('S3 not configured — cannot upload');
  const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
  const ext = extMap[mimetype] || 'png';
  const id = crypto.randomUUID();
  const key = `${LOGO_PREFIX}${id}.${ext}`;
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
    ACL: 'public-read',
  }));
  const url = logoPublicUrl(key);
  const entry = {
    id, key, url,
    name: name || 'Без названия',
    tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map((t) => t.trim()).filter(Boolean) : []),
    uploadedAt: Date.now(),
  };
  state.logos[id] = entry;
  await saveToS3();
  return entry;
}

async function deleteLogo(logoId) {
  if (!state) throw new Error('store not initialized');
  const logo = state.logos[logoId];
  if (!logo) return;
  if (s3 && logo.key) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: logo.key }));
    } catch (err) {
      console.warn('[monopoly-store] failed to delete logo object:', err.message);
    }
  }
  delete state.logos[logoId];
  await saveToS3();
}

function listLogos() {
  if (!state) return [];
  return Object.values(state.logos).sort((a, b) => b.uploadedAt - a.uploadedAt);
}

function findLogoUsage(logoId) {
  // Return list of { deckId, cellIndex, field } where this logo is referenced.
  const out = [];
  if (!state) return out;
  for (const [deckId, deck] of Object.entries(state.decks)) {
    if (!deck.properties) continue;
    for (const [slug, prop] of Object.entries(deck.properties || {})) {
      if (prop.logoId === logoId) out.push({ deckId, slug, type: 'property' });
    }
    for (const [slug, t] of Object.entries(deck.transport || {})) {
      if (t.logoId === logoId) out.push({ deckId, slug, type: 'transport' });
    }
    for (const [slug, u] of Object.entries(deck.utilities || {})) {
      if (u.logoId === logoId) out.push({ deckId, slug, type: 'utility' });
    }
  }
  return out;
}

module.exports = {
  init, getState, getDeck, listDecks, saveDeck, deleteDeck,
  uploadLogo, deleteLogo, listLogos, findLogoUsage,
  s3Enabled,
};
