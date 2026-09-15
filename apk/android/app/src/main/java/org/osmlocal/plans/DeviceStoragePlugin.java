package org.osmlocal.plans;

import android.os.StatFs;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * La place libre sur le stockage interne de l'application, là où vivent les
 * cartes hors ligne (`app/src/services/offline/deviceStore.ts`).
 *
 * Aucune API web ne la donne : `navigator.storage.estimate()` parle du quota de
 * la WebView, pas du disque. Elle sert à prévenir avant un téléchargement qui
 * ne tiendrait pas, et à reconnaître un stockage plein quand une écriture est
 * refusée — le greffon Filesystem rend alors une erreur générique.
 */
@CapacitorPlugin(name = "DeviceStorage")
public class DeviceStoragePlugin extends Plugin {

    @PluginMethod
    public void free(PluginCall call) {
        try {
            StatFs stat = new StatFs(getContext().getFilesDir().getPath());
            JSObject result = new JSObject();
            result.put("bytes", stat.getAvailableBytes());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Place libre illisible", e);
        }
    }
}
