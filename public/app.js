const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wait = ms => new Promise(r => setTimeout(r, ms));
let session = JSON.parse(localStorage.getItem('ss') || 'null');
let mode = 'join', revealing = false, view = '';

/* ---------- decoration ---------- */
for (let i = 0; i < 45; i++) {
  const s = document.createElement('div');
  s.className = 'snow'; s.textContent = '❄';
  s.style.left = Math.random()*100 + 'vw';
  s.style.fontSize = (10 + Math.random()*18) + 'px';
  s.style.opacity = .4 + Math.random()*.5;
  s.style.animationDuration = (6 + Math.random()*10) + 's';
  s.style.animationDelay = (-Math.random()*12) + 's';
  s.style.animationIterationCount = 'infinite';
  document.body.appendChild(s);
}
function confetti() {
  const items = ['🎉','🎄','⭐','🎁','❄️','✨'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('div');
    c.className = 'confetti'; c.textContent = items[i % items.length];
    c.style.left = Math.random()*100 + 'vw';
    c.style.fontSize = (16 + Math.random()*20) + 'px';
    c.style.animationDuration = (2 + Math.random()*3) + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 5500);
  }
}

/* ---------- api ---------- */
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: {'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
function show(id) {
  ['home','lobby','game'].forEach(v => $('#'+v).classList.toggle('hidden', v !== id));
  $('#leave').classList.toggle('hidden', id === 'home');
}
function err(id, msg) { const e = $(id); e.textContent = msg; e.classList.toggle('hidden', !msg); }

/* ---------- home ---------- */
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  mode = t.dataset.tab;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  $('#code').classList.toggle('hidden', mode === 'create');
  $('#homeBtn').textContent = mode === 'create' ? 'Create Room 🎄' : 'Join the fun 🎁';
  err('#homeErr', '');
});
$('#homeBtn').onclick = async () => {
  err('#homeErr', '');
  const email = $('#email').value.trim();
  try {
    const d = mode === 'create'
      ? await api('/rooms', 'POST', { email })
      : await api(`/rooms/${$('#code').value.trim().toUpperCase()}/join`, 'POST', { email });
    session = { code: d.code, token: d.token };
    localStorage.setItem('ss', JSON.stringify(session));
    poll();
  } catch (e) { err('#homeErr', e.message); }
};
$('#leave').onclick = leave;
function leave() { localStorage.removeItem('ss'); location.reload(); }
$('#roomCode').onclick = () => { navigator.clipboard?.writeText(session.code); $('#roomCode').style.opacity = .6; setTimeout(()=>$('#roomCode').style.opacity=1, 300); };

/* ---------- lobby ---------- */
$('#startBtn').onclick = async () => {
  err('#lobbyErr', '');
  try { await api(`/rooms/${session.code}/start`, 'POST', { token: session.token }); poll(); }
  catch (e) { err('#lobbyErr', e.message); }
};
function renderLobby(s) {
  show('lobby');
  $('#roomCode').textContent = s.code;
  const chips = g => s.participants.filter(p => p.group === g).map(p => `<span class="chip">${esc(p.name)}</span>`).join('');
  $('#remoteChips').innerHTML = chips('remote'); $('#officeChips').innerHTML = chips('office');
  $('#rc').textContent = s.participants.filter(p => p.group === 'remote').length;
  $('#oc').textContent = s.participants.filter(p => p.group === 'office').length;
  $('#startBtn').classList.toggle('hidden', !s.me.isAdmin);
  $('#startBtn').disabled = s.participants.length < 2;
  $('#waitMsg').classList.toggle('hidden', s.me.isAdmin);
}

/* ---------- game ---------- */
const GIFT_HTML = `<div class="gift" id="gift" style="cursor:pointer">🎁</div><p><b>Tap the gift to open!</b></p>`;
const DONE_HTML = `<div class="gift" style="animation:none">🎁</div><p>You've already opened your gift.<br>Keep it a secret! 🤫</p>`;

function setView(v, html) {
  if (view === v) return;          // don't redraw every poll
  view = v;
  $('#stage').innerHTML = html;
}

function renderGame(s) {
  show('game');
  $('#hello').textContent = `Hi ${s.me.name}! 🎅`;

  // Admin table: only exists for admin
  if (s.progress) {
    $('#adminBox').classList.remove('hidden');
    $('#progress').innerHTML = s.progress.map(p =>
      `<tr><td>${esc(p.name)}</td><td>${p.group === 'remote' ? '🏡' : '🏢'}</td><td>${p.revealed
        ? `✅ Opened <button data-reset="${esc(p.id)}" style="margin-left:6px;padding:3px 8px;border:0;border-radius:8px;cursor:pointer;background:rgba(255,255,255,.25);color:#fff;font-family:inherit">↺ Reset</button>`
        : '⏳ Waiting'}</td></tr>`).join('');
  } else {
    $('#adminBox')?.remove();      // non-admin: removed from page completely
  }

  if (revealing) return;
  if (!s.me.revealed) setView('gift', GIFT_HTML);   // waiting for click (also after admin reset)
  else if (view !== 'name') setView('done', DONE_HTML);
}

// Admin recovery: let a participant open their gift again
$('#progress').onclick = async e => {
  const id = e.target.dataset.reset;
  if (!id) return;
  if (!confirm('Let this person open their gift again?')) return;
  try {
    await api(`/rooms/${session.code}/reset`, 'POST', { token: session.token, id });
    poll();
  } catch (er) { alert(er.message); }
};

// Click on gift -> reveal
$('#stage').onclick = e => {
  if (e.target.closest('#gift') && view === 'gift' && !revealing) openGift();
};

async function openGift() {
  revealing = true;
  let data;
  try { data = await api(`/rooms/${session.code}/reveal`, 'POST', { token: session.token }); }
  catch (e) { revealing = false; return; }
  if (data.already) { revealing = false; return; }

  $('#gift').classList.add('open');
  await wait(600);
  $('#stage').innerHTML = `<p>🎄 You are Secret Santa for…</p><div class="slot" id="slot">?</div>`;
  await spin(data.name, data.decoys);
  $('#slot').classList.add('final');
  confetti();
  $('#stage').insertAdjacentHTML('beforeend',
    `<p style="margin-top:16px">🤫 Shhh! Don't tell anyone.<br><small>This name is shown only once.</small></p>`);
  view = 'name';
  revealing = false;
}

function spin(finalName, decoys) {
  return new Promise(resolve => {
    const el = $('#slot'), pool = decoys.length ? decoys : [finalName];
    let i = 0, delay = 60;
    (function tick() {
      if (delay > 420) { el.textContent = finalName; return resolve(); }
      el.textContent = pool[i++ % pool.length];
      delay *= 1.12; setTimeout(tick, delay);
    })();
  });
}

/* ---------- polling ---------- */
async function poll() {
  if (!session) return;
  try {
    const s = await api(`/rooms/${session.code}/state?token=${session.token}`);
    s.status === 'lobby' ? renderLobby(s) : renderGame(s);
  } catch (e) {
    if (/not found|Invalid session/i.test(e.message)) leave();
  }
}
if (session) poll(); else show('home');
setInterval(poll, 2000);
$('#code').classList.remove('hidden');