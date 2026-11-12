// Assembles the browser builds from the shared sources:
//   dist/chrome  = src/ + platform/chrome/   (Manifest V3, Chrome / Edge / Brave / ...)
//   dist/firefox = src/ + platform/firefox/  (Manifest V2, Firefox and its forks)
// The version comes from package.json.
//
// usage: node build.mjs [chrome] [firefox] [--zip] [--watch] [--checksums <SHA256SUMS> | --checksums-from-release]
//   no target builds both, and every build also writes dist/scrapbro-<target>-<version>.zip (--zip is accepted, no longer needed),
//   --watch rebuilds on changes (then reload the extension in the browser).
//   --checksums writes the SHA-256 of the backend programs into the build (backend_hashes.json), the settings page
//   only lets the user save a downloaded backend that matches. The release workflow passes the SHA256SUMS it creates;
//   --checksums-from-release takes it from the published release of this version (needs the GitHub CLI, gh).
//   Without checksums the settings page refuses to download the backend.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = ["chrome", "firefox"];
const args = process.argv.slice(2);
const targets = args.filter(a => TARGETS.includes(a));
const unknown = args.filter((a, i) => !a.startsWith("--") && !TARGETS.includes(a) && args[i - 1] != "--checksums");
if(unknown.length){
    console.error(`unknown target: ${unknown.join(", ")} (known: ${TARGETS.join(", ")})`);
    process.exit(1);
}
/** the zips are always written, so dist/ never holds a package older than the folders */
const options = {zip: true, watch: args.includes("--watch")};
const checksumsArg = args.indexOf("--checksums");
const checksumsFile = checksumsArg > -1 ? args[checksumsArg + 1] : null;
if(!targets.length) targets.push(...TARGETS);

function build(target){
    const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
    const out = path.join(root, "dist", target);
    fs.rmSync(out, {recursive: true, force: true});
    fs.cpSync(path.join(root, "src"), out, {recursive: true});
    fs.cpSync(path.join(root, "platform", target), out, {recursive: true, force: true});
    /** the license travels with the package, third-party licenses are in src/THIRD_PARTY_LICENSES.txt */
    fs.copyFileSync(path.join(root, "LICENSE"), path.join(out, "LICENSE"));
    const manifestPath = path.join(out, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.version = version;
    setIcon(manifest, out);
    stampStylesheets(out);
    const hashes = backendHashes(version);
    if(hashes)
        fs.writeFileSync(path.join(out, "backend_hashes.json"), JSON.stringify(hashes, null, 2) + "\n");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + "\n");
    let line = `${target}: dist/${target} (${version})`;
    if(options.zip){
        const zipName = `scrapbro-${target}-${version}.zip`;
        fs.writeFileSync(path.join(root, "dist", zipName), zipDir(out));
        line += `, dist/${zipName}`;
    }
    console.log(line);
}

/* the extension icon: one PNG, used for every place and size (the browser scales it).
   Replace src/icons/bro.png to change it, its pixel size is read from the file.
   The stores want at least 128x128, a square PNG of 128 or more is best. */
const ICON = "icons/bro.png";
function setIcon(manifest, out){
    const png = fs.readFileSync(path.join(out, ICON));
    if(png.readUInt32BE(12) != 0x49484452) // "IHDR"
        throw Error(`${ICON} is not a PNG file`);
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if(width != height)
        console.warn(`warning: ${ICON} is ${width}x${height}, icons should be square`);
    if(options.zip && width < 128)
        console.warn(`warning: ${ICON} is ${width}x${width}, the stores want at least 128x128`);
    manifest.icons = {[width]: ICON};
    const action = manifest.action || manifest.browser_action;
    if(action) action.default_icon = {[width]: ICON};
    if(manifest.sidebar_action) manifest.sidebar_action.default_icon = ICON;
}

/* a new address for the stylesheets of every build: firefox keeps loaded stylesheets by address and would
   go on using the old ones after the extension is reloaded */
const BUILD_STAMP = Date.now().toString(36);
function stampStylesheets(out){
    for(const dir of ["html", "popup"]){
        const d = path.join(out, dir);
        if(!fs.existsSync(d)) continue;
        for(const f of fs.readdirSync(d).filter(f => f.endsWith(".html"))){
            const p = path.join(d, f);
            const html = fs.readFileSync(p, "utf8");
            const stamped = html.replace(/(<link\s[^>]*href=["'][^"'?]+\.css)(["'])/g, `$1?b=${BUILD_STAMP}$2`);
            if(stamped != html) fs.writeFileSync(p, stamped);
        }
    }
}

/* SHA-256 of the backend programs of this version, from a SHA256SUMS file ("<hash>  <file>" per line) */
let hashesCache;
function backendHashes(version){
    if(hashesCache !== undefined)
        return hashesCache;
    let text = null;
    if(checksumsFile){
        text = fs.readFileSync(checksumsFile, "utf8");
    }else if(args.includes("--checksums-from-release")){
        try{
            text = execFileSync("gh", ["release", "download", `v${version}`, "--pattern", "SHA256SUMS", "--output", "-"],
                                {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
        }catch(e){
            throw Error(`no SHA256SUMS in release v${version}: ${(e.stderr || e.message).trim()}`);
        }
    }
    if(text == null){
        console.warn("note: no backend checksums, the settings page of this build cannot download the backend");
        return hashesCache = null;
    }
    const files = {};
    for(const line of text.split(/\r?\n/)){
        const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(\S+)$/);
        if(m) files[path.basename(m[2])] = m[1].toLowerCase();
    }
    if(!Object.keys(files).length)
        throw Error("no checksums found in SHA256SUMS");
    return hashesCache = {version, files};
}

/* minimal zip writer (deflate), enough for the extension stores */
function zipDir(dir){
    const files = [];
    (function walk(d){
        for(const e of fs.readdirSync(d, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))){
            const p = path.join(d, e.name);
            if(e.isDirectory()) walk(p);
            else files.push(p);
        }
    })(dir);
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const locals = [], centrals = [];
    let offset = 0;
    for(const file of files){
        const name = Buffer.from(path.relative(dir, file).split(path.sep).join("/"));
        const data = fs.readFileSync(file);
        const packed = zlib.deflateRawSync(data, {level: 9});
        const stored = packed.length >= data.length;
        const body = stored ? data : packed;
        const crc = zlib.crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);              // version needed
        local.writeUInt16LE(0x0800, 6);          // utf-8 names
        local.writeUInt16LE(stored ? 0 : 8, 8);
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);            // version made by
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(stored ? 0 : 8, 10);
        central.writeUInt16LE(dosTime, 12);
        central.writeUInt16LE(dosDate, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(body.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, name, body);
        centrals.push(central, name);
        offset += local.length + name.length + body.length;
    }
    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, end]);
}

function buildAll(){
    for(const target of targets){
        try{
            build(target);
        }catch(e){
            console.error(`${target}: ${e.message}`);
            if(!options.watch) process.exitCode = 1;
        }
    }
}

buildAll();
if(options.watch){
    let timer;
    const rebuild = () => { clearTimeout(timer); timer = setTimeout(buildAll, 200); };
    for(const d of ["src", "platform"])
        fs.watch(path.join(root, d), {recursive: true}, rebuild);
    fs.watch(path.join(root, "package.json"), rebuild);
    console.log("watching src/ and platform/ ...");
}
