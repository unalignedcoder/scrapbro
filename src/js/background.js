import "/libs/browser-polyfill.min.js";
import "/js/proto.js";
import {log} from "./message.js";
import {showNotification, blobToDataURL, dataURLtoBlob} from "./utils.js";
import {Injector} from "./inject.js";
import {sendTabContentMessage, sendMessageToTabs, ajaxFormPost, gtev, downloadFile} from "./utils.js";
import {Configuration, History} from "./storage.js";
import {global} from "./global.js";
import {IS_FIREFOX, NATIVE_HOST, openSidebar, isSidebarOpen, getBrowserInfo} from "./platform.js";

/* service worker: no window, use globalThis for shared objects */
globalThis.CONF = new Configuration();
globalThis.HISTORY = new History();
globalThis.GLOBAL = global;

/* logging */
var log_pool = [];
log.sendLog = function(logtype, content){
    if(typeof content != "string"){
        content = String(content);
    }
    var log = {logtype:logtype, content: content.htmlEncode()};
    log_pool.push(log);
    browser.runtime.sendMessage({type:'LOGGING', log}).catch(() => {}); // options page may not be opened
};
log.clear = function(){
    log_pool = [];
};
/* load and log version and platform */
var browser_info_loading;
function loadBrowserInfo(){
    if(!browser_info_loading){
        browser_info_loading = getBrowserInfo().then(function(info) {
            var manifest = browser.runtime.getManifest();
            log.info("version = " + manifest.version);
            log.info("browser = " + info.name + " " + info.version);
            return browser.runtime.getPlatformInfo();
        }).then((p) => {
            var os = p.os.capitalize();
            log.info(`platform = ${os} ${p.arch}`);
        });
    }
    return browser_info_loading;
}
/* the worker can be woken up by a message, handlers wait for the configuration */
var conf_loading = loadBrowserInfo().then(() => CONF.load());
conf_loading.then(() => {
    startWebServer(20, "background");
});
/* backend*/
var backend_inst_port;
var web_status = "";
var backend_version;
var backend_info = {};

function communicate(command, body){
    return new Promise((resolve, reject)=>{
        if(!backend_inst_port){
            /** an open native port also keeps the chromium service worker alive */
            backend_inst_port = browser.runtime.connectNative(NATIVE_HOST);
            backend_inst_port.onDisconnect.addListener((p) => {
                var error = p.error || browser.runtime.lastError;
                backend_inst_port = null;
                if (error) {
                    let em = `backend disconnected due to an error: ${error.message}`;
                    log.error(em);
                    reject(Error(em));
                }else{
                    let em = `backend disconnected`;
                    log.error(em);
                    reject(Error(em));
                }
            });
        }
        if(backend_inst_port.error){
            reject(backend_inst_port.error);
        }else{
            body.command = command;
            var listener = (response) => {
                resolve(response);
                backend_inst_port.onMessage.removeListener(listener);
            };
            backend_inst_port.onMessage.addListener(listener);
            backend_inst_port.postMessage(body);
        }
    });
}

/** random port below the ephemeral ranges of windows (49152+) and linux (32768+) */
function randomPort(exclude){
    var port;
    do{
        port = String(20000 + Math.floor(Math.random() * 10000));
    }while(port == exclude);
    return port;
}
function startWebServer(try_times){
    if(web_status == "failed"){
        return  Promise.reject(Error("connect web server: failed"));
    }
    function sendSuccessInfo(r){
        var version = r.Version || 'unknown';
        backend_version = version;
        GLOBAL.set("backendVersion", version);
        log.info(`connect web server: connected, version = ${version}`);
        if(!gtev(version, '1.7.3')){
            log.warning(`connect web server: backend >= 1.7.3 wanted for full functions, please install new version.`);
        }
        web_status = "launched";
        browser.runtime.sendMessage({type: 'BACKEND_SERVICE_STARTED', version}).catch(() => {});
    }
    return new Promise((resolve, reject) => {
        /** the port is not configured by the user: reuse the last one that worked, roll a new one if it is taken */
        var port = CONF.getItem("backend.port") || randomPort();
        var pwd = CONF.getItem("backend.pwd");
        const fntry = (try_times) => {
            if(web_status == "launched"){
                sendSuccessInfo(backend_info);
                resolve(backend_version);
            }else if(CONF.getItem("backend.type") == "address"){ /** connect MANUALLY MODE */
                var address = CONF.getBackendAddress();
                log.info(`connect web server: address = ${address}`);
                fetch(address + `serverinfo/?pwd=${pwd}`).then(async function(r){
                    web_status = "launched";
                    backend_info = {};
                    try{
                        var info = JSON.parse(await r.text());
                        if(info.Serverstate == "ok"){
                            backend_info = info;
                        }
                    }catch(e){} // old version backend
                    fntry(try_times);
                }).catch(function(e){
                    web_status = "failed";
                    var em = "connect web server: failed to connect backend";
                    reject(Error(em));
                });
            } else if(web_status == "launching"){ /** wait for AUTO MODE*/
                setTimeout(() => fntry(try_times), 1000);
            } else { /** connect AUTO MODE */
                web_status = "launching";
                loadBrowserInfo().then(() => {
                    log.info(`start web server: port = '${port}'. pwd = '${pwd}'`);
                    communicate("web-server", {addr: `127.0.0.1:${port}`, port, pwd}).then(function(r){
                        if(r.Serverstate != "ok"){
                            log.error(`failed to start backend service: ${r.Error}`);
                            web_status = "error";
                            if(try_times > 0){
                                port = randomPort(port);
                                fntry(try_times - 1);
                            }else{
                                web_status = "failed";
                                var ms = "connect web server: too many times tried";
                                reject(Error(ms));
                            }
                        }else{
                            /** store the port before anyone is told the backend is up */
                            var saved = Promise.resolve();
                            if(CONF.getItem("backend.port") != port){
                                CONF.setItem("backend.port", port);
                                saved = CONF.commit().catch(e => log.error(e.message));
                            }
                            saved.then(() => {
                                log.info(`start web server: listening on port ${port}`);
                                web_status = "launched";
                                backend_info = r;
                                fntry(try_times);
                            });
                        }
                    }).catch((e) => {
                        web_status = "failed";
                        log.error(e);
                        reject(e);
                    });
                });
            }
        };
        fntry(try_times);
    });
};

CONF.onchange=function(key, value){
    if(key == "__backend__"){
        web_status = "";
        CONF.load().then(() => {
            startWebServer(20);
        });
    }
};

/* sidebar (side panel in chromium) */
function waitSidebarReady(windowId, timeout=10000){
    return new Promise(resolve => {
        var started = Date.now();
        function check(){
            browser.runtime.sendMessage({type: 'IS_SIDEBAR_READY', windowId}).catch(() => false).then(ready => {
                if(ready){
                    resolve(true);
                }else if(Date.now() - started > timeout){
                    resolve(false);
                }else{
                    setTimeout(check, 300);
                }
            });
        }
        check();
    });
}
/* capture with the side panel of the tab's window, the panel must be opened by caller (user gesture) */
function captureInTab(tab, type){
    return waitSidebarReady(tab.windowId).then(ready => {
        if(!ready){
            showNotification({message: "Please open ScrapBro in sidebar before the action", title: "Info"});
        }else if(type == 'SAVE_URL_REQUEST'){
            return browser.runtime.sendMessage({type: 'SAVE_URL_REQUEST'}).catch(() => {});
        }else{
            return sendTabContentMessage(tab, {type});
        }
    });
}

/* messages handled by background, others are left for sidebar or content pages */
var handlers = {
    'LOG': function(request){
        log.sendLog(request.logtype, request.content);
    },
    'CLEAR_LOG': function(){
        log.clear();
    },
    'GET_ALL_LOG_REQUEST': function(){
        return {logs: log_pool};
    },
    'GET_BACKEND_VERSION': function(){
        return backend_version;
    },
    'SAVE_BLOB_ITEM': function(request){
        var filename = request.item.path;
        if(!request.item.blob){
            return Promise.reject(Error('empty blob'));
        }
        var file = dataURLtoBlob(request.item.blob);
        return ajaxFormPost(CONF.getBackendAddress() + "savebinfile", {filename, file, pwd: CONF.getItem("backend.pwd")});
    },
    'DOWNLOAD_FILE': function(request){
        let {url, itemId, filename} = request;
        return ajaxFormPost(CONF.getBackendAddress() + "download", {url, itemId, filename, pwd: CONF.getItem("backend.pwd")});
    },
    'SAVE_TEXT_FILE': function(request){
        if(request.backup){
            return backupFile(request.path).catch(() => {}).then(() => saveTextFile(request));
        }else{
            return saveTextFile(request);
        }
    },
    'FS_MOVE': function(request){
        let src = request.src, dest = request.dest;
        return ajaxFormPost(CONF.getBackendAddress() + "fs/move", {src, dest, pwd: CONF.getItem("backend.pwd")});
    },
    'FS_COPY': function(request){
        let src = request.src, dest = request.dest;
        return ajaxFormPost(CONF.getBackendAddress() + "fs/copy", {src, dest, pwd: CONF.getItem("backend.pwd")});
    },
    'NOTIFY': function(request){
        return showNotification(request.message, request.title, request.notify_type);
    },
    'CALL_FRAME': function(request, sender){
        request.type = request.action;
        return browser.tabs.sendMessage(sender.tab.id, request, {frameId: request.frameId});
    },
    'GET_FRAMES': function(request, sender){
        return browser.webNavigation.getAllFrames({tabId: sender.tab.id}).then((ar)=>{
            ar.shift();
            return ar;
        });
    },
    'INJECT_FRAME': function(request, sender){
        return new Injector(sender.tab.id, request.frameId).executeScripts(
            "/libs/browser-polyfill.min.js",
            "/libs/mime.types.js",
            "/libs/jquery-3.3.1.js",
            "/libs/md5.js",
            "/js/proto.js",
            "/js/dialog.js",
            "/js/content_script.js"
        ).then(() => {});
    },
    'TAB_INNER_CALL': function(request, sender){
        return browser.tabs.sendMessage(sender.tab.id, request, {frameId: request.frameId});
    },
    'GET_TAB_ID': function(request, sender){
        return sender.tab.id;
    },
    'IS_SIDEBAR_OPENED': function(request, sender){
        return isSidebarOpen(sender.tab ? sender.tab.windowId : request.windowId);
    },
    'GET_TAB_FAVICON': function(request, sender){
        return sender.tab.favIconUrl;
    },
    'GET_SETTINGS': function(){
        return GLOBAL.load().then(() => CONF.getJson());
    },
    'SAVE_HISTORY': function(request){
        return HISTORY.load().then(_ => {
            for(var k in request.items){
                HISTORY.setItem(k, request.items[k]);
            }
            HISTORY.commit();
        });
    },
    'GET_HISTORY': function(){
        return HISTORY.load().then(_ => HISTORY.getJson());
    },
    'CAPTURE_REQUEST': function(request){
        return browser.tabs.get(request.tabId).then(tab => captureInTab(tab, request.saveType));
    },
    'CAPTURE_TABS': function(request){
        return waitSidebarReady(request.windowId).then(ready => {
            if(!ready){
                showNotification({message: "Please open ScrapBro in sidebar before the action", title: "Info"});
                return;
            }
            return browser.tabs.query({windowId: request.windowId}).then(function(tabs){
                for(let tab of tabs){
                    var url = tab.url;
                    var enabled = !(/localhost.+scrapbee/.test(url)) && (/^http(s?):/.test(url) || /^file:/.test(url));
                    if(enabled)
                        sendTabContentMessage(tab, {type: 'SAVE_PAGE_REQUEST', autoClose: true}, true).catch(() => {});
                }
            });
        });
    },
    'BACKUP_FILE': function(request){
        return backupFile(request.path);
    },
    'IS_FILE': function(request){
        return ajaxFormPost(CONF.getBackendAddress() + "isfile/", {path: request.path, pwd: CONF.getItem("backend.pwd")}).then(r => r != "no");
    },
    'DOWNLOAD_FILE_BLOB': function(request){
        let url = request.url;
        // local files can not be downloaded directly
        var fs = CONF.getFileServiceAddress();
        url = url.replace(/^file\:\/{3}/, fs);
        return downloadFile(url).then(blobToDataURL);
    },
    /** fetch text for content scripts, they are restricted by CORS of the page in chrome */
    'FETCH_TEXT': function(request){
        return fetch(request.url, {cache: "no-store", credentials: "include"}).then(async r => {
            if(!r.ok)
                throw Error(`request ${r.status}: ${request.url}`);
            return r.text();
        });
    },
    'WAIT_WEB_SERVER': function(request){
        var times = request.try_times;
        if(web_status == "failed" && request.restart){
            web_status = "";
            startWebServer(request.try_times).catch(() => {});
        }
        return new Promise((resolve, reject) => {
            function check(){
                times --;
                if(web_status == "launched"){
                    resolve(backend_version);
                }else if(times < 1){
                    reject(Error("max times tried"));
                }else if(web_status == "failed"){
                    reject(Error("backend failed"));
                }else{
                    setTimeout(function(r){check();}, 1000);
                }
            }
            check();
        });
    }
};
browser.runtime.onMessage.addListener(function (request, sender) {
    var handler = handlers[request.type];
    if(!handler)
        return;
    return conf_loading.then(() => handler(request, sender));
});
function saveTextFile(request){
    var filename = request.path;
    var content = request.text;
    return ajaxFormPost(CONF.getBackendAddress() + "savefile", {filename, content, pwd: CONF.getItem("backend.pwd")}).then(response => {
        if(request.boardcast){
            var msg = {type: 'FILE_CONTENT_CHANGED', filename, srcToken:request.srcToken};
            browser.runtime.sendMessage(msg).catch(() => {});
            sendMessageToTabs(msg);
        }
        return response;
    });
}
function backupFile(src){
    try{
        var dest = src.replace(/([\\\/])([^\\\/]+?)(\.\w*)?$/, function(a, b, c, d){
            return b + "backup" + b + c + "_" + (new Date().format("yyyyMMdd")) + (d || "");
        });
    }catch(e){
        log.error(e.message);
        return Promise.reject(e);
    }
    var pwd = CONF.getItem("backend.pwd");
    return ajaxFormPost(CONF.getBackendAddress() + "isfile/", {path: dest, pwd}).then(function(r){
        if(r != "no")
            return;
        return ajaxFormPost(CONF.getBackendAddress() + "fs/copy", {src, dest, pwd}).then((response) => {
            if(response == "ok"){
                log.info(`backup success: ${dest}`);
            }else{
                log.error(`backup failed: ${response}`);
                throw Error(response);
            }
        }, (e) => {
            log.error(`backup failed: ${dest}`);
            throw e;
        });
    });
}
/* build menu, chromium persists menus (create on install/update), firefox needs them on every start */
var MENU_ACTIONS = {
    "scrapbee-capture-selection": "SAVE_SELECTION_REQUEST",
    "scrapbee-capture-page": "SAVE_PAGE_REQUEST",
    "scrapbee-capture-url": "SAVE_URL_REQUEST",
    "scrapbee-capture-advance": "SAVE_ADVANCE_REQUEST"
};
var MENU_TITLES = {
    "scrapbee-capture-selection": "CaptureSelection",
    "scrapbee-capture-page": "CapturePage",
    "scrapbee-capture-url": "CaptureUrl",
    "scrapbee-capture-advance": "CaptureAdvance"
};
function createMenus(){
    return browser.contextMenus.removeAll().then(() => {
        for(let id in MENU_TITLES){
            browser.contextMenus.create({
                id,
                title: browser.i18n.getMessage(MENU_TITLES[id]),
                contexts: ["page", "selection", "frame", "editable", "audio", "video", "link", "image"],
                documentUrlPatterns: ["http://*/*", "https://*/*", "file://*/*"]
            });
        }
    });
}
if(IS_FIREFOX)
    createMenus();
else
    browser.runtime.onInstalled.addListener(createMenus);
browser.contextMenus.onClicked.addListener(function(info, tab){
    var type = MENU_ACTIONS[info.menuItemId];
    if(!type || !tab)
        return;
    if(type == "SAVE_ADVANCE_REQUEST"){
        sendTabContentMessage(tab, {type}).catch(() => {});
        return;
    }
    /** opening the sidebar needs a user gesture, call it before any await */
    openSidebar(tab.windowId).catch(e => log.error(e.message));
    captureInTab(tab, type).catch(e => log.error(e.message));
});
/* keyboard shortcut */
browser.commands.onCommand.addListener(function(command, tab){
    if(command == "open-sidebar" && tab){
        openSidebar(tab.windowId).catch(e => log.error(e.message));
    }
});
/* update menu */
function updateMenu(url) {
    var enabled = !(new RegExp(browser.runtime.id).test(url)) && /^(http|https|file)\:\/\//.test(url);
    for(let id in MENU_ACTIONS){
        browser.contextMenus.update(id, {enabled: enabled, visible: enabled}).catch(() => {});
    }
}
browser.tabs.onUpdated.addListener(function(tabId, changeInfo, tabInfo){
    if(tabInfo.active && changeInfo.url)
        updateMenu(tabInfo.url);
});
browser.tabs.onActivated.addListener(function(activeInfo){
    browser.tabs.get(activeInfo.tabId).then((tabInfo)=>{
        updateMenu(tabInfo.url);
    }).catch(() => {});
});
