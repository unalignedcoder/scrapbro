// Assembles the browser builds from the shared sources:
//   dist/chrome  = src/ + platform/chrome/   (Manifest V3, Chrome / Edge / Brave / ...)
//   dist/firefox = src/ + platform/firefox/  (Manifest V2, Firefox and its forks)
// The version comes from package.json.
//
// usage: node build.mjs [chrome] [firefox] [--zip] [--watch]
//   no target builds both, --zip also writes dist/scrapbro-<target>-<version>.zip for the stores,
//   --watch rebuilds on changes (then reload the extension in the browser).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {fileURLToPath} from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = ["chrome", "firefox"];
const args = process.argv.slice(2);
const targets = args.filter(a => TARGETS.includes(a));
const unknown = args.filter(a => !a.startsWith("--") && !TARGETS.includes(a));
if(unknown.length){
    console.error(`unknown target: ${unknown.join(", ")} (known: ${TARGETS.join(", ")})`);
    process.exit(1);
}
const options = {zip: args.includes("--zip"), watch: args.includes("--watch")};
if(!targets.length) targets.push(...TARGETS);

function build(target){
    const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
    const out = path.join(root, "dist", target);
    fs.rmSync(out, {recursive: true, force: true});
    fs.cpSync(path.join(root, "src"), out, {recursive: true});
    fs.cpSync(path.join(root, "platform", target), out, {recursive: true, force: true});
    const manifestPath = path.join(out, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.version = version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + "\n");
    let line = `${target}: dist/${target} (${version})`;
    if(options.zip){
        const zipName = `scrapbro-${target}-${version}.zip`;
        fs.writeFileSync(path.join(root, "dist", zipName), zipDir(out));
        line += `, dist/${zipName}`;
    }
    console.log(line);
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
