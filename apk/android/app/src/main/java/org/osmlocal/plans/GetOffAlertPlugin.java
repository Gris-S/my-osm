package org.osmlocal.plans;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * L'alerte de descente des transports (`app/src/navigation/getOffAlert.ts`).
 *
 * Téléphone dans la poche, la WebView est en pause : une vibration lancée par
 * la page ne partirait jamais. L'alerte est donc **une alarme d'Android**,
 * programmée à l'avance sur l'horaire du train, que `GetOffAlertReceiver`
 * transforme en vibration forte et en notification — écran éteint, hors ligne,
 * sous terre. Une seule alerte à la fois : en programmer une remplace la
 * précédente.
 *
 * L'heure est tenue à la seconde grâce à `USE_EXACT_ALARM`, accordée à
 * l'installation depuis Android 13. Sur Android 12, il faut « Alarmes et
 * rappels » (`SCHEDULE_EXACT_ALARM`) ; sans elle, Android peut retarder
 * l'alarme quand le téléphone dort, et `status` le dit.
 */
@CapacitorPlugin(
    name = "GetOffAlert",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class GetOffAlertPlugin extends Plugin {

    @PluginMethod
    public void schedule(PluginCall call) {
        // `Date.now()` arrive en entier : `getDouble` le rendrait nul.
        if (!call.getData().has("at")) {
            call.reject("at manquant");
            return;
        }
        long at = (long) call.getData().optDouble("at");
        String title = call.getString("title");
        String body = call.getString("body");
        String key = call.getString("key");
        if (GetOffAlertReceiver.alreadyGiven(getContext(), key)) {
            JSObject given = new JSObject();
            given.put("exact", GetOffAlertReceiver.exactAllowed(getContext()));
            given.put("watching", false);
            call.resolve(given);
            return;
        }
        GetOffAlertReceiver.arm(getContext(), key);
        boolean exact = GetOffAlertReceiver.schedule(getContext(), at, title, body);
        // Les stations de la ligne : le GPS suit le train, application fermée.
        JSArray stops = call.getArray("stops");
        boolean watching = stops != null && stops.length() >= 2
            && GetOffWatchService.start(getContext(), at, title, body, stops);
        if (!watching) GetOffWatchService.stop(getContext());
        JSObject result = new JSObject();
        result.put("exact", exact);
        result.put("watching", watching);
        call.resolve(result);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        GetOffAlertReceiver.cancel(getContext());
        GetOffWatchService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("notifications", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        result.put("exact", GetOffAlertReceiver.exactAllowed(getContext()));
        call.resolve(result);
    }

    /** La permission des notifications (Android 13+) ; avant, elle est acquise. */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            status(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsAnswered");
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        status(call);
    }

    /** Ouvre « Alarmes et rappels » pour MY OSM ; l'application relit l'état au retour. */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }
}
