/* everything that differs between the chromium (MV3) and firefox (MV2) builds lives here */

/** chromium has the side panel api, firefox the sidebar action */
const IS_CHROMIUM = !!(globalThis.chrome && chrome.sidePanel);
const IS_FIREFOX = !IS_CHROMIUM;

/** name of the native messaging host and of the backend program, see options.js for the install scripts */
const NATIVE_HOST = "scrapbro_backend";
const BACKEND_EXEC = "scrapbro_backend";
/** the settings page downloads the backend from the release of this very version (not "latest", so a reviewed version
    can only fetch the program it was reviewed with): <url>v<version>/<exec>_<os>_<arch>[.exe], os = win|lnx|mac, arch = amd64|386|arm64.
    The file is checked against the SHA-256 in backend_hashes.json, written into the package by the release workflow */
const BACKEND_RELEASES = "https://github.com/unalignedcoder/scrapbro/releases/download/";

/** must be called synchronously from a user action handler (no await before it) */
function openSidebar(windowId){
    if(IS_CHROMIUM)
        return chrome.sidePanel.open({windowId});
    return browser.sidebarAction.open();
}

async function isSidebarOpen(windowId){
    if(IS_FIREFOX)
        return browser.sidebarAction.isOpen(windowId === undefined ? {} : {windowId});
    var contexts = await browser.runtime.getContexts({contextTypes: ["SIDE_PANEL"]});
    if(windowId === undefined)
        return contexts.length > 0;
    return contexts.some(c => c.windowId == windowId || c.windowId == -1);
}

/** runtime.getBrowserInfo() is firefox only */
function getBrowserInfo(){
    if(browser.runtime.getBrowserInfo)
        return browser.runtime.getBrowserInfo();
    var brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    var brand = brands.find(b => !/Not.?A.?Brand|Chromium/i.test(b.brand))
        || brands.find(b => /Chromium/i.test(b.brand))
        || {brand: "Chrome", version: (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || ""};
    return Promise.resolve({name: brand.brand, version: brand.version});
}

export {IS_CHROMIUM, IS_FIREFOX, NATIVE_HOST, BACKEND_EXEC, BACKEND_RELEASES, openSidebar, isSidebarOpen, getBrowserInfo};
