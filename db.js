const fs = require('fs');
const path = require('path');
const https = require('https');

const LOCAL_PATH = process.env.DB_PATH || '/data/db.json';
const GIST_FILENAME = 'elevate-bot-db.json';

function ensureDir() {
  try { fs.mkdirSync(path.dirname(LOCAL_PATH), { recursive: true }); } catch {}
}

function localLoad() {
  try {
    ensureDir();
    if (!fs.existsSync(LOCAL_PATH)) {
      fs.writeFileSync(LOCAL_PATH, JSON.stringify({ levels: { users: {} }, journal: {} }));
    }
    const raw = fs.readFileSync(LOCAL_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data.levels) data.levels = { users: {} };
    if (!data.levels.users) data.levels.users = {};
    if (!data.journal) data.journal = {};
    return data;
  } catch { return { levels: { users: {} }, journal: {} }; }
}

function localSave(data) {
  try { ensureDir(); fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Local save error:', e); }
}

function gistRequest(method, body = null) {
  return new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN;
    const gistId = process.env.GIST_ID;
    if (!token || !gistId) return reject(new Error('Missing GIST_ID or GITHUB_TOKEN'));
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: `/gists/${gistId}`,
      method,
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'elevate-bot',
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

let _store = null;
let _saveQueue = Promise.resolve();

let _loadComplete = false;
let _startupUserCount = 0;

async function loadAll() {
  _loadComplete = false;
  if (process.env.GIST_ID && process.env.GITHUB_TOKEN) {
    try {
      console.log('Loading DB from Gist...');
      const gist = await gistRequest('GET');
      const content = gist?.files?.[GIST_FILENAME]?.content;
      if (content && content.trim() !== '{}' && content.trim() !== '') {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object') {
          if (!parsed.levels) parsed.levels = { users: {} };
          if (!parsed.levels.users) parsed.levels.users = {};
          if (!parsed.journal) parsed.journal = {};
          _store = parsed;
          localSave(_store);
          _startupUserCount = Object.keys(_store.levels.users || {}).length;
          _loadComplete = true;
          console.log('✅ DB loaded from Gist, users: ' + _startupUserCount);
          return _store;
        }
      }
      console.warn('⚠️  Gist empty or invalid, checking local backup...');
    } catch (e) {
      console.warn('⚠️  Gist load failed: ' + e.message + ' — falling back to local backup');
    }
  }

  _store = localLoad();
  _startupUserCount = Object.keys(_store.levels?.users || {}).length;
  _loadComplete = true;
  console.log('✅ DB loaded from local, users: ' + _startupUserCount);

  if (_startupUserCount > 0 && process.env.GIST_ID && process.env.GITHUB_TOKEN) {
    saveToGist().catch(() => {});
  }
  return _store;
}

function getStore() {
  if (!_store) _store = localLoad();
  return _store;
}

async function saveToGist() {
  if (!_store || !process.env.GIST_ID || !process.env.GITHUB_TOKEN) return;

  if (!_loadComplete) {
    console.warn('⚠️  Gist save blocked: loadAll() has not finished yet.');
    return;
  }

  const currentUserCount = Object.keys(_store.levels?.users || {}).length;
  if (_startupUserCount > 0 && currentUserCount < _startupUserCount) {
    console.error(
      `🚨 SAFETY BLOCK: refusing Gist save — store has ${currentUserCount} users ` +
      `but we loaded ${_startupUserCount} at startup. Possible data-loss prevented.`
    );
    return;
  }

  try {
    await gistRequest('PATCH', {
      files: { [GIST_FILENAME]: { content: JSON.stringify(_store, null, 2) } }
    });
    console.log('💾 Saved to Gist, users: ' + currentUserCount);
  } catch (e) {
    console.warn('⚠️  Gist save failed: ' + e.message);
  }
}

let _gistTimer = null;
function markDirty() {
  if (!_loadComplete) {
    console.warn('⚠️  markDirty called before loadAll() completed — skipping save.');
    return;
  }
  localSave(_store);
  if (_gistTimer) clearTimeout(_gistTimer);
  _gistTimer = setTimeout(() => { saveToGist().catch(() => {}); }, 500);
}

process.on('SIGTERM', async () => {
  if (_gistTimer) clearTimeout(_gistTimer);
  await saveToGist().catch(() => {});
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (_gistTimer) clearTimeout(_gistTimer);
  await saveToGist().catch(() => {});
  process.exit(0);
});

module.exports = { loadAll, getStore, markDirty };
