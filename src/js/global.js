import {getBrowserInfo} from "./platform.js";
var global = {};
function __p(name, value){
    var self = global;
    self.__defineGetter__(name, function() { return value; });
}
// if(browser && browser.runtime){
//     browser.runtime.onMessage.addListener(function (request, sender, sendResponse) {
//         if(request.type == "BACKEND_SERVICE_STARTED"){
//             __p("backendVersion", request.version);
//         }
//     });
// }
global.set = function(name, value){
    __p(name, value);
}
global.load = function(){
    var self = global;
    return new Promise((resolve, reject) => {
        __p("runtimeId", browser.runtime.id);
        __p("extensionId", browser.i18n.getMessage("@@extension_id"));
        if(browser && browser.runtime){
            getBrowserInfo().then(function(info) {
                __p("browserName", info.name);
                __p("browserVersion", info.version);
                var manifest = browser.runtime.getManifest();
                // __p("extensionVersion", manifest.manifest_version);
                __p("extensionVersion", manifest.version);
                browser.runtime.getPlatformInfo().then((p)=>{
                    __p("fsPathSeparator", p.os == 'win' ? '\\' : '/');
                    __p("platformOS", p.os);
                    __p("platformArch", p.arch);
                    if(global.backendVersion){
                        resolve();
                    }else{
                        browser.runtime.sendMessage({type: 'GET_BACKEND_VERSION'}).then((v)=>{
                            __p("backendVersion", v);
                            resolve();
                        }).catch(() => resolve()); // no receiver when called in background
                    }
                });
            });
        }else{
            resolve();
        }
    });
};

export {global};
