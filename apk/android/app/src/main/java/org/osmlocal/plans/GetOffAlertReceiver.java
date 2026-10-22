package org.osmlocal.plans;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * L'alarme de `GetOffAlertPlugin` est arrivée : vibrer fort et prévenir.
 *
 * La vibration est lancée directement, à pleine amplitude et rangée comme une
 * alarme : celle d'une notification suit le réglage d'intensité du téléphone,
 * souvent bas, et c'est une secousse qui se sent dans la poche qui est demandée.
 * La notification la double au cas où le vibreur serait refusé, et dit où
 * descendre ; la toucher rouvre l'application.
 */
public class GetOffAlertReceiver extends BroadcastReceiver {

    static final String CHANNEL = "get-off";
    // Court-court-long, trois fois (demande explicite, 15 octobre 2026) : un
    // rythme qui ne ressemble pas à une notification se remarque mieux, la
    // puissance étant déjà au maximum du moteur. Pauses aux rangs pairs.
    private static final long[] PATTERN = {
        0, 200, 150, 200, 150, 1000,
        600, 200, 150, 200, 150, 1000,
        600, 200, 150, 200, 150, 1000,
    };

    /** Pleine amplitude pendant chaque secousse, rien pendant les pauses. */
    private static int[] amplitudes() {
        int[] amplitudes = new int[PATTERN.length];
        for (int i = 1; i < amplitudes.length; i += 2) amplitudes[i] = 255;
        return amplitudes;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        // L'horaire a parlé avant le GPS : le suivi n'a plus d'objet.
        GetOffWatchService.stop(context);
        alert(context, intent.getStringExtra("title"), intent.getStringExtra("body"));
    }

    /** L'alarme de l'alerte : une seule à la fois, la même pour la programmer et l'annuler. */
    static PendingIntent pending(Context context, String title, String body) {
        Intent intent = new Intent(context, GetOffAlertReceiver.class);
        if (title != null) intent.putExtra("title", title);
        if (body != null) intent.putExtra("body", body);
        return PendingIntent.getBroadcast(context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean exactAllowed(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    /** Programme l'alerte à `at` (remplace la précédente). Rend vrai si l'heure sera tenue à la seconde. */
    static boolean schedule(Context context, long at, String title, String body) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        PendingIntent intent = pending(context, title, body);
        boolean exact = exactAllowed(context);
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
        return exact;
    }

    static void cancel(Context context) {
        context.getSystemService(AlarmManager.class).cancel(pending(context, null, null));
    }

    // La ligne de l'alerte programmée, puis celle de la dernière alerte donnée :
    // rouverte après une alerte du suivi (`GetOffWatchService`), la page
    // reprogrammerait sinon la même ligne, et le téléphone vibrerait deux fois.
    private static SharedPreferences memory(Context context) {
        return context.getSharedPreferences("get-off", Context.MODE_PRIVATE);
    }

    static void arm(Context context, String key) {
        memory(context).edit().putString("armed", key).apply();
    }

    static boolean alreadyGiven(Context context, String key) {
        return key != null && key.equals(memory(context).getString("given", null));
    }

    /** Vibre et prévient, tout de suite. */
    static void alert(Context context, String title, String body) {
        memory(context).edit().putString("given", memory(context).getString("armed", null)).apply();
        vibrate(context);

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL,
                context.getString(R.string.get_off_channel), NotificationManager.IMPORTANCE_HIGH);
            channel.enableVibration(true);
            channel.setVibrationPattern(PATTERN);
            manager.createNotificationChannel(channel);
        }

        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent tap = open == null ? null
            : PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_get_off)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVibrate(PATTERN)
            .setAutoCancel(true)
            .setTimeoutAfter(10 * 60_000);
        if (tap != null) builder.setContentIntent(tap);
        try {
            NotificationManagerCompat.from(context).notify(1, builder.build());
        } catch (SecurityException refused) {
            // Notifications refusées : la vibration seule a été donnée.
        }
    }

    private static void vibrate(Context context) {
        Vibrator vibrator = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? context.getSystemService(VibratorManager.class).getDefaultVibrator()
            : (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator.vibrate(VibrationEffect.createWaveform(PATTERN, amplitudes(), -1),
                VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(PATTERN, amplitudes(), -1),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
        } else {
            vibrator.vibrate(PATTERN, -1);
        }
    }
}
