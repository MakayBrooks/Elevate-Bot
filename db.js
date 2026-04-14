/**
 * Persistent database using GitHub Gist.
 * Stores levels and journal data in separate keys.
 * Survives Railway redeploys forever.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const LOCAL_PATH = path.join(__dirname, 'data', 'db.json');
const GIST_FILENAME = 'elevate-bot-db.json';

function localLoad() {
  try {
    if (!fs.existsSync(LOCAL_PATH)) {
      fs.mkdirSync(path.dirname(LOCAL_PATH), { recursive: true });
      fs.writeFileSync(LOCAL_PATH, JSON.stringify({ levels: {}, journal: {} }));
    }
    const data = JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
    if (!data.levels) data.levels = {};
    if (!data.journal) data.journal = {};
    return data;
  } catch { return { levels: {}, journal: {} }; }
}

function localSave(data) {
  try {
    fs.mkdirSync(path.dirname(LOCAL_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
  } catch (e) { console.error('Local save error:', e); }
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

// Single in-memory store with levels and journal namespaced
let _store = null;
let _dirty = false;

async function loadAll() {
  if (_store) return _store;

  if (process.env.GIST_ID && process.env.GITHUB_TOKEN) {
    try {
      const gist = await gistRequest('GET');
      const content = gist?.files?.[GIST_FILENAME]?.content;
      if (content) {
        const parsed = JSON.parse(content);
        if (parsed.levels || parsed.journal) {
          _store = parsed;
          if (!_store.levels) _store.levels = {};
          if (!_store.journal) _store.journal = {};
          localSave(_store);
          console.log('✅ DB loaded from Gist');
          return _store;
        }
      }
    } catch (e) {
      console.warn('⚠️  Gist load failed, using local:', e.message);
    }
  }

  _store = localLoad();
  console.log('📁 DB loaded from local file');
  return _store;
}

function getStore() { return _store || { levels: {}, journal: {} }; }

function markDirty() {
  _dirty = true;
  localSave(_store); // immediate local backup
}

// Flush to Gist every 30 seconds
setInterval(async () => {
  if (!_dirty || !_store) return;
  if (!process.env.GIST_ID || !process.env.GITHUB_TOKEN) return;
  try {
    await gistRequest('PATCH', {
      files: { [GIST_FILENAME]: { content: JSON.stringify(_store, null, 2) } }
    });
    _dirty = false;
    console.log('💾 DB saved to Gist');
  } catch (e) { console.warn('⚠️  Gist save failed:', e.message); }
}, 30000);

process.on('SIGTERM', async () => {
  if (_dirty && _store && process.env.GIST_ID && process.env.GITHUB_TOKEN) {
    try {
      await gistRequest('PATCH', {
        files: { [GIST_FILENAME]: { content: JSON.stringify(_store, null, 2) } }
      });
    } catch {}
  }
  process.exit(0);
});

module.exports = { loadAll, getStore, markDirty };
