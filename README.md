# The Holy Qur'an — landing page

Static website where people download the Android app. Plain HTML, CSS and a little JavaScript; no build step.

```
index.html, styles.css, script.js
assets/                 icon, medallion, app screenshots
downloads/version.json  version and size shown on the page
```

## Hosting

Deployed on **Vercel** from this repository (framework preset: *Other*, no build command, output directory: root). Every push to `main` redeploys.

## The download

The APK is **not** stored in this repository. The "Download for Android" buttons link to the latest GitHub Release:

https://github.com/rofeeq206/quran-app-site/releases/latest/download/Quran-App.apk

To publish a new version, attach the new build to a new release as `Quran-App.apk` (the app repo's `npm run release` does this), and update `downloads/version.json`.

## Preview locally

```
python -m http.server 8090
```

Then open http://127.0.0.1:8090.
