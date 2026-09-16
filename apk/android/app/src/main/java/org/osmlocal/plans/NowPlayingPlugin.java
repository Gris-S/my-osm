package org.osmlocal.plans;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * La musique en cours, pour l'encart du guidage.
 *
 * Fonctionne avec **tout** lecteur qui publie une session média — YouTube Music,
 * Qobuz, Spotify, un podcast… — sans rien connaître de lui : titre, artiste,
 * pochette, lecture ou pause, et les commandes pause / suivant / précédent.
 *
 * Android exige pour cela « l'accès aux notifications » (voir
 * `MediaNotificationListener`), accordé une fois par l'utilisateur dans les
 * réglages du téléphone ; `openSettings` l'y emmène.
 *
 * Chaque changement part sous l'événement `change` : `{ permission, track }`,
 * `track` valant `null` quand rien ne joue. L'écoute n'est active qu'entre
 * `start` et `stop` (la page ne la demande que pendant un guidage), et elle est
 * coupée quand l'application passe en arrière-plan.
 */
@CapacitorPlugin(name = "NowPlaying")
public class NowPlayingPlugin extends Plugin {

    /** Côté de la pochette envoyée à la page : assez pour 44 px à l'écran, en haute densité. */
    private static final int ARTWORK_SIZE = 160;

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaSessionManager sessions;
    private ComponentName listenerComponent;
    private boolean wanted = false;
    private boolean listening = false;
    private MediaController controller;

    private final MediaSessionManager.OnActiveSessionsChangedListener sessionsChanged = (list) -> main.post(() -> pick(list));

    private final MediaController.Callback callback = new MediaController.Callback() {
        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            emit();
        }

        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            emit();
        }

        @Override
        public void onSessionDestroyed() {
            main.post(() -> refresh());
        }
    };

    @Override
    public void load() {
        sessions = (MediaSessionManager) getContext().getSystemService(Context.MEDIA_SESSION_SERVICE);
        listenerComponent = new ComponentName(getContext(), MediaNotificationListener.class);
    }

    private boolean hasAccess() {
        return NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("permission", hasAccess());
        call.resolve(result);
    }

    /** Ouvre la page des réglages où l'on autorise MY OSM, au plus près de l'interrupteur. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS);
            intent.putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, listenerComponent.flattenToString());
        } else {
            intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (Exception detailMissing) {
            // Certains constructeurs n'ont pas la page détaillée : la liste générale.
            getContext().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    /**
     * Ouvre le lecteur qui publie la session en cours.
     *
     * On passe par l'intention de lancement que le système associe au paquet :
     * c'est la seule façon d'ouvrir une application tierce sans rien connaître
     * d'elle. Un lecteur sans intention de lancement — certains services de
     * fond n'en ont pas — laisse simplement le doigt sans effet, plutôt que de
     * faire échouer l'appel.
     */
    @PluginMethod
    public void openPlayer(PluginCall call) {
        MediaController current = controller;
        if (current == null) {
            call.reject("Aucune musique en cours.");
            return;
        }
        PackageManager manager = getContext().getPackageManager();
        Intent launch = manager.getLaunchIntentForPackage(current.getPackageName());
        if (launch == null) {
            call.resolve(new JSObject().put("opened", false));
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(launch);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception unavailable) {
            call.resolve(new JSObject().put("opened", false));
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        wanted = true;
        main.post(this::listen);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        wanted = false;
        main.post(this::unlisten);
        call.resolve();
    }

    @PluginMethod
    public void control(PluginCall call) {
        String action = call.getString("action", "");
        main.post(() -> {
            MediaController current = controller;
            if (current == null) {
                call.reject("Aucune musique en cours.");
                return;
            }
            MediaController.TransportControls transport = current.getTransportControls();
            switch (action) {
                case "playPause":
                    PlaybackState state = current.getPlaybackState();
                    if (state != null && state.getState() == PlaybackState.STATE_PLAYING) transport.pause();
                    else transport.play();
                    break;
                case "next":
                    transport.skipToNext();
                    break;
                case "previous":
                    transport.skipToPrevious();
                    break;
                default:
                    call.reject("Action inconnue : " + action);
                    return;
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnResume() {
        // Au retour des réglages Android, l'accès vient peut-être d'être accordé.
        if (wanted) listen();
    }

    @Override
    protected void handleOnPause() {
        unlisten();
    }

    @Override
    protected void handleOnDestroy() {
        unlisten();
    }

    private void listen() {
        if (listening) {
            refresh();
            return;
        }
        if (!hasAccess()) {
            emitNothing(false);
            return;
        }
        try {
            sessions.addOnActiveSessionsChangedListener(sessionsChanged, listenerComponent, main);
            listening = true;
            refresh();
        } catch (SecurityException refused) {
            emitNothing(false);
        }
    }

    private void unlisten() {
        if (listening) {
            try {
                sessions.removeOnActiveSessionsChangedListener(sessionsChanged);
            } catch (Exception ignored) {
                // déjà retiré
            }
            listening = false;
        }
        use(null);
    }

    private void refresh() {
        try {
            pick(sessions.getActiveSessions(listenerComponent));
        } catch (SecurityException revoked) {
            use(null);
            emitNothing(false);
        }
    }

    /**
     * Le lecteur à montrer : celui qui joue, sinon le plus récent qui a un titre
     * (en pause). Android classe la liste du plus récent au plus ancien.
     */
    private void pick(List<MediaController> list) {
        MediaController best = null;
        if (list != null) {
            for (MediaController candidate : list) {
                PlaybackState state = candidate.getPlaybackState();
                if (state != null && state.getState() == PlaybackState.STATE_PLAYING) {
                    best = candidate;
                    break;
                }
            }
            if (best == null) {
                for (MediaController candidate : list) {
                    if (candidate.getMetadata() != null) {
                        best = candidate;
                        break;
                    }
                }
            }
        }
        use(best);
        emit();
    }

    private void use(MediaController next) {
        if (controller != null && (next == null || !controller.getSessionToken().equals(next.getSessionToken()))) {
            controller.unregisterCallback(callback);
            controller = null;
        }
        if (next != null && controller == null) {
            controller = next;
            controller.registerCallback(callback, main);
        }
    }

    private void emit() {
        MediaController current = controller;
        MediaMetadata metadata = current != null ? current.getMetadata() : null;
        PlaybackState playback = current != null ? current.getPlaybackState() : null;
        int state = playback != null ? playback.getState() : PlaybackState.STATE_NONE;
        // Un lecteur arrêté ou en erreur n'a rien à montrer : pas d'encart.
        if (metadata == null || state == PlaybackState.STATE_NONE || state == PlaybackState.STATE_STOPPED || state == PlaybackState.STATE_ERROR) {
            emitNothing(true);
            return;
        }

        JSObject track = new JSObject();
        track.put("title", firstText(metadata, MediaMetadata.METADATA_KEY_TITLE, MediaMetadata.METADATA_KEY_DISPLAY_TITLE));
        track.put("artist", firstText(metadata, MediaMetadata.METADATA_KEY_ARTIST, MediaMetadata.METADATA_KEY_ALBUM_ARTIST, MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE));
        track.put("album", firstText(metadata, MediaMetadata.METADATA_KEY_ALBUM));
        track.put("app", appLabel(current.getPackageName()));
        // Le nom de paquet, en plus du libellé : c'est lui qui permet d'ouvrir
        // le lecteur d'un doigt sur la pochette (`openPlayer`). Le libellé, lui,
        // ne désigne rien pour le système.
        track.put("package", current.getPackageName());
        track.put("playing", state == PlaybackState.STATE_PLAYING || state == PlaybackState.STATE_BUFFERING);
        String artwork = artwork(metadata);
        if (artwork != null) track.put("artwork", artwork);

        JSObject data = new JSObject();
        data.put("permission", true);
        data.put("track", track);
        notifyListeners("change", data, true);
    }

    private void emitNothing(boolean permission) {
        JSObject data = new JSObject();
        data.put("permission", permission);
        data.put("track", JSONObject.NULL);
        notifyListeners("change", data, true);
    }

    private static String firstText(MediaMetadata metadata, String... keys) {
        for (String key : keys) {
            CharSequence value = metadata.getText(key);
            if (value != null && value.length() > 0) return value.toString();
        }
        return "";
    }

    private String appLabel(String packageName) {
        try {
            PackageManager manager = getContext().getPackageManager();
            ApplicationInfo info = manager.getApplicationInfo(packageName, 0);
            return manager.getApplicationLabel(info).toString();
        } catch (Exception unknown) {
            return "";
        }
    }

    /** La pochette réduite, en `data:` URL : la page n'a aucun accès aux fichiers du lecteur. */
    private static String artwork(MediaMetadata metadata) {
        Bitmap source = metadata.getBitmap(MediaMetadata.METADATA_KEY_ART);
        if (source == null) source = metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
        if (source == null) source = metadata.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
        if (source == null || source.getWidth() == 0 || source.getHeight() == 0) return null;
        try {
            int width = ARTWORK_SIZE;
            int height = Math.max(1, Math.round(ARTWORK_SIZE * (float) source.getHeight() / source.getWidth()));
            Bitmap scaled = Bitmap.createScaledBitmap(source, width, height, true);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 80, out);
            if (scaled != source) scaled.recycle();
            return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception unreadable) {
            return null;
        }
    }
}
