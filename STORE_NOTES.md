# Store submission notes

Texts to paste when submitting ScrapBro to the Chrome Web Store, Microsoft Edge Add-ons and addons.mozilla.org (AMO).
Replace `X.Y.Z` with the version being submitted.

## What to upload

Use the zips attached to the GitHub release `vX.Y.Z` (built by the release workflow), not a local build:
only those contain `backend_hashes.json`, the checksums of the backend programs of that release.

- Chrome Web Store / Edge Add-ons: `scrapbro-chrome-X.Y.Z.zip`
- AMO: `scrapbro-firefox-X.Y.Z.zip`

## Note to reviewers

> ScrapBro saves web pages to the user's disk. Browsers cannot write to arbitrary folders, so, like ScrapBee
> (which it is a fork of), it relies on a small native helper program connected through native messaging
> (host name `scrapbro_backend`).
>
> - Source of the helper: https://github.com/unalignedcoder/scrapbro/tree/vX.Y.Z/backend (Go, standard library only).
> - Its binaries are built by GitHub Actions from that tagged source (`.github/workflows/build.yml`) and published
>   in the release https://github.com/unalignedcoder/scrapbro/releases/tag/vX.Y.Z together with `SHA256SUMS`.
> - On the extension's Install page the user can download the helper. The extension fetches it only from the
>   release of its own version (`releases/download/vX.Y.Z/...`, never "latest"), verifies its SHA-256 against
>   `backend_hashes.json` shipped inside the extension package, and only then offers it to the user to save
>   (save dialog). A file that does not match is discarded.
> - The extension never runs anything. The user saves three files (helper, native messaging manifest,
>   install script) and runs the install script themselves; it only registers the manifest for the current user
>   (HKCU registry key on Windows, a JSON file in the browser's NativeMessagingHosts folder on Linux/macOS).
> - The helper listens on 127.0.0.1 only, on a random port, and refuses requests that do not come from the extension.
> - No data is collected or sent anywhere.

## Third-party code

All unmodified copies of the upstream releases, their licenses are in `THIRD_PARTY_LICENSES.txt` inside the package:

| File | Library | Source | License |
|---|---|---|---|
| `libs/browser-polyfill.min.js` | webextension-polyfill 0.12.0 | https://github.com/mozilla/webextension-polyfill/releases/tag/0.12.0 (`dist/browser-polyfill.min.js`) | MPL-2.0 |
| `libs/jquery-3.3.1.js` | jQuery 3.3.1 | https://code.jquery.com/jquery-3.3.1.js | MIT |
| `libs/md5.js` | JavaScript MD5 2.1, Paul Johnston | http://pajhome.org.uk/crypt/md5 | BSD |
| `libs/mime.types.js` | Apache httpd mime.types, as a JS table | https://svn.apache.org/repos/asf/httpd/httpd/trunk/docs/conf/mime.types | Apache-2.0 |

The extension's own code is not minified or generated. The only build step (`node build.mjs`) copies `src/`
and `platform/<browser>/`, writes the version and icon size into the manifest and adds `backend_hashes.json`.

## Chrome Web Store: permission justifications

| Permission | Why |
|---|---|
| `nativeMessaging` | starts and talks to the backend program that reads and writes the scrapbooks on disk |
| `host_permissions` `<all_urls>`, `file:///*` | capture the page the user chooses (its HTML, styles, images, frames), including local files |
| `scripting`, `activeTab` | inject the capture code into the page being saved, and the editing tools into saved pages |
| `tabs`, `webNavigation` | find the tab and its frames to capture, open saved pages |
| `downloads` | let the user save the backend program and its install files |
| `contextMenus` | "Save Page", "Save Selection", "Save Bookmark" in the right-click menu |
| `sidePanel` | the scrapbook tree is shown in the side panel |
| `storage`, `unlimitedStorage` | settings and the list of scrapbooks |
| `notifications` | report finished or failed captures |

Single purpose: save web pages to local scrapbooks and manage them in the side panel.
Data usage: no user data is collected or transmitted.

## AMO

- Add-on ID: `scrapbro@tuscoss.com` (cannot change after the first upload).
- `data_collection_permissions`: none (set in `platform/firefox/manifest.json`).
