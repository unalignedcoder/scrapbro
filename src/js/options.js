import {global} from "./global.js";
import {log} from "./message.js";
import {initMover, initExporter} from "./tools.js";
import {gtev, touchRdf, dataURLtoBlob} from "./utils.js";
import {ContextMenu} from "./control.js";
import {Configuration, History} from "./storage.js";
import {IS_FIREFOX, NATIVE_HOST, BACKEND_EXEC, BACKEND_RELEASES} from "./platform.js";

window.GLOBAL = global;
window.CONF = new Configuration();
window.HISTORY = new History();

function getAsync(url) {
    return new Promise((resolve, reject) => {
        var request = new XMLHttpRequest();
        request.onreadystatechange = function() {
            if (this.readyState == 4) {
                if (this.status == 200) {
                    resolve(this.response);
                } else if (this.status >= 404) {
                    reject(Error(this.response));
                }
            }
        };
        request.onerror = function(err) {
            reject(Error("request failed"));
        };
        request.open("GET", url);
        request.send();
    });
}

function createRdfField(k, v){
    var NAME_I18N = browser.i18n.getMessage("Name");
    var FILE_I18N = browser.i18n.getMessage("File");
    var $el = $(`<div class='rdf-row'><span>${NAME_I18N}</span> <input type="text" name="name"/>
${FILE_I18N} <input type="text" name="value"/>
<input type="button" name="move" value="" class="moveup"/>
<input type="button" name="move" value="" class="movedn"/>
<input type="button" name="del" value="" class="delete"/></div>`).appendTo($("#rdf-area"));
    $el.find("input[name=name]").val(k);
    $el.find("input[name=value]").val(v);
    $el.find("input[name=del]").click(function(){
        $(this).parent().remove();
    });
    $el.find("input[name=move]").click(function(){
        var up = (this.className == 'moveup');
        var $you;
        var $p = $(this).parent();
        if(up){
            $you = $p.prev(".rdf-row");
            if($you)$you.before($p);
        }else{
            $you = $p.next(".rdf-row");
            if($you)$you.after($p);
        }
    });
}

/** fonts offered for the sidebar: common fonts of Windows, macOS and Linux, only the installed ones are listed
    (browsers do not list the system fonts to extensions, except chrome with an extra permission) */
var FONT_GENERIC = ["sans-serif", "serif", "monospace"];
var FONT_CANDIDATES = [
    "Segoe UI", "Arial", "Calibri", "Cambria", "Candara", "Consolas", "Constantia", "Corbel", "Georgia", "Tahoma",
    "Trebuchet MS", "Verdana", "Times New Roman", "Courier New", "Lucida Sans Unicode", "Palatino Linotype",
    "Helvetica Neue", "Helvetica", "Avenir", "Avenir Next", "Gill Sans", "Optima", "Futura", "Baskerville", "Menlo", "Monaco",
    "DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono", "Liberation Sans", "Liberation Serif", "Ubuntu", "Cantarell",
    "Noto Sans", "Noto Serif", "Fira Sans", "Open Sans", "Roboto", "Source Sans Pro",
    "Microsoft YaHei", "Meiryo", "Yu Gothic", "Malgun Gothic", "PingFang SC", "Hiragino Sans"];
/** installed if text in the font measures differently than in the generic fallback */
function fontInstalled(name){
    var ctx = fontInstalled.ctx || (fontInstalled.ctx = document.createElement("canvas").getContext("2d"));
    var text = "mmmmmmmmmmlli1WQ@#";
    return FONT_GENERIC.some(base => {
        ctx.font = `72px ${base}`;
        var width = ctx.measureText(text).width;
        ctx.font = `72px "${name}", ${base}`;
        return ctx.measureText(text).width != width;
    });
}
function fillFontList(current){
    var $select = $("select[name=font_name]");
    $select.find("option").not(":first").remove();
    var names = FONT_GENERIC.concat(FONT_CANDIDATES.filter(fontInstalled).sort((a, b) => a.localeCompare(b)));
    if(current && names.indexOf(current) < 0)
        names.push(current); /** a font set before, e.g. typed in older versions */
    names.forEach(name => $("<option>").val(name).text(name).css("font-family", name).appendTo($select));
    $select.val(current || "");
}
function showConfiguration(){    
    $("#rdf-area").empty();
    $("input[name='save']").click(function(){
        var dialog = new DialogWaiting();
        dialog.show();

        setTimeout(r => {
            try{
                // backend
                var pwd = $.trim($("input[name=backend_pwd]").val());
                if(pwd){
                    if(!pwd.match(/^[0-9a-zA-Z]+$/)){
                        throw Error("invalid password format");
                    }
                }
                CONF.setItem('backend.type', $("input[name=backend_type]:checked").val());
                CONF.setItem('backend.address', $("input[name=backend_address]").val());
                CONF.setItem('backend.pwd', $("input[name=backend_pwd]").val());
                
                // rdf list
                var names = [];
                var paths = [];
                var touch = [];
                $("#rdf-area div input:nth-of-type(1)").each(function(){
                    var n = $.trim(this.value);
                    //names.push(n + "\n");
                    names.push(n);
                    var p = $.trim($(this).next("input").val());
                    //paths.push(p + "\n");
                    paths.push(p);
                    touch.push(touchRdf(CONF.getBackendAddress(), p, pwd));
                });
                Promise.all(touch);
                CONF.setItem('tree.paths', paths);
                CONF.setItem('tree.names', names);

                // apparence
                var size = (parseInt($("input[name=font_size]").val() / 5) * 5) / 100 * 12;

                CONF.setItem('sidebar.theme', $("select[name=sidebar_theme]").val());
                CONF.setItem('tree.font.size', size);
                CONF.setItem('tree.font.name', $("select[name=font_name]").val());
                CONF.setItem('tree.line.spacing', $("input[name=line_spacing]").val());
                
                // behavior
                CONF.setItem('sidebar.behavior.open.dest', $("input[name=open_in_current_tab]").is(":checked")?"curr-tab":"new-tab");
                CONF.setItem('sidebar.behavior.root.show', $("input[name=sidebar_show_root]").is(":checked")?"on":"off");
                CONF.setItem('capture.behavior.saving.dialog.close', $("input[name=auto_close_saving_dialog]").is(":checked")?"auto":"manually");
                CONF.setItem('capture.behavior.frames.save', $("input[name=saving_save_frames]").is(":checked")?"on":"off");
                CONF.setItem('capture.behavior.item.new.pos', $("input[name=saving_new_pos]:checked").val());
                CONF.setItem("global.notification.show", $("input[name=show_notification]").is(":checked")?"on":"off");
                CONF.setItem("global.debug", $("input[name=debug]").is(":checked")?"on":"off");
                CONF.commit();

                dialog.remove();
            }catch(e){
                alert("Save failed: " + e);
            }
        }, 500);
    });
    var paths = CONF.getRdfPaths();
    if(paths){
        CONF.getRdfNames().forEach(function(k, i){
            createRdfField(k, paths[i]);
        });
    }
    $("input[name=font_size]").bind("input", function(){ // bind 'input' instead of 'change' event
        $(this).next("span").text((parseInt(this.value / 5) * 5) +"%");
    });
    $("input[name=line_spacing]").bind("input", function(){ // bind 'input' instead of 'change' event
        $(this).next("span").text(parseInt(this.value));
    });
    $("select[name=sidebar_theme]").val(CONF.getItem("sidebar.theme") || "auto");
    $("input[name=font_size]").val((CONF.getItem("tree.font.size") / 12) * 100).trigger("input");
    fillFontList(CONF.getItem("tree.font.name"));    
    $("input[name=line_spacing]").val(CONF.getItem("tree.line.spacing")).trigger("input");

    var type = CONF.getItem("backend.type");
    $(`input[name=backend_type][value='${type}']`).attr("checked", true);
    $("input[name=backend_address]").val(CONF.getItem("backend.address"));
    $("input[name=backend_port]").val(CONF.getItem("backend.port"));
    $("input[name=backend_pwd]").val(CONF.getItem("backend.pwd"));
    $("input[name=sidebar_show_root]").prop("checked", CONF.getItem("sidebar.behavior.root.show")=="on");
    $("input[name=open_in_current_tab]").prop("checked", CONF.getItem("sidebar.behavior.open.dest")=="curr-tab");
    $("input[name=auto_close_saving_dialog]").prop("checked", CONF.getItem("capture.behavior.saving.dialog.close")=="auto");
    $("input[name=show_notification]").prop("checked", CONF.getItem("global.notification.show") == "on");
    $("input[name=saving_save_frames]").prop("checked", CONF.getItem("capture.behavior.frames.save")=="on");
    
    var pos = CONF.getItem("capture.behavior.item.new.pos");
    $(`input[name=saving_new_pos][value='${pos}']`).attr("checked", true);
    $("input[name=debug]").prop("checked", CONF.getItem("global.debug")=="on");
}

$(document).ready(async function(){
    await GLOBAL.load();
    await CONF.load();
    await HISTORY.load();

    var paths = CONF.getRdfPaths();

    /** the locale folder the browser picked for the messages (english when there is no translation), help and changelog come from there */
    var lang = browser.i18n.getMessage("LOCALE_DIR") || "en";
    document.title = document.title.translate();
    document.body.innerHTML = document.body.innerHTML.translate();

    getAsync("/_locales/" + lang + "/announcement.html").then((content) => {
        $("#div-announcement").html(content.translate());
        // $("#div-announcement").html($("#div-announcement").html().replace(/#(\d+\.\d+\.\d+)#/ig, "<h2>V$1</h2>"))
    }).catch(e => {
        alert(e.message);
    });

    getAsync("/_locales/" + lang + "/help.html").then((content) => {
        $("#div-help>div").html(content.translate());
        $(".download_exe").each(function(i, el){
            this.onclick = function(){
                downloadBackend().catch(e => alert(e.message));
                return false;
            };
        });        
    });

    $(".tab-button").each((i, el)=>{
        $(el).click((e)=>{
            $(".tab-button").removeClass("focused");
            $(e.target).addClass("focused");
            $(".tab-content").hide();
            $(".tab-content").eq(i).show();
        });
    });
    $(".tab-button").eq(0).click();

    /** export / import */
    $("input[name='export']").click(async function(){
        var json = CONF.exportJson();
        downloadText(JSON.stringify(json, null, 2), "scrapbro_configure.json", null, true);
    });
    $("input[name='import']").click(async function(){
        document.getElementById("import_file").onchange=function(){
            var fileToLoad = document.getElementById("import_file").files[0];
            var fileReader = new FileReader();
            fileReader.onload = function(fileLoadedEvent){
                var textFromFileLoaded = fileLoadedEvent.target.result;
                try{
                    var json = JSON.parse(textFromFileLoaded);
                    var result = CONF.loadJson(json);
                    log.info(`settings imported: ${result.imported.length}, skipped (obsolete or unknown): ${result.skipped.length}`);
                    if(result.skipped.length)
                        log.debug(`skipped settings: ${result.skipped.join(", ")}`);
                    showConfiguration();
                }catch(e){
                    alert("{INVALID_CONFIGURATION_FILE}".translate());
                }
            };
            fileReader.readAsText(fileToLoad, "UTF-8");
        };
        document.getElementById("import_file").click();
    });
    /** tools */
    function initTools(version){
        if(gtev(version, '1.7.0')){
            initMover();
            initExporter();
            log.debug("tools initiated successfully.");
        }else{
            log.error("can not initiate tools, make sure backend 1.7.0 or later installed.");
        }
    }
    browser.runtime.sendMessage({type: 'GET_BACKEND_VERSION'}).then((version) => {
        /** not started yet (e.g. right after installing): BACKEND_SERVICE_STARTED comes later */
        if(version)
            initTools(version);
        showBackendStatus(version);
    });
    function findOffsetParent(el){
        var r = document.body;
        var p = el.parentNode;
        while(p){
            var style =  window.getComputedStyle(p, null).getPropertyValue('position');
            if(style == "absolute" || style == "relative"){
                r = p;
                break;
            }
            p = p.parentNode;
        }
        return r;
    }
    
    /** help mark */
    $(".help-mark, .warn-mark").hover(function(e){
        var parent = findOffsetParent(e.target);
        var offset = parent.getBoundingClientRect();
        $(this).next(".tips.hide").show().css({
            left: e.clientX - offset.left + "px",
            top:  e.clientY - offset.top + "px",
        });
    }, function(){
        $(this).next(".tips.hide").hide();
    });
    
    /** more donation */
    if($.trim($("#divMoreDonateWay>div").text())){
        $("#divMoreDonateWay").show();
    }
    $("input[name='add']").click(function(){
        createRdfField("", "");
    });
    
    showConfiguration();

    /** backend */
    $(`input[name=backend_type]`).click(function(){
        if(this.value == "address"){
            $(this).closest("tr").next("tr").hide();
            $(this).closest("tr").next("tr").next("tr").show();
        }else{
            $(this).closest("tr").next("tr").show();
            $(this).closest("tr").next("tr").next("tr").hide();
        }
    });
    $(`input[name=backend_type]:checked`).click();
    showInstallState();
    
    function applyArea(){
        $(".div-area").hide();
        $("a.left-index").removeClass("focus");
        var map = {};
        location.href.replace(/.+#/, "").replace(/(\w+)=(\w+)/g, function(a, b, c){
            map[b] = c;
        });
        /** first run (no scrapbook configured yet): start with the installation */
        map.area = map.area || (CONF.getRdfPaths().length ? "configure" : "install");
        $("#div-" + map.area).show();
        $("a.left-index[href='#area=" + map.area + "']").addClass("focus");
        if(map.scroll){
            /** the page scrolls inside the panel (fixed height), not the window */
            var $area = $("#div-" + map.area), target = document.getElementById(map.scroll);
            if(target){
                var top = target.getBoundingClientRect().top - $area[0].getBoundingClientRect().top + $area.scrollTop();
                $area.animate({scrollTop: top - 10}, 600);
            }
        }
    }
    
    $("#copyright-year").text(new Date().getFullYear());
    window.onhashchange=()=>applyArea();
    applyArea();

    /** the backend comes from the github releases of the project, "latest" always points to the newest release */
    function getBackendDownload(){
        var os = {win: "win", mac: "mac", linux: "lnx"}[GLOBAL.platformOS] || GLOBAL.platformOS;
        var arch = {"x86-64": "amd64", "x86-32": "386", "aarch64": "arm64", "arm64": "arm64", "arm": "arm"}[GLOBAL.platformArch] || GLOBAL.platformArch;
        var exe = GLOBAL.platformOS == "win" ? ".exe" : "";
        var asset = `${BACKEND_EXEC}_${os}_${arch}${exe}`;
        var version = browser.runtime.getManifest().version;
        return {url: `${BACKEND_RELEASES}v${version}/${asset}`, asset, version, dest: BACKEND_EXEC + exe};
    }
    /** download the backend of this version's release, check its SHA-256 against the hash shipped with the extension,
        and only then let the user save it; nothing is ever run by the extension */
    async function downloadBackend(){
        var {url, asset, version, dest} = getBackendDownload();
        var sums = await fetch(browser.runtime.getURL("/backend_hashes.json")).then(r => r.ok ? r.json() : null).catch(() => null);
        var expected = sums && sums.version == version && sums.files && sums.files[asset];
        if(!expected)
            throw Error("{NO_BACKEND_CHECKSUM}".translate());
        log.info(`download backend: ${url}`);
        var r = await fetch(url, {credentials: "include", cache: "no-store"});
        if(!r.ok)
            throw Error(`download failed (${r.status}): ${url}`);
        var data = await r.arrayBuffer();
        var hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), b => b.toString(16).padStart(2, "0")).join("");
        if(hash != expected.toLowerCase()){
            log.error(`backend checksum mismatch: ${asset} is ${hash}, expected ${expected}`);
            throw Error("{BACKEND_CHECKSUM_MISMATCH}".translate());
        }
        log.info(`backend checksum verified: ${asset} sha256 ${hash}`);
        var objectURL = URL.createObjectURL(new Blob([data], {type: "application/octet-stream"}));
        try{
            return await downloadFile(objectURL, "scrapbro/" + dest, true);
        }finally{
            URL.revokeObjectURL(objectURL);
        }
    }
 
    /** the three install files are independent: each is saved once, wherever the user chooses,
        they only need to be kept together in one folder */
    var FAMILY = IS_FIREFOX ? "firefox" : "chrome";
    var CONFIG_NAME = `${NATIVE_HOST}_${FAMILY}.json`;
    var SCRIPT_NAME = GLOBAL.platformOS == "win" ? `install_${FAMILY}.bat` : `install_${FAMILY}.sh`;
    /** replaced by the install script on linux/mac, where the path must be absolute */
    var EXEC_PLACEHOLDER = "__SCRAPBRO_BACKEND__";

    function savedFolder(dwInfo){
        return dwInfo.filename.replace(/[^\\\/]*$/, "");
    }

    /** download the configuration file (native messaging host manifest) */
    $("#btnDownloadConfig").click(async function(){
        var exec = BACKEND_EXEC + (GLOBAL.platformOS == "win" ? ".exe" : "");
        var json = {"description": "ScrapBro backend",
                    "name": NATIVE_HOST,
                    /** windows: relative to this file, linux/mac: filled in by the install script */
                    "path": GLOBAL.platformOS == "win" ? exec : EXEC_PLACEHOLDER,
                    "type": "stdio"};
        if(IS_FIREFOX)
            json.allowed_extensions = [browser.runtime.id];
        else
            json.allowed_origins = [`chrome-extension://${browser.runtime.id}/`];
        try{
            var dwInfo = await downloadText(JSON.stringify(json, null, 2), `scrapbro/${CONFIG_NAME}`, null, true);
            HISTORY.setItem("backend.config.path", savedFolder(dwInfo), true, true);
            showInstallState();
        }catch(e){
            alert(e.message || e);
        }
    });

    /** download the install script */
    $("#btnDownloadScripts").click(async function(){
        try{
            var text = GLOBAL.platformOS == "win" ? installBat() : installSh();
            var dwInfo = await downloadText(text, `scrapbro/${SCRIPT_NAME}`, null, true);
            HISTORY.setItem("backend.scripts.path", savedFolder(dwInfo), true, true);
            showInstallState();
        }catch(e){
            alert(e.message || e);
        }
    });

    /** download backend */
    $("#btnDownloadBackend").click(function(){
        $("#backend-saved").removeClass("error").text("{Downloading___}".translate()).show();
        downloadBackend().then(function(dwInfo){
            /*** where the browser really saved it (the user can choose) */
            var downloadPath = dwInfo.filename.replace(/[^\\\/]*$/,"");
            if(downloadPath)
                HISTORY.setItem("backend.download.path", downloadPath, true, true);
            showInstallState();
        }).catch(e => {
            $("#backend-saved").addClass("error").text(e.message).show();
            alert(e.message);
        });
    });

    /** install page: once a file is saved, show where instead of the instructions */
    function showSaved(id, path){
        var $el = $("#" + id);
        $el.removeClass("error");
        if(path)
            $el.empty().append(document.createTextNode("{SAVED_TO}: ".translate()), $("<b>").text(path)).show();
        else
            $el.hide();
    }
    function showInstallState(){
        var family = IS_FIREFOX ? "firefox" : "chrome";
        var paths = {
            backend: HISTORY.getItem("backend.download.path"),
            config: HISTORY.getItem("backend.config.path"),
            scripts: HISTORY.getItem("backend.scripts.path"),
        };
        var buttons = {backend: "#btnDownloadBackend", config: "#btnDownloadConfig", scripts: "#btnDownloadScripts"};
        var tips = {backend: "#step1-tip", config: "#step2-tip", scripts: "#step3-tip"};
        /** a step's instructions are shown until its file is saved, the intro until the backend runs */
        for(let k in paths){
            showSaved(k + "-saved", paths[k]);
            $(buttons[k]).val((paths[k] ? "{DOWNLOAD_AGAIN}" : "{Download}").translate());
            $(tips[k]).toggle(!paths[k]);
        }
        /** nothing to reset until a file has been saved */
        $("#btnResetInstall").prop("disabled", !(paths.backend || paths.config || paths.scripts));
        var script = GLOBAL.platformOS == "win" ? `install_${family}.bat` : `bash install_${family}.sh`;
        $("#run-script").empty().append(document.createTextNode("{Execute} ".translate()), $("<b>").text(script),
                                        document.createTextNode(" (" + "{STEP3_TEXT_3}".translate() + ")"));
        $("#run-folder").empty();
        if(paths.scripts)
            $("#run-folder").append(document.createTextNode("{IN_FOLDER}: ".translate()), $("<b>").text(paths.scripts));
        /** the files only work together */
        var folders = Object.values(paths).filter(p => p);
        if(new Set(folders).size > 1)
            $("#run-folder").append($("<div class='download-path error' style='display:block'>").text("{INSTALL_SAME_FOLDER}".translate()));
    }
    /** forget where the install files were saved, shows the page as on a first install */
    $("#btnResetInstall").click(function(){
        ["backend.download.path", "backend.config.path", "backend.scripts.path"].forEach(k => HISTORY.rmItem(k));
        showInstallState();
    });
    /** configure page: the backend explanation is only needed until the backend runs */
    var backendRunning = false, backendStatusText = "";
    function showBackendStatus(version){
        backendRunning = !!version;
        if(backendRunning){
            var where = CONF.getItem("backend.type") == "address" ? CONF.getBackendAddress() : "{Port} ".translate() + CONF.getItem("backend.port");
            backendStatusText = `${"{BACKEND_RUNNING}".translate()} (${version}, ${where})`;
            $("#backend-status").text(backendStatusText).show();
        }else{
            $("#backend-status").hide();
        }
        $("#backend-tip").toggle(!backendRunning);
        showInstallState();
    }

    /** registers the configuration file next to the script (%~dp0) for the current user, no admin needed;
        firefox forks read the mozilla key too */
    function installBat(){
        var softs = IS_FIREFOX ? ["Mozilla"] : ["Google\\Chrome", "Microsoft\\Edge", "BraveSoftware\\Brave-Browser", "Chromium", "Vivaldi"];
        var keys = softs.map(soft =>
            `reg add "HKEY_CURRENT_USER\\Software\\${soft}\\NativeMessagingHosts\\${NATIVE_HOST}" /ve /d "%~dp0${CONFIG_NAME}" /f\r\n`);
        return `@echo off\r\nchcp 65001 >nul\r\n` +
            `if not exist "%~dp0${CONFIG_NAME}" (\r\n` +
            `  echo ${CONFIG_NAME} not found, save it in the same folder as this script\r\n` +
            `  pause\r\n  exit /b 1\r\n)\r\n` +
            keys.join("") +
            `echo done\r\npause\r\n`;
    }
    /** copies the configuration file into the native messaging folder of every installed browser of the family,
        with the absolute path of the program next to the script */
    function installSh(){
        var dirs;
        if(GLOBAL.platformOS == "mac"){
            var lib = "$HOME/Library/Application Support";
            dirs = IS_FIREFOX
                ? [`${lib}/Mozilla/NativeMessagingHosts`, `${lib}/LibreWolf/NativeMessagingHosts`, `${lib}/Floorp/NativeMessagingHosts`, `${lib}/Waterfox/NativeMessagingHosts`]
                : [`${lib}/Google/Chrome/NativeMessagingHosts`, `${lib}/Chromium/NativeMessagingHosts`, `${lib}/Microsoft Edge/NativeMessagingHosts`, `${lib}/BraveSoftware/Brave-Browser/NativeMessagingHosts`, `${lib}/Vivaldi/NativeMessagingHosts`];
        }else{
            dirs = IS_FIREFOX
                ? ["$HOME/.mozilla/native-messaging-hosts", "$HOME/.librewolf/native-messaging-hosts", "$HOME/.floorp/native-messaging-hosts", "$HOME/.waterfox/native-messaging-hosts"]
                : ["$HOME/.config/google-chrome/NativeMessagingHosts", "$HOME/.config/chromium/NativeMessagingHosts", "$HOME/.config/microsoft-edge/NativeMessagingHosts", "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts", "$HOME/.config/vivaldi/NativeMessagingHosts"];
        }
        var lines = [
            "#!/bin/bash",
            "set -e",
            'cd "$(dirname "$0")"',
            `if [ ! -f ${CONFIG_NAME} ] || [ ! -f ${BACKEND_EXEC} ]; then`,
            `    echo "${CONFIG_NAME} and ${BACKEND_EXEC} must be in the same folder as this script"`,
            "    exit 1",
            "fi",
            `chmod +x ${BACKEND_EXEC}`,
        ];
        if(GLOBAL.platformOS == "mac")
            lines.push(`xattr -d com.apple.quarantine ${BACKEND_EXEC} 2>/dev/null || true`);
        lines.push(
            `exec_path="$(pwd)/${BACKEND_EXEC}"`,
            "for dest in " + dirs.map(d => `"${d}"`).join(" "),
            "do",
            '    if [ -d "$(dirname "$dest")" ]; then',
            '        mkdir -p "$dest"',
            "        # the file name must match the host name, the program path must be absolute",
            `        sed "s|${EXEC_PLACEHOLDER}|$exec_path|" ${CONFIG_NAME} > "$dest/${NATIVE_HOST}.json"`,
            '        echo "installed: $dest"',
            "    fi",
            "done",
            "echo done",
            "");
        return lines.join("\n");
    }
    
    /** saveAs is only set to force the dialog: firefox takes `saveAs: false` as "never ask",
        which overrides the user's "always ask where to save" setting, chromium follows the setting either way.
        The install files always ask: they must end up together in a folder the user picks */
    function downloadOptions(url, filename, saveAs){
        var options = {url, filename, conflictAction: "overwrite"};
        if(saveAs)
            options.saveAs = true;
        return options;
    }
    function downloadFile(src, dest, saveAs=false){
        return new Promise((resolve, reject) => {
            browser.downloads.download(downloadOptions(src, dest, saveAs)).then(function(id){
                function fn(delta){
                    if(delta.id != id || !delta.state)
                        return;
                    if(delta.state.current == "complete"){
                        browser.downloads.onChanged.removeListener(fn);
                        browser.downloads.search({id}).then((downloads) => resolve(downloads[0]));
                    }else if(delta.state.current == "interrupted"){
                        browser.downloads.onChanged.removeListener(fn);
                        browser.downloads.search({id}).then((downloads) => {
                            reject(Error(`download failed (${(downloads[0] && downloads[0].error) || "interrupted"}): ${src}`));
                        });
                    }
                }
                browser.downloads.onChanged.addListener(fn);
            }).catch(reject);
        });
    }
    
    function downloadText(text, filename, callback, saveAs=false){
        /** the type must fit the extension, chromium appends ".txt" to e.g. a ".bat" saved as text/plain */
        var ext = (filename.match(/\.(\w+)$/) || [])[1];
        var type = {json: "application/json", txt: "text/plain"}[ext] || "application/octet-stream";
        var blob = new Blob([text], {type});
        var objectURL = URL.createObjectURL(blob);
        return new Promise((resolve, reject) => {
            browser.downloads.download(downloadOptions(objectURL, filename, saveAs)).then(function(id){
                function fn(delta){
                    if(delta.id != id || !delta.state)
                        return;
                    if(delta.state.current == "complete" || delta.state.current == "interrupted"){
                        browser.downloads.onChanged.removeListener(fn);
                        URL.revokeObjectURL(objectURL);
                        browser.downloads.search({id}).then((downloads) => {
                            if(delta.state.current == "complete")
                                resolve(downloads[0]);
                            else
                                reject(Error(`saving ${filename} failed: ${(downloads[0] && downloads[0].error) || "interrupted"}`));
                        });
                    }
                }
                browser.downloads.onChanged.addListener(fn);
            }).catch(function(error){
                URL.revokeObjectURL(objectURL);
                reject(error);
            });
        });
    }
    /* LOGGING: all lines are kept, debug lines are shown only with the debug option on */
    var logLines = [];
    function showDebug(){
        return CONF.getItem("global.debug") == "on";
    }
    function appendLogLine(item){
        $("<div class='log-line'/>").appendTo("#div-log .console").html(`[${item.logtype}] ${item.content}`).addClass(item.logtype);
    }
    function renderLog(){
        var $div = $("#div-log .console").empty();
        logLines.forEach(item => {
            if(item.logtype != "debug" || showDebug())
                appendLogLine(item);
        });
        $div.scrollTop($div[0].scrollHeight);
    }
    /** applies at once, no need to press save */
    $("input[name=debug]").change(function(){
        CONF.setItem("global.debug", this.checked ? "on" : "off", true, true);
        renderLog();
    });
    browser.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        var $div = $("#div-log .console");
        if(request.type == 'LOGGING'){
            var item = request.log;
            logLines.push(item);
            if(item.logtype != "debug" || showDebug()){
                var b = Math.abs($div.scrollTop() - ($div[0].scrollHeight - $div.height())) < 100;
                appendLogLine(item);
                if(b)
                    $div.scrollTop($div[0].scrollHeight - $div.height());
            }
        }else if(request.type == "BACKEND_SERVICE_STARTED"){
            initTools(request.version);
            $("input[name=backend_port]").val(CONF.getItem("backend.port"));
            showBackendStatus(request.version);
        }
    });
    
    browser.runtime.sendMessage({type: 'GET_ALL_LOG_REQUEST'}).then((response) => {
        logLines = response.logs.concat(logLines);
        renderLog();
    });
});
