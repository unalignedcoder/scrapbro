# ScrapBro

Save web pages to your local disk and manage them in the browser sidebar.
ScrapBro reads and writes ScrapBook / ScrapBee data (RDF files + `data` folder), so existing scrapbooks keep working.

ScrapBro is a fork of [ScrapBee](https://github.com/vctfence/scrapbee) by vctfence that runs in both browser families from one code base:

| Build | Browsers | Manifest |
|---|---|---|
| `dist/chrome` | Chrome, Edge, Brave, Vivaldi, Chromium (116+) | V3, side panel, service worker |
| `dist/firefox` | Firefox and forks such as Floorp, LibreWolf, Waterfox (140+) | V2, sidebar, persistent background page |

## Project layout

```
src/                 shared extension code (pages, scripts, styles, locales, icons)
  js/platform.js     the only place that branches between chromium and firefox
platform/chrome/     manifest.json for chromium
platform/firefox/    manifest.json + background page for firefox
backend/             scrapbro_backend, the native helper program (Go, no dependencies)
.github/workflows/   tests the backend; a version tag builds and publishes a release
build.mjs            assembles dist/<browser> = src/ + platform/<browser>/
package.json         version number of both builds, npm scripts
```

Edit files in `src/` (or `platform/`), never in `dist/`, which is rebuilt.

## Build

Requires Node.js 22 or newer, no dependencies.

```
npm run build        # dist/chrome and dist/firefox
npm run watch        # rebuild on every change
npm run package      # also writes dist/scrapbro-<browser>-<version>.zip for the stores
```

Bump `version` in `package.json` before packaging a release; it is written into both manifests.

### Try it

- **Chromium:** open `chrome://extensions` (`edge://extensions`), enable Developer mode, *Load unpacked* → `dist/chrome`. Reload the extension there after a rebuild.
- **Firefox:** `about:debugging` → *This Firefox* → *Load Temporary Add-on* → `dist/firefox/manifest.json`, or `npm run run:firefox` to start a clean Firefox with it.

### Publish

- **Chrome Web Store / Edge Add-ons:** upload `dist/scrapbro-chrome-<version>.zip`.
- **Firefox (AMO):** upload `dist/scrapbro-firefox-<version>.zip` as listed add-on, or sign it for self-distribution with
  `npm run sign:firefox` (needs AMO API credentials in `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`). `npm run lint:firefox` runs the AMO checks locally.
  The add-on ID is `scrapbro@tuscoss.com` (in `platform/firefox/manifest.json`); it cannot change after the first upload.

## Backend

ScrapBro needs a small native program, `scrapbro_backend` (in `backend/`), to read and write scrapbooks on disk.
The browser starts it through native messaging (host name `scrapbro_backend`), and it serves the API and the saved pages over HTTP on `127.0.0.1`.
It speaks the same API as the ScrapBee backend 1.7, but is a separate implementation.

Users install it from the extension: *Settings → Install* downloads the program for their system from the latest
[GitHub release](https://github.com/unalignedcoder/scrapbro/releases/latest) and an install script for the current browser
into `<downloads>/scrapbro/`, then they run the script once.
It registers `scrapbro_backend_chrome.json` (chromium) or `scrapbro_backend_firefox.json` (firefox) for the current user, both can live in the same folder.

The backend port needs no setup: a free port is picked on first start and kept while it stays free, if it gets taken (e.g. by ScrapBee or ScrapBro in another browser) a new one is picked.
To run the backend yourself (e.g. as a service), start `scrapbro_backend web-server [port] [host] [password]` and choose *Manually* in the settings.

The backend only answers the extension: requests from other web pages (checked by `Origin` and `Host`) are refused.

### Develop and release

```
cd backend
go test ./...                     # Go 1.22 or newer
go build -o scrapbro_backend.exe .
```

To publish a release: set `version` in `package.json`, commit, then `git tag v<version>` and `git push --tags`.
The workflow tests the backend on Windows and Linux, builds it for Windows, Linux and macOS (x86, x64, arm64),
packages both extensions and attaches everything to a GitHub release named after the tag.

## Compatibility notes

- Internal names that end up in saved pages (CSS classes like `scrapbee-marker-*`) are kept, so pages edited with ScrapBee and ScrapBro stay interchangeable.
- ScrapBro and ScrapBee can be installed side by side; they use different native host names.

## License

[MPL-2.0](LICENSE), as the original ScrapBee.
