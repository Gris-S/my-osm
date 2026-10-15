package org.osmlocal.plans;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
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
            .setContentTitle(intent.getStringExtra("title"))
            .setContentText(intent.getStringExtra("body"))
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
