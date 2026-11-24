const express = require('express');
const crypto = require('crypto');
const EMPLOYEES = require('./employees');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const rooms = {}; // code -> room (in-memory)

// ---------- helpers ----------
function findEmployee(email) {
  const e = String(email || '').trim().toLowerCase();
  for (const group of ['remote', 'office']) {
    const hit = EMPLOYEES[group].find(p => p.email.toLowerCase() === e);
    if (hit) return { name: hit.name, email: e, group };
  }
  return null;
}

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function addParticipant(room, emp) {
  const token = crypto.randomBytes(16).toString('hex');
  const id = crypto.randomBytes(4).toString('hex');
  room.participants.set(token, { ...emp, id, token, target: null, revealed: false });
  room.emails.add(emp.email);
  return token;
}

// One shuffled cycle per group: nobody gets themselves,
// and every person is picked by exactly one other person.
function assign(room) {
  for (const g of ['remote', 'office']) {
    const list = shuffle([...room.participants.values()].filter(p => p.group === g));
    list.forEach((p, i) => { p.target = list[(i + 1) % list.length]; });
  }
}

function getRoom(req, res) {
  const room = rooms[String(req.params.code).toUpperCase()];
  if (!room) { res.status(404).json({ error: 'Room not found' }); return null; }
  return room;
}

// ---------- routes ----------
// Admin creates a room (admin email must be in predefined list)
app.post('/api/rooms', (req, res) => {
  const emp = findEmployee(req.body.email);
  if (!emp) return res.status(403).json({ error: 'This email is not on the invite list' });
  const code = newCode();
  const room = { code, status: 'lobby', createdAt: Date.now(), participants: new Map(), emails: new Set(), adminToken: null };
  room.adminToken = addParticipant(room, emp);
  rooms[code] = room;
  res.json({ code, token: room.adminToken });
});

// Participant joins with code + email (auto-verified, group auto-detected)
app.post('/api/rooms/:code/join', (req, res) => {
  const room = getRoom(req, res); if (!room) return;
  if (room.status !== 'lobby') return res.status(400).json({ error: 'Game already started' });
  const emp = findEmployee(req.body.email);
  if (!emp) return res.status(403).json({ error: 'This email is not on the invite list' });
  if (room.emails.has(emp.email)) return res.status(409).json({ error: 'This email has already joined' });
  const token = addParticipant(room, emp);
  res.json({ code: room.code, token });
});

// Poll state (everyone only ever sees their own info)
app.get('/api/rooms/:code/state', (req, res) => {
  const room = getRoom(req, res); if (!room) return;
  const me = room.participants.get(req.query.token);
  if (!me) return res.status(401).json({ error: 'Invalid session' });
  const isAdmin = me.token === room.adminToken;
  const all = [...room.participants.values()];

  const out = {
    status: room.status,
    code: room.code,
    me: { name: me.name, group: me.group, isAdmin, revealed: me.revealed },
    participants: all.map(p => ({ name: p.name, group: p.group })),
  };
  // Admin sees who has opened their Secret Santa (NOT who got whom)
  if (isAdmin && room.status === 'started') {
    out.progress = all.map(p => ({ id: p.id, name: p.name, group: p.group, revealed: p.revealed }));
  }
  res.json(out);
});

// Admin starts the game
app.post('/api/rooms/:code/start', (req, res) => {
  const room = getRoom(req, res); if (!room) return;
  if (req.body.token !== room.adminToken) return res.status(403).json({ error: 'Only admin can start' });
  if (room.status !== 'lobby') return res.status(400).json({ error: 'Already started' });

  const all = [...room.participants.values()];
  for (const g of ['remote', 'office']) {
    const n = all.filter(p => p.group === g).length;
    if (n === 1) return res.status(400).json({ error: `Only 1 ${g} person joined. Each group needs at least 2 people.` });
  }
  if (all.length < 2) return res.status(400).json({ error: 'Need at least 2 participants' });

  assign(room);
  room.status = 'started';
  res.json({ ok: true });
});

// One-time reveal: name is returned only once, until admin resets it
app.post('/api/rooms/:code/reveal', (req, res) => {
  const room = getRoom(req, res); if (!room) return;
  const me = room.participants.get(req.body.token);
  if (!me) return res.status(401).json({ error: 'Invalid session' });
  if (room.status !== 'started') return res.status(400).json({ error: 'Game not started' });
  if (me.revealed) return res.json({ already: true });

  me.revealed = true; // set BEFORE responding -> can never be fetched again
  const decoys = [...room.participants.values()]
    .filter(p => p.group === me.group && p !== me && p !== me.target)
    .map(p => p.name);
  res.json({ name: me.target.name, group: me.group, decoys });
});

// Admin recovery: lets one participant open their gift again (admin never sees the name)
app.post('/api/rooms/:code/reset', (req, res) => {
  const room = getRoom(req, res); if (!room) return;
  if (req.body.token !== room.adminToken) return res.status(403).json({ error: 'Only admin can reset' });
  if (room.status !== 'started') return res.status(400).json({ error: 'Game not started' });
  const person = [...room.participants.values()].find(p => p.id === req.body.id);
  if (!person) return res.status(404).json({ error: 'Participant not found' });
  person.revealed = false;
  res.json({ ok: true });
});

// Clean up rooms older than 24h
setInterval(() => {
  const now = Date.now();
  for (const c in rooms) if (now - (rooms[c].createdAt || now) > 864e5) delete rooms[c];
}, 36e5);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎅 Secret Santa running on http://localhost:${PORT}`));