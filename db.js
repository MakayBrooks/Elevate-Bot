const fs = require('fs');
const path = require('path');
const https = require('https');

const LOCAL_PATH = path.join(__dirname, 'data', 'db.json');
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
    const data = JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
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
    if (!token || !gistId) return reject(new Error('No GIST_ID or GITHUB_TOKEN'));
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
let _dirty = false;
let _loaded = false;

async function loadAll() {
  // Always reload from Gist on startup — never skip
  if (process.env.GIST_ID && process.env.GITHUB_TOKEN) {
    try {
      console.log('🔄 Loading DB from Gist...');
      const gist = await gistRequest('GET');
      const content = gist?.files?.[GIST_FILENAME]?.content;
      if (content) {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object') {
          if (!parsed.levels) parsed.levels = { users: {} };
          if (!parsed.levels.users) parsed.levels.users = {};
          if (!parsed.journal) parsed.journal = {};
          _store = parsed;
          localSave(_store);
          _loaded = true;
          console.log(`✅ DB loaded from Gist — ${Object.keys(_store.levels.users || {}).length} users`);
          return _store;
        }
      }
      console.warn('⚠️ Gist empty or invalid, using local');
    } catch (e) {
      console.warn('⚠️ Gist load failed:', e.message);
    }
  }
  // Fallback to local
  _store = localLoad();
  _loaded = true;
  console.log(`📁 DB loaded from local — ${Object.keys(_store.levels?.users || {}).length} users`);
  return _store;
}

function getStore() {
  if (!_store) {
    _store = localLoad();
  }
  return _store;
}

function markDirty() {
  _dirty = true;
  localSave(_store); // immediate local backup every write
}

// Flush to Gist every 20 seconds if dirty
setInterval(async () => {
  if (!_dirty || !_store || !process.env.GIST_ID || !process.env.GITHUB_TOKEN) return;
  try {
    await gistRequest('PATCH', { files: { [GIST_FILENAME]: { content: JSON.stringify(_store, null, 2) } } });
    _dirty = false;
    console.log('💾 DB saved to Gist');
  } catch (e) { console.warn('⚠️ Gist save failed:', e.message); }
}, 20000);

// Also save on shutdown
process.on('SIGTERM', async () => {
  if (_store && process.env.GIST_ID && process.env.GITHUB_TOKEN) {
    try {
      await gistRequest('PATCH', { files: { [GIST_FILENAME]: { content: JSON.stringify(_store, null, 2) } } });
      console.log('💾 DB saved to Gist on shutdown');
    } catch {}
  }
  process.exit(0);
});

module.exports = { loadAll, getStore, markDirty };
