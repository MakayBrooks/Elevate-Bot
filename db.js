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
                  },
          };
          const req = https.request(options, (res) => {
                  let raw = '';
                  res.on('data', chunk => raw += chunk);
                  res.on('end', () => {
                            if (res.statusCode < 200 || res.statusCode >= 300) {
                                        return reject(new Error(`Gist API HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
                            }
                            try { resolve(JSON.parse(raw)); }
                            catch (e) { reject(new Error('Gist API returned unparseable JSON: ' + e.message)); }
                  });
          });
          req.on('error', reject);
          req.setTimeout(15000, () => req.destroy(new Error('Gist request timed out')));
          if (bodyStr) req.write(bodyStr);
          req.end();
    });
}

let _store = null;
let _loadComplete = false;

// True only once we've CONFIRMED the real state of the Gist this session —
// either real data came back, or the Gist genuinely responded empty. A local
// fallback due to a failed load NEVER sets this true. This is the fix: before,
// a failed Gist read fell back to local (empty after a Railway redeploy),
// _startupUserCount became 0, and the old guard (currentUserCount < 0) never
// blocked anything — so any activity after a transient failure could push an
// empty store over real cloud data.
let _gistLoadSucceeded = false;

function fingerprint(store) {
    let userCount = 0, totalXP = 0, totalPoints = 0;
    const users = store?.levels?.users || {};
    for (const [uid, u] of Object.entries(users)) {
          if (!u || typeof u !== 'object') continue;
          userCount++;
          totalXP += Number(u.xp) || 0;
          totalPoints += Number(u.points) || 0;
    }
    return { userCount, totalXP, totalPoints, total: totalXP + totalPoints };
}

let _lastKnownGood = null;

async function loadAll() {
    _loadComplete = false;
    _gistLoadSucceeded = false;

  if (process.env.GIST_ID && process.env.GITHUB_TOKEN) {
        for (let attempt = 1; attempt <= 4; attempt++) {
                try {
                          console.log(`Loading DB from Gist (attempt ${attempt}/4)...`);
                          const gist = await gistRequest('GET');
                          if (!gist || !gist.files) throw new Error('Gist response missing files object');
                          const content = gist.files[GIST_FILENAME]?.content;

                  if (content && content.trim() !== '{}' && content.trim() !== '') {
                              const parsed = JSON.parse(content);
                              if (parsed && typeof parsed === 'object') {
                                            if (!parsed.levels) parsed.levels = { users: {} };
                                            if (!parsed.levels.users) parsed.levels.users = {};
                                            if (!parsed.journal) parsed.journal = {};
                                            _store = parsed;
                                            localSave(_store);
                                            _lastKnownGood = fingerprint(_store);
                                            _gistLoadSucceeded = true;
                                            _loadComplete = true;
                                            console.log(`✅ DB loaded from Gist — users: ${_lastKnownGood.userCount}, totalXP: ${_lastKnownGood.totalXP}, totalPoints: ${_lastKnownGood.totalPoints}`);
                                            return _store;
                              }
                  }

                  console.warn('⚠️  Gist reachable but empty — treating as a fresh install.');
                          _store = { levels: { users: {} }, journal: {} };
                          localSave(_store);
                          _lastKnownGood = fingerprint(_store);
                          _gistLoadSucceeded = true;
                          _loadComplete = true;
                          return _store;
                } catch (e) {
                          console.warn(`⚠️  Gist load attempt ${attempt}/4 failed: ${e.message}`);
                          if (attempt < 4) await new Promise(r => setTimeout(r, 2000 * attempt));
                }
        }
  }

  _store = localLoad();
    _loadComplete = true;

  if (process.env.GIST_ID && process.env.GITHUB_TOKEN) {
        console.error(
                '🚨 Gist unreachable after retries. Running in READ-ONLY safety mode for ' +
                'Gist syncs — local data will NOT be pushed until a successful Gist read ' +
                'happens. Existing cloud data is protected in the meantime.'
              );
  } else {
        const count = Object.keys(_store.levels?.users || {}).length;
        console.log('✅ DB loaded from local (no Gist configured), users: ' + count);
        _gistLoadSucceeded = true;
        _lastKnownGood = fingerprint(_store);
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
    if (!_gistLoadSucceeded) {
          console.warn('⚠️  Gist save blocked: never confirmed the real Gist state this session — refusing to write until a successful read happens.');
          return;
    }

  const current = fingerprint(_store);

  // SHRINK GUARD: refuse any save that looks like a wipe — partial or total —
  // regardless of what caused it. Catches the exact "all XP reset" symptom
  // even when the user COUNT doesn't drop (e.g. everyone's XP zeroed).
  if (_lastKnownGood && _lastKnownGood.userCount > 0 && process.env.FORCE_GIST_SAVE !== 'true') {
        const userDropRatio = current.userCount / _lastKnownGood.userCount;
        const totalDropRatio = _lastKnownGood.total > 0 ? current.total / _lastKnownGood.total : 1;
        if (userDropRatio < 0.5 || totalDropRatio < 0.2) {
                console.error(
                          `🚨 SAFETY BLOCK: refusing Gist save — data looks wiped.\n` +
                          `   Last known good: ${_lastKnownGood.userCount} users, ${_lastKnownGood.total} total XP+points.\n` +
                          `   Current state: ${current.userCount} users, ${current.total} total XP+points.\n` +
                          `   If this is genuinely intentional, redeploy once with FORCE_GIST_SAVE=true, then remove it.`
                        );
                return;
        }
  }

  try {
        await gistRequest('PATCH', {
                files: { [GIST_FILENAME]: { content: JSON.stringify(_store, null, 2) } },
        });
        _lastKnownGood = current;
        console.log(`💾 Saved to Gist — users: ${current.userCount}, totalXP: ${current.totalXP}, totalPoints: ${current.totalPoints}`);
  } catch (e) {
        console.warn('⚠️  Gist save failed: ' + e.message);
  }
}

// Gist sync is decoupled from activity on purpose. The old version PATCHed the
// ENTIRE database to GitHub ~500ms after every single markDirty() call — every
// chat message, every voice tick, every passive XP tick. On an active server
// that's a full JSON round-trip (upload + GitHub's echoed response) happening
// near-continuously, which is what was driving Railway egress to $40+/month.
// Now: local disk still saves instantly on every dirty flag (free — plain disk
// I/O). GitHub only gets synced on a fixed interval, and only if something
// actually changed since the last sync — so idle periods cost nothing, and
// busy periods are capped at one sync per interval no matter how much activity
// happens inside it.
const GIST_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let _pendingGistSync = false;
let _gistIntervalTimer = null;

function markDirty() {
    if (!_loadComplete) {
          // loadAll() hasn't finished — do not persist anything yet.
      console.warn('⚠️  markDirty called before loadAll() completed — skipping save.');
          return;
    }
    localSave(_store);
    _pendingGistSync = true;
}

function startGistSyncLoop() {
    if (_gistIntervalTimer) return;
    _gistIntervalTimer = setInterval(async () => {
          if (!_pendingGistSync) return; // nothing changed since last sync — skip the request, zero egress
                                         _pendingGistSync = false;
          await saveToGist().catch(() => {});
    }, GIST_SYNC_INTERVAL_MS);
}
startGistSyncLoop();

async function flushGistSync() {
    if (_gistIntervalTimer) clearInterval(_gistIntervalTimer);
    if (_pendingGistSync) {
          _pendingGistSync = false;
          await saveToGist().catch(() => {});
    }
}

process.on('SIGTERM', async () => {
    await flushGistSync();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await flushGistSync();
    process.exit(0);
});

module.exports = { loadAll, getStore, markDirty };
