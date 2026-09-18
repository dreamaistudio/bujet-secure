package com.thisara.budgetsecure;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppUpdatePlugin")
public class AppUpdatePlugin extends Plugin {

    @PluginMethod
    public void getDistributionFlavor(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("flavor", "store");
        call.resolve(ret);
    }

    @PluginMethod
    public void startDownload(PluginCall call) {
        call.reject("Self-updating is disabled in store builds. Updates are managed by the store.");
    }

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("canInstall", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        call.reject("Self-updating is disabled in store builds. Updates are managed by the store.");
    }
}
