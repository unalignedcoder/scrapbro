<img width="128" height="128" alt="bro" src="https://github.com/user-attachments/assets/784c69d1-f71a-4ec6-aede-cd58ce77f58e" />

# ScrapBro

ScrapBro is a fork of [ScrapBee](https://github.com/vctfence/scrapbee) by vctfence, with several improvements, the biggest being that it is available for both Firefox and Chromium browsers from one code base.

ScrapBro allows you to:
- save entire pages;
- save snippets or selections;
- save locally on PC, without having to share anything with third parties;
- comfortably browse through the entries in the side panel;
- organize them in folders;
- edit the content, removing unnecessary parts or highlighting others;
- export entries as `html` to be shared.

ScrapBro adapts to the active dark/light theme, and changes interface colors accordingly.

Settings are simple and intuitive, and can be exported and imported across browsers or kept as a backup.

ScrapBro is fully compatible with the old ScrapBee and Scrabooks `.rdf` index files.

<img width="366" height="363" alt="The sidebar folder tree to browse saved pages." src="https://github.com/user-attachments/assets/36d7eddf-d91c-4a17-8101-e1b343f01fc1" />
<br /><sup>The sidebar folder tree to browse saved pages.</sup><p>&nbsp;</p>


<img width="1280" height="800" alt="Highlighting and editing pages." src="https://github.com/user-attachments/assets/526f7c0a-d7bf-4c3c-9a29-79079d63b36b" />
<br /><sup>Highlighting and editing pages.</sup><p>&nbsp;</p>


<img width="790" height="597" alt="The settings." src="https://github.com/user-attachments/assets/0d678b59-3575-4435-905e-4a3d11578266" />
<br /><sup>The settings.</sup><p>&nbsp;</p>

## Download and Install

1. Install ScrapBro from your browser's add-on store.
2. Open its Install page in Settings and download the backend and the install script.
3. Run the install script in that folder once (`install.bat` on Windows, `install.sh` on Linux/macOS).
4. In Settings, add your scrapbook folder (new or existing).
5. Open the sidebar / side panel and start saving, browsing or reading pages.
   
You can find this extension on the [Firefox](https://addons.mozilla.org/en-US/firefox/addon/scrapbro/), Chrome and [Edge](https://microsoftedge.microsoft.com/addons/detail/scrapbro/hbjddommilbcfifcmlplojifekcgpnfd) Extension pages, or download the `.zip` files from the [Releases](https://github.com/unalignedcoder/scrapbro/releases) page.

## Supported platforms

- Windows: supported.
- macOS and Linux: experimental.
- Minimum versions: Chromium 116+, Firefox 140+.

## Privacy

Nothing is collected; there is no analytics, telemetry, advertising or third-party tracking. The only network request is the backend download from GitHub Releases, checked with SHA-256.

## Backend

ScrapBro needs a small native program, `scrapbro_backend` (in `backend/`), to read and write scrapbooks on disk.

The browser starts it through [native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging) and it serves the API and the saved pages over HTTP on `127.0.0.1`.
It uses the same API as the Scrapbee backend v1.7, but is a separate implementation.

Users install the backend from the extension, *Settings → Install*, which downloads three files into a folder of their choice:
the program (from the [GitHub release](https://github.com/unalignedcoder/scrapbro/releases) of the same version,
checked against the SHA-256 shipped in the extension before it is saved),
the `json` configuration file and the install script (`.bat` on Windows, `.sh` on Linux and macOS). 
Running the script once registers the backend for the current user. 

On Windows the configuration points to the program relative to its own folder, on Linux and macOS the script writes the absolute path when it copies the configuration into the browsers' folders.

Differently from Scrapbee, <ins>the backend port needs no setup</ins>: a random, available port is picked on first start without needing intervention from the user.
To run the backend yourself (e.g. as a service), start `scrapbro_backend web-server [port] [host] [password]` and choose *Manually* in the settings.

The backend only answers the extension: requests from other web pages (checked by `Origin` and `Host`) are refused.

## Compatibility notes

- Internal names that end up in saved pages (CSS classes like `scrapbee-marker-*`) are kept, so pages edited with ScrapBee and ScrapBro stay interchangeable.
- **It is best not to install ScrapBro and ScrapBee in the same browser profile.** Both read and write the same scrapbooks, each keeps its own copy of the tree in memory and saves the whole RDF file on every change, so working with both can silently lose changes or leave a scrapbook inconsistent. You can rather export the settings from ScrapBee, remove it, install ScrapBro and import the settings. This will work flawlessly, however always back up the scrapbook folders before doing any of this.

## License

[MPL-2.0](LICENSE), as the original ScrapBee.

<p>&nbsp;</p>

<div align="center"><table border="1" cellspacing="0" cellpadding="20"><tr><td><p align="center">&nbsp;<br>Why, thank you for asking!</p><hr width="60%"><p align="center">👉 You can donate to all my projects <a href="https://www.buymeacoffee.com/unalignedcoder" target="_blank">here</a> 👈<br>&nbsp;</p></td></tr></table></div>

<p>&nbsp;</p>

## For developers

#### Project layout

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

#### Build

Requires Node.js 22 or newer, no dependencies.

| Build | Browsers | Manifest |
|---|---|---|
| `dist/chrome` | Chrome, Edge, Brave, Vivaldi, Chromium (116+) | V3, side panel, service worker |
| `dist/firefox` | Firefox and forks such as Floorp, LibreWolf, Waterfox (140+) | V2, sidebar, persistent background page |

```
npm run build        # dist/chrome, dist/firefox and their zips dist/scrapbro-<browser>-<version>.zip
npm run watch        # rebuild on every change
```
The settings page only downloads the backend program when the build contains its checksums (`backend_hashes.json`).
Release builds get them from the release workflow. For a local build that should download the backend of an already
published release, use `node build.mjs --checksums-from-release` (needs the GitHub CLI); `--checksums <SHA256SUMS>` takes a file.

Bump `version` in `package.json` before packaging a release; it is written into both manifests.

#### Testing

- **Chromium:** open `chrome://extensions` (`edge://extensions`), enable Developer mode, *Load unpacked* → `dist/chrome`. Reload the extension there after a rebuild.
- **Firefox:** `about:debugging` → *This Firefox* → *Load Temporary Add-on* → `dist/firefox/manifest.json`, or `npm run run:firefox` to start a clean Firefox with it.
