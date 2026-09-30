// Feedback form: uploads screenshots to a private Supabase Storage bucket, then saves
// the message to the `feedback` table. The publishable key only allows *sending*
// feedback (row-level security); nothing can be read back with it.
//
// The app opens this page as /feedback?v=<version>&build=<n>&device=<model> so bug
// reports arrive with the app version and phone.

const SUPABASE_URL = 'https://phqhwmggpeowmjjxjswk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_vfUCb4zw9VyzyupMuOo1uA_mliCLNTo';
const BUCKET = 'feedback-screenshots';
const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;

const form = document.getElementById('fb-form');
const filesInput = document.getElementById('files');
const drop = document.getElementById('drop');
const previews = document.getElementById('previews');
const statusEl = document.getElementById('status');
const submitBtn = document.getElementById('submit');
const openedAt = Date.now();
let files = [];

// App version and device, from the link the app opens, else the browser.
const params = new URLSearchParams(location.search);
const appVersion = params.get('v') ? `${params.get('v')}${params.get('build') ? ` (build ${params.get('build')})` : ''}` : '';
const device = (params.get('device') || navigator.userAgent).slice(0, 300);
document.getElementById('device-note').textContent = appVersion
  ? `App ${appVersion} on ${params.get('device') || 'your phone'} will be included to help us reproduce issues.`
  : 'Your browser/phone type is included to help us reproduce issues.';

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('is-error', isError);
}

function addFiles(list) {
  for (const file of list) {
    if (!file.type.startsWith('image/')) continue;
    if (files.length >= MAX_FILES) {
      setStatus(`You can add up to ${MAX_FILES} screenshots.`, true);
      break;
    }
    files.push(file);
  }
  renderPreviews();
}

function renderPreviews() {
  previews.innerHTML = '';
  files.forEach((file, i) => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.alt = `Screenshot ${i + 1}`;
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove screenshot ${i + 1}`);
    remove.onclick = () => {
      files.splice(i, 1);
      renderPreviews();
    };
    li.append(img, remove);
    previews.append(li);
  });
}

filesInput.addEventListener('change', () => {
  addFiles(filesInput.files);
  filesInput.value = '';
});
['dragenter', 'dragover'].forEach((t) =>
  drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  }),
);
['dragleave', 'drop'].forEach((t) =>
  drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
  }),
);
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

/** Shrinks very large images (e.g. full-resolution photos) to fit the 5 MB limit. */
async function fitSize(file) {
  if (file.size <= MAX_BYTES * 0.9) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file; // e.g. HEIC in browsers that can't decode it; the server limit still applies
  }
}

async function uploadScreenshot(file) {
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
  const path = `uploads/${crypto.randomUUID()}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': file.type, 'x-upsert': 'false' },
    body: file,
  });
  if (!res.ok) throw new Error(`screenshot upload failed (${res.status})`);
  return path;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const message = String(data.get('message') || '').trim();

  // Bots fill the hidden field or submit instantly; quietly pretend it worked.
  if (data.get('website') || Date.now() - openedAt < 2500) {
    form.hidden = true;
    document.getElementById('done').hidden = false;
    return;
  }
  if (!message) {
    setStatus('Please write your feedback first.', true);
    form.message.focus();
    return;
  }

  submitBtn.disabled = true;
  try {
    const paths = [];
    for (let i = 0; i < files.length; i++) {
      setStatus(`Uploading screenshot ${i + 1} of ${files.length}…`);
      paths.push(await uploadScreenshot(await fitSize(files[i])));
    }
    setStatus('Sending…');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        kind: data.get('kind') || 'other',
        message: message.slice(0, 5000),
        name: String(data.get('name') || '').trim().slice(0, 100) || null,
        email: String(data.get('email') || '').trim().slice(0, 200) || null,
        app_version: appVersion.slice(0, 60) || null,
        device,
        screenshots: paths,
      }),
    });
    if (!res.ok) throw new Error(`saving failed (${res.status})`);
    form.hidden = true;
    document.getElementById('done').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    setStatus(`Sorry, it didn’t send: ${err.message}. Please check your connection and try again.`, true);
  } finally {
    submitBtn.disabled = false;
  }
});
