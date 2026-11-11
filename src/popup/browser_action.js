import {sendTabContentMessage} from "/js/utils.js";
import {openSidebar as platformOpenSidebar} from "/js/platform.js";

window.onload=async function(){
    document.body.innerHTML = document.body.innerHTML.translate();
    /** opening the sidebar needs a user gesture: get the tab first, open the panel synchronously in click handlers */
    var [activeTab] = await browser.tabs.query({currentWindow: true, active: true});
    function openSidebar(){
        return platformOpenSidebar(activeTab.windowId);
    }
    /** background waits for the side panel to load the tree, then captures */
    function captureWithSidebar(saveType){
        openSidebar().catch(() => {});
        browser.runtime.sendMessage({type: "CAPTURE_REQUEST", saveType, tabId: activeTab.id}).catch(() => {});
        window.close();
    }
    $("#btnHelp").click(function(){
        browser.tabs.create({"url": "/html/options.html#area=help"});
        window.close();
    });
    $("#btnSetting").click(function(){
        browser.tabs.create({"url": "/html/options.html"});
        window.close();
    });
    $("#btnTools").click(function(){
        browser.tabs.create({"url": "/html/options.html#area=tools"});
        window.close();
    });
    $("#btnOpenInSidebar").click(function(){
        openSidebar().finally(() => window.close());
    });
    $("#btnCapturePage").click(function(){
        if(this.getAttribute("disabled") == "true")
            return;
        captureWithSidebar('SAVE_PAGE_REQUEST');
    });
    $("#btnCaptureSelection").click(function(){
        if(this.getAttribute("disabled") == "true")
            return;
        captureWithSidebar('SAVE_SELECTION_REQUEST');
    });
    $("#btnCaptureTabs").click(function(){
        openSidebar().catch(() => {});
        browser.runtime.sendMessage({type: "CAPTURE_TABS", windowId: activeTab.windowId}).catch(() => {});
        window.close();
    });
    $("#btnCaptureUrl").click(function(){
        if(this.getAttribute("disabled") == "true")
            return;
        captureWithSidebar('SAVE_URL_REQUEST');
    });
    $("#btnCaptureAdv").click(function(){
        if(this.getAttribute("disabled") == "true")
            return;
        sendTabContentMessage(activeTab, {type: 'SAVE_ADVANCE_REQUEST'}).then(function(){
            window.close();
        }).catch(function(e){
            window.close();
        });
    });
    let url = activeTab.url || "";
    var enabled = !(new RegExp(browser.runtime.id).test(url)) && /^(http|https|file)\:\/\//.test(url);
    let attr = enabled ? "false" : "true";
    $("#btnCapturePage")[0].setAttribute("disabled", attr);
    $("#btnCaptureSelection")[0].setAttribute("disabled", attr);
    $("#btnCaptureUrl")[0].setAttribute("disabled", attr);
    $("#btnCaptureAdv")[0].setAttribute("disabled", attr)
}
