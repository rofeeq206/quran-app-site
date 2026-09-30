// Rotating hero words, scroll reveals, and the current version/size from
// downloads/version.json (written by scripts/copy-build.js after each Android build).

document.documentElement.classList.add('js');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Hero: cycle through the intentions ("Read Daily", "Reflect Deeply", ...).
const words = [...document.querySelectorAll('.rotator .word')];
if (words.length > 1 && !reduceMotion) {
  let i = 0;
  setInterval(() => {
    words[i].classList.remove('is-active');
    i = (i + 1) % words.length;
    words[i].classList.add('is-active');
  }, 2600);
}

// Reveal sections as they scroll into view.
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    }
  },
  { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
);
document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 3) * 90}ms`;
  observer.observe(el);
});

// Show the latest version and download size.
fetch('downloads/version.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .then((info) => {
    if (!info) return;
    const meta = document.querySelector('[data-version]');
    if (meta) meta.textContent = `Android 7.0 or newer · ${info.sizeMB} MB · free · no account, no ads`;
    document.querySelectorAll('[data-size]').forEach((el) => (el.textContent = info.sizeMB));
    const full = document.querySelector('[data-version-full]');
    if (full) full.textContent = `Android app · version ${info.version} (build ${info.build}) · updated ${info.date}`;
  })
  .catch(() => {});
