package org.osmlocal.plans;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

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
 * L'heure n'est tenue à la seconde que si « Alarmes et rappels » est accordé
 * (`SCHEDULE_EXACT_ALARM`, refusé d'office depuis Android 14) ; sinon Android
 * peut la retarder quand le téléphone dort, et `status` le dit.
 */
@CapacitorPlugin(
    name = "GetOffAlert",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class GetOffAlertPlugin extends Plugin {

    private PendingIntent pending(String title, String body) {
        Intent intent = new Intent(getContext(), GetOffAlertReceiver.class);
        if (title != null) intent.putExtra("title", title);
        if (body != null) intent.putExtra("body", body);
        return PendingIntent.getBroadcast(getContext(), 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private AlarmManager alarms() {
        return (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
    }

    private boolean exactAllowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms().canScheduleExactAlarms();
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        // `Date.now()` arrive en entier : `getDouble` le rendrait nul.
        if (!call.getData().has("at")) {
            call.reject("at manquant");
            return;
        }
        long at = (long) call.getData().optDouble("at");
        PendingIntent intent = pending(call.getString("title"), call.getString("body"));
        boolean exact = exactAllowed();
        if (exact) alarms().setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
        else alarms().setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
        JSObject result = new JSObject();
        result.put("exact", exact);
        call.resolve(result);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        alarms().cancel(pending(null, null));
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("notifications", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        result.put("exact", exactAllowed());
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
