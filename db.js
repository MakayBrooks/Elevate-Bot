/**
 * Persistent database using GitHub Gist as storage backend.
 * Data survives Railway redeploys, file changes, everything.
 * 
 * Requires: GIST_ID and GITHUB_TOKEN env vars in Railway.
 * Falls back to local JSON if not configured.
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
      fs.writeFileSync(LOCAL_PATH, JSON.stringify({}));
    }
    return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
  } catch { return {}; }
}

function localSave(data) {
  try {
    fs.mkdirSync(path.dirname(LOCAL_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
  } catch (e) { console.error('Local save error:', e); }
}

function gistRequest(method, data = null) {
  return new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN;
    const gistId = process.env.GIST_ID;
    if (!token || !gistId) return reject(new Error('No GIST_ID or GITHUB_TOKEN'));

    const body = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'api.github.com',
      path: `/gists/${gistId}`,
      method,
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'elevate-bot',
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      }
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// In-memory cache so we don't hammer the API
let cache = null;
let dirty = false;

async function load() {
  if (cache) return cache;

  // Try Gist first
  if (process.env.GIST_ID && process.env.GITHUB_TOKEN) {
    try {
      const gist = await gistRequest('GET');
      const content = gist?.files?.[GIST_FILENAME]?.content;
      if (content) {
        cache = JSON.parse(content);
        localSave(cache); // keep local copy in sync
        console.log('✅ DB loaded from Gist');
        return cache;
      }
    } catch (e) {
      console.warn('⚠️  Gist load failed, falling back to local:', e.message);
    }
  }

  // Fall back to local
  cache = localLoad();
  console.log('📁 DB loaded from local file');
  return cache;
}

async function save(data) {
  cache = data;
  localSave(data); // always save locally immediately

  // Push to Gist if configured
  if (process.env.GIST_ID && process.env.GITHUB_TOKEN) {
    dirty = true;
  }
}

// Flush to Gist every 30 seconds if dirty (batches writes)
setInterval(async () => {
  if (!dirty || !cache) return;
  try {
    await gistRequest('PATCH', {
      files: {
        [GIST_FILENAME]: { content: JSON.stringify(cache, null, 2) }
      }
    });
    dirty = false;
  } catch (e) {
    console.warn('⚠️  Gist save failed:', e.message);
  }
}, 30000);

// Also flush on process exit
process.on('SIGTERM', async () => {
  if (dirty && cache && process.env.GIST_ID && process.env.GITHUB_TOKEN) {
    try {
      await gistRequest('PATCH', {
        files: { [GIST_FILENAME]: { content: JSON.stringify(cache, null, 2) } }
      });
    } catch {}
  }
  process.exit(0);
});

module.exports = { load, save };
