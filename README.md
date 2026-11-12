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
npm run build        # dist/chrome, dist/firefox and their zips dist/scrapbro-<browser>-<version>.zip
npm run watch        # rebuild on every change
```

The settings page only downloads the backend program when the build contains its checksums (`backend_hashes.json`).
Release builds get them from the release workflow. For a local build that should download the backend of an already
published release, use `node build.mjs --checksums-from-release` (needs the GitHub CLI); `--checksums <SHA256SUMS>` takes a file.
Upload to the stores the zips of the GitHub release, see [STORE_NOTES.md](STORE_NOTES.md).

Bump `version` in `package.json` before packaging a release; it is written into both manifests.

### Icon

`src/icons/bro.png` is the only icon file: the toolbar button, sidebar, extensions page, notifications and page tabs all use it,
and the browser scales it to each size. To change the icon, replace that file (keep the name). The build reads its size and
writes it into both manifests. Use a square PNG of at least 128×128, which the stores ask for.

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

Users install it from the extension, *Settings → Install*, which downloads three files into a folder of their choice:
the program for their system (from the [GitHub release](https://github.com/unalignedcoder/scrapbro/releases) of the same version,
checked against the SHA-256 shipped in the extension before it is saved),
the configuration file `scrapbro_backend_chrome.json` / `scrapbro_backend_firefox.json` and the install script
`install_chrome.bat` / `install_firefox.bat` (`.sh` on Linux and macOS). Kept in one folder, running the script once registers the
backend for the current user. On Windows the configuration points to the program relative to its own folder,
on Linux and macOS the script writes the absolute path when it copies the configuration into the browsers' folders.

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
- **Do not install ScrapBro and ScrapBee in the same browser profile.** Both read and write the same scrapbooks, each keeps
  its own copy of the tree in memory and saves the whole RDF file on every change, so working with both can silently lose
  changes or leave a scrapbook inconsistent. Switch instead: export the settings from ScrapBee, remove it, install ScrapBro
  and import them. Back up the scrapbook folders before the first use.

## License

[MPL-2.0](LICENSE), as the original ScrapBee.
