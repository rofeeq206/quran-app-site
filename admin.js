// Admin dashboard (/admin): sign in with Supabase Auth, then read, triage and delete
// feedback and see simple stats. Access is enforced by the database (is_admin() in
// supabase/migrations), not by this page: other accounts get no rows back.
// Everything visitors wrote is shown with textContent, never as HTML.

const SUPABASE_URL = 'https://phqhwmggpeowmjjxjswk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_vfUCb4zw9VyzyupMuOo1uA_mliCLNTo';
const BUCKET = 'feedback-screenshots';
const RELEASES_API = 'https://api.github.com/repos/rofeeq206/quran-app-site/releases?per_page=100';

// The emailed set-password link lands here with #...type=recovery; note it before the
// client reads (and clears) the URL.
let fromEmailLink = /type=(recovery|invite)/.test(location.hash);

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, detectSessionInUrl: true, flowType: 'implicit' },
});

const $ = (id) => document.getElementById(id);
const views = ['signin', 'setpw', 'dash'];
let rows = [];
let shotUrls = new Map();

const KIND = { bug: 'Bug', idea: 'Idea', other: 'Other' };
const STORE = { apk: 'Website APK', play: 'Google Play', appstore: 'App Store' };
const STATUS = { new: 'New', in_progress: 'In progress', done: 'Done' };
const ICON = {
  bug: 'M12 2a4 4 0 0 1 4 4v1h1.5l2-2 1.4 1.4-2 2V10h3v2h-3v1.5l2.5 2.5-1.4 1.4-1.6-1.6A6 6 0 0 1 6.6 15.8L5 17.4 3.6 16 6 13.5V12H3v-2h3V8.4l-2-2L5.5 5l2 2H8V6a4 4 0 0 1 4-4Z',
  idea: 'M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2Zm-3 18h6v1a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-1Z',
  other: 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2Z',
};

/** Small DOM helper: el('p', { className: 'x', textContent: '...' }, child, ...) */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('aria-') || k === 'role') node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function svgIcon(path) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

function show(view) {
  views.forEach((v) => ($(v).hidden = v !== view));
  $('account').hidden = view !== 'dash';
}

function setStatus(id, text, isError = false) {
  $(id).textContent = text;
  $(id).classList.toggle('is-error', isError);
}

const fmtDate = (d) =>
  new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtNum = (n) => n.toLocaleString('en-GB');

// ───────────── Auth ─────────────

async function route(session) {
  if (fromEmailLink && session) return show('setpw');
  if (!session) return show('signin');
  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error || !isAdmin) {
    await sb.auth.signOut();
    show('signin');
    return setStatus('signin-status', 'This account does not have admin access.', true);
  }
  $('who').textContent = session.user.email;
  show('dash');
  loadAll();
}

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') show('setpw');
  if (event === 'SIGNED_OUT') show('signin');
  void session;
});

$('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  setStatus('signin-status', 'Signing in…');
  const { data, error } = await sb.auth.signInWithPassword({
    email: String(f.get('email')).trim(),
    password: String(f.get('password')),
  });
  if (error) return setStatus('signin-status', 'Email or password is wrong.', true);
  setStatus('signin-status', '');
  route(data.session);
});

$('forgot').addEventListener('click', async () => {
  const email = String($('signin-form').email.value).trim();
  if (!email) return setStatus('signin-status', 'Enter your email first, then tap “Forgot password?”.', true);
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin` });
  setStatus(
    'signin-status',
    error ? `Couldn't send the email: ${error.message}` : 'If that email has an admin account, a link to set a new password is on its way.',
    Boolean(error),
  );
});

$('setpw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const password = String(f.get('password'));
  if (password.length < 10) return setStatus('setpw-status', 'Use at least 10 characters.', true);
  if (password !== String(f.get('confirm'))) return setStatus('setpw-status', 'The two passwords are different.', true);
  setStatus('setpw-status', 'Saving…');
  const { error } = await sb.auth.updateUser({ password });
  if (error) return setStatus('setpw-status', `Couldn't save it: ${error.message}`, true);
  history.replaceState(null, '', location.pathname);
  setStatus('setpw-status', '');
  fromEmailLink = false;
  const { data } = await sb.auth.getSession();
  route(data.session);
});

$('sign-out').addEventListener('click', () => sb.auth.signOut());
$('refresh').addEventListener('click', () => loadAll());

// ───────────── Data ─────────────

async function loadAll() {
  $('refresh').disabled = true;
  setStatus('dash-status', 'Loading…');
  const [fb] = await Promise.all([loadFeedback(), loadApk()]);
  $('refresh').disabled = false;
  if (fb) setStatus('dash-status', '');
}

async function loadFeedback() {
  const { data, error } = await sb.from('feedback').select('*').order('created_at', { ascending: false }).limit(2000);
  if (error) {
    setStatus('dash-status', `Couldn't load feedback: ${error.message}`, true);
    return false;
  }
  rows = data;
  const paths = rows.flatMap((r) => r.screenshots || []);
  shotUrls = new Map();
  if (paths.length) {
    const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    (signed || []).forEach((s) => s.signedUrl && shotUrls.set(s.path, s.signedUrl));
  }
  renderFeedbackStats();
  renderItems();
  return true;
}

async function loadApk() {
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(res.status);
    const releases = (await res.json())
      .filter((r) => !r.draft)
      .map((r) => ({
        name: r.tag_name,
        date: new Date(r.published_at),
        count: r.assets.filter((a) => a.name.endsWith('.apk')).reduce((s, a) => s + a.download_count, 0),
      }))
      .sort((a, b) => a.date - b.date);
    const total = releases.reduce((s, r) => s + r.count, 0);
    $('t-apk').textContent = fmtNum(total);
    const latest = releases.at(-1);
    $('t-apk-sub').textContent = latest ? `${latest.name}: ${fmtNum(latest.count)}` : '';
    const recent = releases.slice(-12);
    bars(
      'c-apk',
      recent.map((r) => ({ label: r.name.replace(/^v/, ''), value: r.count, tip: `${r.name}: ${fmtNum(r.count)} downloads` })),
      recent.length ? [recent[0].name, recent.at(-1).name] : [],
    );
    table('tb-apk', ['Release', 'Published', 'Downloads'], recent.slice().reverse().map((r) => [r.name, fmtDay(r.date), fmtNum(r.count)]));
  } catch {
    $('t-apk').textContent = '–';
    $('t-apk-sub').textContent = 'GitHub unavailable, try Refresh later';
  }
}

// ───────────── Stats ─────────────

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

function renderFeedbackStats() {
  const now = Date.now();
  const week = rows.filter((r) => now - new Date(r.created_at) < 7 * 864e5).length;
  const open = rows.filter((r) => r.status !== 'done').length;
  $('t-total').textContent = fmtNum(rows.length);
  $('t-total-sub').textContent = `${fmtNum(open)} open`;
  $('t-new').textContent = fmtNum(rows.filter((r) => r.status === 'new').length);
  $('t-week').textContent = fmtNum(week);
  $('t-week-sub').textContent = rows[0] ? `latest ${fmtDay(new Date(rows[0].created_at))}` : 'none yet';

  const first = startOfWeek(new Date(now - 11 * 7 * 864e5));
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = new Date(first);
    start.setDate(first.getDate() + i * 7);
    return { start, value: 0 };
  });
  rows.forEach((r) => {
    const i = Math.floor((startOfWeek(new Date(r.created_at)) - first) / (7 * 864e5) + 0.5);
    if (i >= 0 && i < 12) weeks[i].value++;
  });
  bars(
    'c-weeks',
    weeks.map((w) => ({ label: fmtDay(w.start), value: w.value, tip: `Week of ${fmtDay(w.start)}: ${w.value}` })),
    [fmtDay(weeks[0].start), 'This week'],
  );
  table('tb-weeks', ['Week of', 'Feedback'], weeks.slice().reverse().map((w) => [fmtDay(w.start), String(w.value)]));

  breakdown('b-kind', count(rows, (r) => KIND[r.kind] || r.kind));
  breakdown('b-store', count(rows, (r) => STORE[r.store] || 'Not recorded (older builds)'));
  breakdown('b-version', count(rows, (r) => r.app_version || 'Unknown'), 6);
}

function count(list, keyOf) {
  const m = new Map();
  list.forEach((r) => m.set(keyOf(r), (m.get(keyOf(r)) || 0) + 1));
  return [...m].sort((a, b) => b[1] - a[1]);
}

function breakdown(id, entries, limit = 10) {
  const ul = $(id);
  ul.replaceChildren();
  if (!entries.length) return ul.append(el('li', { className: 'empty', textContent: 'No feedback yet' }));
  const max = entries[0][1];
  let shown = entries.slice(0, limit);
  const rest = entries.slice(limit).reduce((s, e) => s + e[1], 0);
  if (rest) shown = [...shown, ['Other versions', rest]];
  shown.forEach(([label, n]) => {
    const meter = el('span', { className: 'meter', 'aria-hidden': 'true' }, el('i'));
    meter.firstChild.style.width = `${(n / max) * 100}%`;
    ul.append(el('li', {}, el('span', { textContent: label }), el('b', { textContent: fmtNum(n) }), meter));
  });
}

function bars(id, data, axis) {
  const box = $(id);
  box.replaceChildren();
  const max = Math.max(1, ...data.map((d) => d.value));
  data.forEach((d) => {
    const bar = el('div', { className: `ad-bar${d.value ? '' : ' is-zero'}`, tabIndex: 0, role: 'img', 'aria-label': d.tip });
    const fill = el('i');
    fill.style.height = `${(d.value / max) * 100}%`;
    bar.append(fill, el('span', { className: 'tip', textContent: d.tip }));
    box.append(bar);
  });
  const next = box.nextElementSibling;
  if (next && next.classList.contains('ad-axis')) next.remove();
  if (axis.length) box.after(el('div', { className: 'ad-axis', 'aria-hidden': 'true' }, el('span', { textContent: axis[0] }), el('span', { textContent: axis[1] })));
}

function table(id, head, body) {
  const t = $(id);
  t.replaceChildren(
    el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { textContent: h })))),
    el('tbody', {}, ...body.map((r) => el('tr', {}, ...r.map((c) => el('td', { textContent: c }))))),
  );
}

// ───────────── Feedback list ─────────────

const filters = () => ({
  status: document.querySelector('input[name="fstatus"]:checked').value,
  kind: $('f-kind').value,
  q: $('f-search').value.trim().toLowerCase(),
});
document.querySelectorAll('input[name="fstatus"]').forEach((i) => i.addEventListener('change', renderItems));
$('f-kind').addEventListener('change', renderItems);
$('f-search').addEventListener('input', renderItems);

function renderItems() {
  const f = filters();
  const list = rows.filter(
    (r) =>
      (f.status === 'all' || (f.status === 'open' ? r.status !== 'done' : r.status === f.status)) &&
      (f.kind === 'all' || r.kind === f.kind) &&
      (!f.q || [r.message, r.name, r.email, r.device, r.app_version].some((v) => v && v.toLowerCase().includes(f.q))),
  );
  $('f-count').textContent = `${fmtNum(list.length)} of ${fmtNum(rows.length)}`;
  const ul = $('items');
  ul.replaceChildren();
  if (!list.length) return ul.append(el('li', { className: 'ad-empty', textContent: rows.length ? 'Nothing matches these filters.' : 'No feedback yet.' }));
  list.forEach((r) => ul.append(item(r)));
}

function item(r) {
  const li = el('li', { className: `ad-item${r.status === 'new' ? ' is-new' : ''}` });

  const badge = el('span', { className: `ad-badge ${r.kind}` }, svgIcon(ICON[r.kind] || ICON.other), KIND[r.kind] || r.kind);
  const meta = [fmtDate(r.created_at), STORE[r.store], r.app_version && `v${r.app_version}`].filter(Boolean).join(' · ');
  const select = el('select', { 'aria-label': 'Status' }, ...Object.entries(STATUS).map(([v, t]) => el('option', { value: v, textContent: t, selected: r.status === v })));
  select.addEventListener('change', async () => {
    const { error } = await sb.from('feedback').update({ status: select.value }).eq('id', r.id);
    if (error) {
      select.value = r.status;
      return alert(`Couldn't change the status: ${error.message}`);
    }
    r.status = select.value;
    li.classList.toggle('is-new', r.status === 'new');
    renderFeedbackStats();
  });
  li.append(el('div', { className: 'ad-item-top' }, badge, el('span', { className: 'ad-meta', textContent: meta }), el('label', { className: 'ad-status' }, select)));

  li.append(el('p', { className: 'ad-msg', textContent: r.message }));

  const from = el('div', { className: 'ad-from' });
  if (r.name) from.append(el('span', { textContent: r.name }));
  if (r.email) {
    const href = `mailto:${encodeURIComponent(r.email).replace(/%40/g, '@')}?subject=${encodeURIComponent("Your feedback on The Holy Qur'an app")}`;
    from.append(el('a', { href, textContent: `Reply to ${r.email}` }));
  }
  if (r.device) from.append(el('span', { textContent: r.device }));
  if (from.childNodes.length) li.append(from);

  if (r.screenshots?.length) {
    const shots = el('div', { className: 'ad-shots' });
    r.screenshots.forEach((p, i) => {
      const url = shotUrls.get(p);
      if (!url) return;
      shots.append(el('a', { href: url, target: '_blank', rel: 'noopener', 'aria-label': `Screenshot ${i + 1}, opens in a new tab` }, el('img', { src: url, alt: '', loading: 'lazy' })));
    });
    li.append(shots);
  }

  const note = el('textarea', { value: r.admin_note || '', maxLength: 2000, rows: 1, placeholder: 'Private note (only you see this)', 'aria-label': 'Private note' });
  const saved = el('span', { className: 'ad-saved', role: 'status' });
  const saveNote = el('button', { className: 'ad-ghost', type: 'button', textContent: 'Save note' });
  saveNote.addEventListener('click', async () => {
    saveNote.disabled = true;
    const { error } = await sb.from('feedback').update({ admin_note: note.value.trim() || null }).eq('id', r.id);
    saveNote.disabled = false;
    saved.textContent = error ? `Not saved: ${error.message}` : 'Saved';
    if (!error) r.admin_note = note.value.trim() || null;
  });
  const del = el('button', { className: 'ad-ghost ad-danger', type: 'button', textContent: 'Delete' });
  del.addEventListener('click', async () => {
    if (!confirm('Delete this feedback and its screenshots? This cannot be undone.')) return;
    del.disabled = true;
    if (r.screenshots?.length) await sb.storage.from(BUCKET).remove(r.screenshots);
    const { error } = await sb.from('feedback').delete().eq('id', r.id);
    if (error) {
      del.disabled = false;
      return alert(`Couldn't delete it: ${error.message}`);
    }
    rows = rows.filter((x) => x.id !== r.id);
    renderFeedbackStats();
    renderItems();
  });
  li.append(el('div', { className: 'ad-note' }, note), el('div', { className: 'ad-item-actions' }, saveNote, del, saved));
  return li;
}

// ───────────── Start ─────────────

sb.auth.getSession().then(({ data }) => route(data.session));
