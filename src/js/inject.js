// EXAMPLE:
// new Injector(tab.id, frameId)
//     .executeScripts("js/jquery.js", "js/script.js")
//     .then(s => s.injectCss("css/style.css"))
//     .then(s => console.log('done'));

function Injector(tabId, frameId) {
    this.frameId = frameId;
    this.tabId = tabId;
}
/* files are executed in order, later scripts depend on earlier ones */
Injector.prototype.executeScripts = function(fileArray) {
    fileArray = Array.prototype.slice.call(arguments).map(f => f.replace(/^\//, ""));
    return browser.scripting.executeScript({target: this.target(), files: fileArray}).then(() => this);
};
Injector.prototype.injectCss = function(fileArray) {
    fileArray = Array.prototype.slice.call(arguments).map(f => f.replace(/^\//, ""));
    return browser.scripting.insertCSS({target: this.target(), files: fileArray}).then(() => this);
};
Injector.prototype.target = function() {
    return {tabId: this.tabId, frameIds: [this.frameId || 0]};
};
export {Injector};
