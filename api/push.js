/* KomiNovel v1.12 — API pengirim Push Notification (Vercel Serverless Function)
   Env wajib di Vercel:  FIREBASE_SERVICE_ACCOUNT = isi file JSON service account (satu baris)
   Env opsional:         ADMIN_EMAILS = email1,email2  (akun Firebase yang dianggap admin) */
const admin = require('firebase-admin');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Env FIREBASE_SERVICE_ACCOUNT belum diisi di Vercel');
  const sa = JSON.parse(raw);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const FieldValue = () => admin.firestore.FieldValue;
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) && u.length <= 600) ? u : '';
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const ms = (ts) => (ts && typeof ts.toMillis === 'function') ? ts.toMillis() : 0;
const isRecent = (ts, windowMs) => { const t = ms(ts); return t > 0 && (Date.now() - t) <= windowMs; };
const fail = (status, error) => { const e = new Error(error); e.status = status; return e; };

async function isAdmin(db, uid, decoded) {
  const emails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (decoded.email && emails.includes(String(decoded.email).toLowerCase())) return true;
  const s = await db.doc('users/' + uid).get();
  const d = s.exists ? s.data() : {};
  const roles = d.roles || (d.role ? [d.role] : []);
  return roles.includes('admin') || roles.includes('owner');
}

// Tandai dokumen sudah pernah dikirim push (anti dobel / anti spam ulang)
async function claim(db, ref) {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return false;
    if (s.data().pushSentAt) return false;
    tx.update(ref, { pushSentAt: FieldValue().serverTimestamp() });
    return true;
  });
}

function previewOf(d) {
  if (d.text) return clip(d.text, 120);
  if (d.image) return '🖼️ Mengirim gambar';
  if (d.sticker) return '🎨 Mengirim stiker';
  return 'Pesan baru';
}

// ---- Penyusun pesan per jenis notifikasi ----
async function buildMessage(db, kind, body, uid, decoded) {
  const id = clip(body.id, 200);
  const workId = clip(body.workId, 200);

  if (kind === 'work') {
    if (!workId) throw fail(400, 'workId kosong');
    const ref = db.doc('works/' + workId);
    const s = await ref.get();
    if (!s.exists) throw fail(404, 'karya tidak ada');
    const w = s.data();
    if (w.status !== 'publish') throw fail(400, 'karya belum publish');
    if (w.takedown && w.takedown.active) throw fail(400, 'karya di-takedown');
    if (w.authorId !== uid && !(await isAdmin(db, uid, decoded))) throw fail(403, 'bukan pemilik karya');
    if (!(await claim(db, ref))) return null;
    const label = w.type === 'novel' ? '📖 Novel baru' : '🎨 Komik baru';
    return {
      pref: 'works', exceptUid: uid,
      data: { kind: 'work', title: clip(label + ': ' + (w.title || 'Karya'), 90), body: clip(w.teaser || ('Oleh ' + (w.authorName || 'Kreator')), 150),
              hash: 'reader/' + workId, tag: 'work-' + workId, image: safeUrl(w.coverURL) }
    };
  }

  if (kind === 'chapter') {
    const chapterId = clip(body.chapterId, 200);
    if (!workId || !chapterId) throw fail(400, 'workId/chapterId kosong');
    const wRef = db.doc('works/' + workId);
    const cRef = db.doc('works/' + workId + '/chapters/' + chapterId);
    const [ws, cs] = await Promise.all([wRef.get(), cRef.get()]);
    if (!ws.exists || !cs.exists) throw fail(404, 'karya/chapter tidak ada');
    const w = ws.data(), c = cs.data();
    if (w.status !== 'publish') throw fail(400, 'karya belum publish');
    if (w.takedown && w.takedown.active) throw fail(400, 'karya di-takedown');
    if (!isRecent(c.createdAt, 15 * 60 * 1000)) throw fail(400, 'chapter bukan baru');
    if (w.authorId !== uid && !(await isAdmin(db, uid, decoded))) throw fail(403, 'bukan pemilik karya');
    if (!(await claim(db, cRef))) return null;
    const label = w.type === 'novel' ? 'Chapter' : 'Episode';
    return {
      pref: 'works', exceptUid: uid,
      data: { kind: 'chapter', title: clip('🆕 ' + label + ' baru: ' + (w.title || 'Karya'), 90),
              body: clip(label + ' ' + c.number + (c.title ? ' • ' + c.title : ''), 150),
              hash: 'reader/' + workId + '/' + chapterId, tag: 'chapter-' + workId, image: safeUrl(w.coverURL) }
    };
  }

  if (kind === 'berita') {
    if (!id) throw fail(400, 'id kosong');
    const ref = db.doc('berita/' + id);
    const s = await ref.get();
    if (!s.exists) throw fail(404, 'berita tidak ada');
    const b = s.data();
    if (!isRecent(b.createdAt, 15 * 60 * 1000)) throw fail(400, 'berita bukan baru');
    if (b.authorId !== uid && !(await isAdmin(db, uid, decoded))) throw fail(403, 'bukan pembuat berita');
    if (!(await claim(db, ref))) return null;
    return {
      pref: 'berita', exceptUid: uid,
      data: { kind: 'berita', title: clip('📰 ' + (b.title || 'Berita baru'), 90), body: clip(b.content, 150),
              hash: 'berita', tag: 'berita-' + id, image: safeUrl(b.image) }
    };
  }

  if (kind === 'chat') {
    if (!id) throw fail(400, 'id kosong');
    const ref = db.doc('chats/' + id);
    const s = await ref.get();
    if (!s.exists) throw fail(404, 'pesan tidak ada');
    const m = s.data();
    if (m.userId !== uid) throw fail(403, 'bukan pengirim pesan');
    if (!isRecent(m.createdAt, 2 * 60 * 1000)) throw fail(400, 'pesan sudah lama');
    if (!(await claim(db, ref))) return null;
    return {
      pref: 'chat', exceptUid: uid, ttl: '3600',
      data: { kind: 'chat', title: clip('💬 ' + (m.username || 'Chat Publik'), 70), body: previewOf(m),
              hash: 'chat', tag: 'chat-public', icon: safeUrl(m.photoURL) }
    };
  }

  if (kind === 'clan') {
    const clanId = clip(body.clanId, 200);
    if (!clanId || !id) throw fail(400, 'clanId/id kosong');
    const clanSnap = await db.doc('clans/' + clanId).get();
    if (!clanSnap.exists) throw fail(404, 'clan tidak ada');
    const clan = clanSnap.data();
    const members = Array.isArray(clan.members) ? clan.members : [];
    if (!members.includes(uid)) throw fail(403, 'bukan member clan');
    const ref = db.doc('clans/' + clanId + '/messages/' + id);
    const s = await ref.get();
    if (!s.exists) throw fail(404, 'pesan tidak ada');
    const m = s.data();
    if (m.userId !== uid) throw fail(403, 'bukan pengirim pesan');
    if (!isRecent(m.createdAt, 2 * 60 * 1000)) throw fail(400, 'pesan sudah lama');
    if (!(await claim(db, ref))) return null;
    return {
      pref: 'clan', exceptUid: uid, onlyUids: members, ttl: '3600',
      data: { kind: 'clan', title: clip('🛡️ ' + (clan.name || 'Clan') + ' • ' + (m.username || 'Member'), 80), body: previewOf(m),
              hash: 'clan/' + clanId, tag: 'clan-' + clanId, clanId, icon: safeUrl(m.photoURL) }
    };
  }

  if (kind === 'dm') {
    const chatId = clip(body.chatId, 300);
    if (!chatId || !id) throw fail(400, 'chatId/id kosong');
    const chatSnap = await db.doc('privateChats/' + chatId).get();
    if (!chatSnap.exists) throw fail(404, 'chat tidak ada');
    const parts = Array.isArray(chatSnap.data().participants) ? chatSnap.data().participants : [];
    if (!parts.includes(uid)) throw fail(403, 'bukan peserta chat');
    const others = parts.filter(p => p !== uid);
    if (!others.length) throw fail(400, 'penerima tidak ada');
    const ref = db.doc('privateChats/' + chatId + '/messages/' + id);
    const s = await ref.get();
    if (!s.exists) throw fail(404, 'pesan tidak ada');
    const m = s.data();
    if (m.userId !== uid) throw fail(403, 'bukan pengirim pesan');
    if (!isRecent(m.createdAt, 2 * 60 * 1000)) throw fail(400, 'pesan sudah lama');
    if (!(await claim(db, ref))) return null;
    return {
      pref: 'dm', exceptUid: uid, onlyUids: others, ttl: '3600',
      data: { kind: 'dm', title: clip('✉️ ' + (m.username || 'Pesan baru'), 70), body: previewOf(m),
              hash: 'privatechat/' + uid, tag: 'dm-' + uid, fromUid: uid, icon: safeUrl(m.photoURL) }
    };
  }

  throw fail(400, 'kind tidak dikenal');
}

// ---- Ambil token tujuan ----
async function getTargets(db, { pref, exceptUid, onlyUids }) {
  const col = db.collection('fcmTokens');
  let docs = [];
  if (onlyUids) {
    for (const part of chunks([...new Set(onlyUids.filter(Boolean))], 30)) {
      const snap = await col.where('uid', 'in', part).get();
      docs = docs.concat(snap.docs);
    }
  } else {
    const snap = await col.where('prefs.' + pref, '==', true).get();
    docs = snap.docs;
  }
  const seen = new Set();
  const out = [];
  for (const d of docs) {
    const x = d.data() || {};
    const token = x.token || d.id;
    if (!token || seen.has(token)) continue;
    if (exceptUid && x.uid === exceptUid) continue;
    if (x.prefs && x.prefs[pref] === false) continue;
    seen.add(token);
    out.push({ token, ref: d.ref });
  }
  return out;
}

async function sendAll(db, targets, data, ttl) {
  const payloadData = {};
  Object.keys(data).forEach(k => { payloadData[k] = String(data[k] == null ? '' : data[k]); });
  payloadData.url = '/#' + payloadData.hash;
  let sent = 0, failed = 0;
  const dead = [];
  for (const part of chunks(targets, 500)) {
    const resp = await admin.messaging().sendEachForMulticast({
      tokens: part.map(t => t.token),
      data: payloadData,
      webpush: { headers: { Urgency: 'high', TTL: ttl || '86400' } }
    });
    resp.responses.forEach((r, i) => {
      if (r.success) { sent++; return; }
      failed++;
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.push(part[i].ref);
    });
  }
  for (const part of chunks(dead, 400)) {
    const batch = db.batch();
    part.forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  return { sent, failed, removed: dead.length };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Gunakan POST' });

  try {
    init();
    const db = admin.firestore();
    const h = req.headers.authorization || '';
    const idToken = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!idToken) throw fail(401, 'Token login tidak ada');
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (e) { throw fail(401, 'Token login tidak valid'); }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    const msg = await buildMessage(db, String(body.kind || ''), body, decoded.uid, decoded);
    if (!msg) return res.status(200).json({ ok: true, skipped: 'sudah pernah dikirim' });

    const targets = await getTargets(db, msg);
    if (!targets.length) return res.status(200).json({ ok: true, sent: 0, note: 'belum ada device terdaftar' });
    const result = await sendAll(db, targets, msg.data, msg.ttl);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('push error:', e);
    return res.status(status).json({ error: e.message || 'error' });
  }
};
