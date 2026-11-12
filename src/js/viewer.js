import {getUrlParams} from "./utils.js";
import {log} from "./message.js";
import {Configuration} from "./storage.js";
import {global} from "./global.js";
import {Injector} from "./inject.js";

window.GLOBAL = global;
window.CONF = new Configuration();

class EditToolBar{
    constructor(scrapPath, scrapId, tabId, frameId){
        var self = this;
        this.scrapPath = scrapPath;
        this.scrapId = scrapId;
        this.tabId = tabId;
        this.frameId = frameId;
        this.buildTools();
        browser.runtime.onMessage.addListener(function (request, sender, sendResponse) {
            if(request.tabId == self.tabId){
                if(request.type == "TAB_CALL" && request.message == "onmousedown"){
                    if(self.mode == "mark")
                        self.toggleStatus("unlock");
                }else if(request.type == "TAB_CALL" && request.message == "onkeydown"){
                    if(request.key == "Escape")
                        self.toggleStatus("unlock");
                }
            }
        });
        window.addEventListener("mousedown", function(e){
            if(e.button == 0) {
                /** hide marker-pen menu when click somewhere else */
                if(!$(e.target).hasClass("mark-pen-btn")){
                    if($(self.menu).is(":visible")){
                        e.preventDefault();
                        self.toggleStatus("unlock");
                    }
                }
            }
        });
    }
    isSelectionOn(){
        var selection = window.getSelection();
        if(selection && selection.rangeCount > 0){
            return !selection.getRangeAt(0).collapsed; 
        }
        return false;
    }
    saveDoc(){
        var self = this;
        browser.tabs.sendMessage(self.tabId, {type: "GET_HTML"}, {frameId: self.frameId}).then(function(code){
            browser.runtime.sendMessage({type: 'SAVE_TEXT_FILE', text:code, path: self.scrapPath + "index.html"}).then((response) => {
                alert("Content saved");
            }).catch((e) => {
                log.error(e.message);
            });
        });
    }
    showSourceDlg(){
        var self = this;
        var frame = document.body.querySelector("#contentFrame");
        var dlg = new DialogIframe('Source', `/html/source.html`, function(){
            dlg.bodyInner.innerHTML = dlg.bodyInner.innerHTML.translate();
            browser.tabs.sendMessage(self.tabId, {type: "GET_HTML"}, {frameId: self.frameId}).then(function(code){
                dlg.findChildInner("textarea").value = code;
                dlg.findChildInner("input[name='ok']").onclick = function(){
                    let html = dlg.findChildInner("textarea").value;
                    let doc = document.implementation.createHTMLDocument("New Document");
                    var publicId=null, systemId=null, doctypeName=null;
                    doc.open("text/html","replace");
                    doc.write(html);
                    var docType = null;
                    if(doc.doctype){
                        docType = {name:doc.doctype.name, publicId:doc.doctype.publicId, systemId: doc.doctype.systemId};
                    }
                    var rootAttrs = {};

                    let _html = '';
                    if(doc.documentElement){
                        Array.prototype.slice.call(doc.documentElement.attributes).forEach((item) => {
                            rootAttrs[item.name] = item.value;
                        });
                        document.title = doc.title;
                        _html = doc.documentElement.innerHTML;
                    }
                    doc.close();
                    
                    browser.tabs.sendMessage(
                        self.tabId,
                        {type: "SET_HTML", html: _html, docType, rootAttrs},
                        {frameId: self.frameId}
                    ).then(function(){
                        self.toggleStatus("unlock");    
                    }).catch((e) => {
                        log.error(e.message);
                    });
                };
                dlg.findChildInner("input[name='cancel']").onclick = function(){
                    self.toggleStatus("unlock");
                };
            });
        });
        dlg.show();
        return dlg;
    }
    async buildTools(){
        var self = this;
        /** toolbar */
        var div = this.divToolbar = document.body.querySelector(".scrapbee-edit-bar");
        var buttons = this.divToolbar.querySelectorAll("input[type=button]");
        /** tooltips, in the order of the buttons */
        ["TIP_SAVE", "TIP_DELETE_ELEMENTS", "TIP_HIGHLIGHT", "TIP_EDIT", "TIP_SOURCE_CODE", "TIP_RELOAD", "TIP_LOCATE"]
            .forEach((key, i) => buttons[i].title = chrome.i18n.getMessage(key));
        /** save button */
        buttons[0].value = chrome.i18n.getMessage("save");
        buttons[0].addEventListener("click", function(){
            self.saveDoc();
        });
        /** modify dom button (cleaning) */
        self.btnDomClean =  buttons[1];
        buttons[1].value = chrome.i18n.getMessage("MODIFY_DOM_ON");
        buttons[1].addEventListener("click", function(){
            self.toggleStatus(self.mode == "clean" ? "unlock" : "clean");
        });
        /** mark pen button */
        self.btnMarkPen = buttons[2];
        buttons[2].value = chrome.i18n.getMessage("MARK_PEN");
        buttons[2].addEventListener("click", function(e){
            self.toggleStatus(self.mode == "mark" ? "unlock" : "mark");
        });
        /** mark pen menu */
        var $m = $("<div class='scrapbee-menu'>").appendTo(this.divToolbar);
        /** marker cleaner */
        var $item = $("<div class='scrapbee-marker'>").appendTo($m).bind("mousedown", function(e){
            e.preventDefault();
            self.toggleStatus("unlock");
            browser.tabs.sendMessage(self.tabId, {type: "CLEAR_MARK_PEN"}, {frameId: self.frameId}).then(function(){});
        });
        $("<div class='scrapbee-menu-item'>").text(chrome.i18n.getMessage("CLEAR_HIGHLIGHTS")).appendTo($item);
        /** markers */
        for (let child of ["a1", "a2", "a3", "a4", "a5", "a6", "b1", "b2", "b3", "b4", "b5", "c1", "c2"]){
            var $item = $("<div class='scrapbee-marker'>").appendTo($m).bind("mousedown", function(e){
                e.preventDefault();
                self.toggleStatus("unlock");
                browser.tabs.sendMessage(self.tabId, {type: "MARK_PEN", marker: `scrapbee-marker-${child}`},
                                         {frameId: self.frameId}).then(function(){});
            });
            $(`<div class='scrapbee-menu-item scrapbee-marker-${child}'>`).text(chrome.i18n.getMessage("HIGHLIGHT_SAMPLE")).appendTo($item);
        }
        this.menu = $m[0];
        /** editing button */
        var btn = buttons[3];
        self.btnEditing = btn;
        btn.value = chrome.i18n.getMessage("EDIT_CONTENT");
        btn.addEventListener("click", function(){
            self.toggleStatus(self.mode == "edit" ? "unlock" : "edit");
        });
        /** source code button */
        var btn = buttons[4];
        btn.value = chrome.i18n.getMessage("SOURCE_CODE");
        btn.addEventListener("click", function(){
            self.toggleStatus("source");
        });
        /** reload button */
        var btn = buttons[5];
        btn.value=chrome.i18n.getMessage("Reload");
        btn.addEventListener("click", function(){
            self.toggleStatus("lock");
            browser.tabs.sendMessage(self.tabId, {type: "RELOAD"}, {frameId: self.frameId}).then(function(){});
        });
        /** locate button */
        var btn = buttons[6];
        btn.value = chrome.i18n.getMessage("LOCATE_NODE");
        btn.addEventListener("click", function(e){
            browser.runtime.sendMessage({type: 'LOCATE_ITEM', id:self.scrapId });
        });
        /** press esc to cancel actions */
        document.addEventListener("keydown", function(e){
            if(e.key == "Escape"){
                self.toggleStatus("unlock");
            }
        });
    }
    toggleStatus(mode){
        var self = this;
        if(self.mode != mode){
            if(mode == "lock"){
                $(self.divToolbar).find("input[type=button]").prop("disabled", true);
            }else if(mode == "clean" || self.mode == "clean"){
                $(self.divToolbar).find("input[type=button]").prop("disabled", true);
                browser.tabs.sendMessage(self.tabId, {type: "TOGGLE_PAGE_CLEAN"}, {frameId: self.frameId});
                self.btnDomClean.value = chrome.i18n.getMessage(mode == "clean" ? "MODIFY_DOM_OFF" : "MODIFY_DOM_ON");
                self.btnDomClean.disabled = false;
            }else if(mode == "mark" || self.mode == "mark"){
                if(mode == "mark"){
                    var rect_div = self.divToolbar.getBoundingClientRect();
                    var rect_btn = self.btnMarkPen.getBoundingClientRect();
                    // $(self.menu).css("cssText", "bottom:" + (rect_div.bottom - rect_btn.top) + "px !important; left:" + rect_btn.left + "px !important;");
                    $(self.menu).css({bottom: (rect_div.bottom - rect_btn.top) + "px", left: rect_btn.left + "px"});
                    $(self.menu).addClass("show");
                }else{
                    $(self.menu).removeClass("show");
                }
            }else if(mode == "edit" || self.mode == "edit"){
                $(self.divToolbar).find("input[type=button]").prop("disabled", true);
                browser.tabs.sendMessage(self.tabId, {type: "TOGGLE_EDITING"}, {frameId: self.frameId}).then(function(){});
                self.btnEditing.value = chrome.i18n.getMessage(mode == "edit" ? "STOP_EDIT_CONTENT" : "EDIT_CONTENT");
                self.btnEditing.disabled = false;
                browser.webNavigation.getAllFrames({tabId: self.tabId}).then((frames)=>{
                    for(var i=2; i<frames.length-1;i++){
                        browser.tabs.sendMessage(self.tabId, {type: "TOGGLE_EDITING"}, {frameId: frames[i].frameId}).then(function(){});
                    }
                });
            } else if(mode == "source" || self.mode == "source"){
                if(mode == "source"){
                    self.dlgSource = self.showSourceDlg();
                }else{
                    self.dlgSource.remove();
                }
            }
            if(mode == "unlock"){
                $(self.divToolbar).find("input[type=button]").prop("disabled", false);
            } 
            self.mode = mode;
        }
    }
}
document.addEventListener('DOMContentLoaded', async function(){
    await GLOBAL.load();
    await CONF.load();
    
    var editbar;
    var params = getUrlParams(location.search);
    var rootPath = `${params.path}/data/${params.id}`;
    var rootAddress = `${CONF.getFileServiceAddress()}${rootPath}`;
    var elFrame = document.body.querySelector("#contentFrame");
    // document.querySelector("link[rel='shortcut icon']").href= `${rootAddress}/favicon.ico`;
    browser.runtime.sendMessage({type:'GET_TAB_ID'}).then((tabId) => {
        var url = `${rootAddress}/index.html?scrapbee_refresh=` + new Date().getTime();
        /** the editing code is injected into the frame of the saved page once per load. The frame is found
            by its navigation (chromium does not list it in getAllFrames() before), or, where there are no
            navigation events for frames of extension pages (firefox), by its address after it loaded */
        var frameId, injectedThisLoad = false;
        function setup(id){
            frameId = id;
            new Injector(tabId, frameId).executeScripts(
                "/libs/browser-polyfill.min.js", "/js/proto.js", "/js/marker.js", "/libs/jquery-3.3.1.js", "/js/viewer_frame.js",
            ).then(function(){
                return browser.tabs.sendMessage(tabId, {type: "INIT", frameId, tabId}, {frameId});
            }).then((status) => {
                if(status != "ok")
                    return log.error(`viewer: editing tools did not start (${status})`);
                if(!editbar){
                    editbar = new EditToolBar(`${params.path}/data/${params.id}/`, params.id, tabId, frameId);
                    editbar.toggleStatus("lock");
                }
                editbar.frameId = frameId;
                editbar.toggleStatus("unlock");
                browser.tabs.sendMessage(tabId, {type: "GET_TITLE"}, {frameId}).then(([title, icon]) => {
                    document.title = title;
                    document.querySelector("link[rel='shortcut icon']").href = icon;
                }).catch(() => {});
            }).catch(function(e){
                log.error(`viewer: ${e.message}`);
            });
        }
        browser.webNavigation.onDOMContentLoaded.addListener((details) => {
            if(details.tabId == tabId && details.parentFrameId == 0 && (frameId === undefined || details.frameId == frameId)){
                injectedThisLoad = true;
                setup(details.frameId);
            }
        });
        elFrame.addEventListener("load", function(){
            if(injectedThisLoad){ // already done through the navigation event
                injectedThisLoad = false;
                return;
            }
            browser.webNavigation.getAllFrames({tabId}).catch(() => null).then((frames) => {
                var frame = (frames || []).find(f => f.parentFrameId == 0 && String(f.url).indexOf(rootAddress) == 0)
                         || (frames || []).find(f => f.parentFrameId == 0);
                if(frame)
                    return frame.frameId;
                /** not tracked by webNavigation: ask the frames for their address */
                return browser.scripting.executeScript({target: {tabId, allFrames: true}, func: () => location.href}).then((results) => {
                    var found = (results || []).find(r => String(r.result).indexOf(rootAddress) == 0);
                    return found ? found.frameId : undefined;
                });
            }).then((id) => {
                if(id === undefined)
                    log.error("viewer: frame of the saved page not found");
                else
                    setup(id);
            }).catch(e => log.error(`viewer: ${e.message}`));
        });
        elFrame.src = url;
    });
});
