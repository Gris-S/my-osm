package org.osmlocal.plans;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Le fichier (GPX, KML, GeoJSON) qu'une autre application vient d'ouvrir avec
 * MY OSM (`app/src/services/geoFile.ts`).
 *
 * `MainActivity` le lit à l'arrivée de l'intention — la permission de lecture
 * accordée par l'expéditeur ne vaut que pour elle — et le range ici ; la page,
 * prévenue par l'adresse `myosm-file:`, vient le prendre. Un seul fichier en
 * attente : le suivant remplace le précédent, et `take` le vide.
 */
@CapacitorPlugin(name = "IncomingFile")
public class IncomingFilePlugin extends Plugin {

    private static String pendingName;
    private static String pendingText;

    static synchronized void hold(String name, String text) {
        pendingName = name;
        pendingText = text;
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (IncomingFilePlugin.class) {
            if (pendingText != null) {
                result.put("name", pendingName);
                result.put("text", pendingText);
            }
            pendingName = null;
            pendingText = null;
        }
        call.resolve(result);
    }
}
