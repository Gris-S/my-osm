package org.osmlocal.plans;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;

import org.json.JSONObject;

/**
 * L'alerte de descente suit le train **application fermée** (demande explicite,
 * 22 octobre 2026) : la page, en pause dans la poche, ne reçoit plus de
 * position, et l'alarme seule ne connaît que l'horaire — en retard, elle
 * vibrait trop tôt ; en avance, une fois descendu.
 *
 * Un service au premier plan, de type position, le temps d'un trajet : il lit
 * le GPS (et la position du réseau, sous terre), place le voyageur le long des
 * stations, **recale l'alarme** sur l'écart avec l'horaire, et vibre lui-même
 * dès l'avant-dernière station atteinte — comme `useTransitNavigation` le fait
 * page ouverte. Sans relevé, l'alarme recalée prend le relais. Il s'arrête à
 * l'alerte, à l'annulation, ou une demi-heure après l'arrivée prévue.
 */
public class GetOffWatchService extends Service implements LocationListener {

    private static final String CHANNEL = "get-off-watch";
    private static final int NOTIFICATION_ID = 2;
    /** Un relevé plus flou ne dit pas où est le train (la 4G d'un tunnel : 100 à 300 m). */
    private static final float MAX_ACCURACY = 300f;
    /** Écart à la ligne toléré, au moins : celui de `LINE_METERS` côté page. */
    private static final double LINE_METERS = 150;
    /** Pas de nouvelle alarme pour moins que ça : l'horaire tremble d'un relevé à l'autre. */
    private static final long RETIME_MS = 30_000;
    private static final long AFTER_ARRIVAL_MS = 30 * 60_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private double[] lats;
    private double[] lons;
    private long[] times;
    private String title;
    private String body;
    private long alarmAt;

    /** Lance le suivi (remplace le précédent). Rend faux s'il n'a pas pu démarrer : l'alarme seule reste. */
    static boolean start(Context context, long at, String title, String body, JSArray stops) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return false;
        int n = stops.length();
        double[] lats = new double[n];
        double[] lons = new double[n];
        long[] times = new long[n];
        try {
            for (int i = 0; i < n; i++) {
                JSONObject stop = stops.getJSONObject(i);
                lats[i] = stop.getDouble("lat");
                lons[i] = stop.getDouble("lon");
                times[i] = (long) stop.getDouble("at");
            }
        } catch (Exception malformed) {
            return false;
        }
        Intent intent = new Intent(context, GetOffWatchService.class)
            .putExtra("at", at).putExtra("title", title).putExtra("body", body)
            .putExtra("lats", lats).putExtra("lons", lons).putExtra("times", times);
        try {
            ContextCompat.startForegroundService(context, intent);
            return true;
        } catch (RuntimeException refused) {
            // Android refuse un service au premier plan lancé de l'arrière-plan.
            return false;
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, GetOffWatchService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getDoubleArrayExtra("lats") == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        lats = intent.getDoubleArrayExtra("lats");
        lons = intent.getDoubleArrayExtra("lons");
        times = intent.getLongArrayExtra("times");
        title = intent.getStringExtra("title");
        body = intent.getStringExtra("body");
        alarmAt = intent.getLongExtra("at", 0);

        Notification notification = notification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (RuntimeException refused) {
            stopSelf();
            return START_NOT_STICKY;
        }

        LocationManager locations = getSystemService(LocationManager.class);
        locations.removeUpdates(this);
        try {
            for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
                if (locations.getAllProviders().contains(provider)) {
                    locations.requestLocationUpdates(provider, 5_000, 0, this, Looper.getMainLooper());
                }
            }
        } catch (SecurityException refused) {
            stopSelf();
            return START_NOT_STICKY;
        }

        handler.removeCallbacksAndMessages(null);
        long end = times[times.length - 1] + AFTER_ARRIVAL_MS - System.currentTimeMillis();
        handler.postDelayed(this::stopSelf, Math.max(0, end));
        return START_NOT_STICKY;
    }

    private Notification notification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL,
                getString(R.string.get_off_watch_channel), NotificationManager.IMPORTANCE_LOW));
        }
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_get_off)
            .setContentTitle(getString(R.string.get_off_watch_title))
            .setContentText(body)
            .setOngoing(true)
            .setSilent(true);
        if (open != null) {
            builder.setContentIntent(PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }
        return builder.build();
    }

    @Override
    public void onLocationChanged(Location location) {
        if (!location.hasAccuracy() || location.getAccuracy() > MAX_ACCURACY) return;
        double position = position(lats, lons, location.getLatitude(), location.getLongitude(),
            Math.max(LINE_METERS, location.getAccuracy()));
        if (position < 0) return;
        int last = lats.length - 1;
        // Deux stations seulement : l'avant-dernière est celle de la montée.
        if (last >= 2 && position >= last - 1) {
            GetOffAlertReceiver.cancel(this);
            GetOffAlertReceiver.alert(this, title, body);
            stopSelf();
            return;
        }
        // Le train est en avance ou en retard sur l'horaire : l'alarme glisse d'autant.
        long now = System.currentTimeMillis();
        long at = Math.max(now, times[last - 1] + now - timeAt(times, position));
        if (Math.abs(at - alarmAt) < RETIME_MS) return;
        alarmAt = at;
        GetOffAlertReceiver.schedule(this, at, title, body);
    }

    /**
     * Où l'on est le long des stations, en rang fractionnaire (2,5 : à mi-chemin
     * de la quatrième), ou -1 à plus de `tolerance` mètres de la ligne.
     * shortcut: la ligne est tirée d'une station à l'autre, pas le tracé réel ; une ligne très courbe peut se tromper de tronçon — passer le tracé (`pathOf`) s'il le faut.
     */
    static double position(double[] lats, double[] lons, double lat, double lon, double tolerance) {
        double best = Double.MAX_VALUE;
        double rank = -1;
        double metersPerLon = 111_320 * Math.cos(Math.toRadians(lat));
        for (int i = 0; i < lats.length - 1; i++) {
            // Plan local en mètres autour du relevé : à l'échelle d'une ligne, il suffit.
            double ax = (lons[i] - lon) * metersPerLon, ay = (lats[i] - lat) * 110_540;
            double bx = (lons[i + 1] - lon) * metersPerLon, by = (lats[i + 1] - lat) * 110_540;
            double dx = bx - ax, dy = by - ay;
            double span = dx * dx + dy * dy;
            double t = span == 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / span));
            double distance = Math.hypot(ax + t * dx, ay + t * dy);
            if (distance < best) {
                best = distance;
                rank = i + t;
            }
        }
        return best <= tolerance ? rank : -1;
    }

    /** L'heure où l'horaire place le train au rang `position` (`timeAtPosition` côté page). */
    static long timeAt(long[] times, double position) {
        int i = (int) Math.max(0, Math.min(Math.floor(position), times.length - 1));
        long from = times[i];
        long to = times[Math.min(i + 1, times.length - 1)];
        return from + (long) ((to - from) * Math.min(1, position - i));
    }

    // Abstraites avant Android 11 : sans elles, un changement de fournisseur planterait le service.
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}

    @Override
    public void onDestroy() {
        getSystemService(LocationManager.class).removeUpdates(this);
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
