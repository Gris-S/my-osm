package org.osmlocal.plans;

import android.content.Intent;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.net.Uri;
import android.os.Bundle;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Greffons propres à l'application : ils doivent être enregistrés avant
        // `super.onCreate`, qui construit le pont natif.
        registerPlugin(AmbientLightPlugin.class); // thème « Automatique »
        registerPlugin(NowPlayingPlugin.class); // musique en cours, pendant le guidage
        registerPlugin(DeviceStoragePlugin.class); // place libre, pour les cartes hors ligne
        registerPlugin(WebSearchPlugin.class); // recherche sur le web, navigateur intégré
        registerPlugin(SpeechPlugin.class); // annonces vocales du guidage voiture
        registerPlugin(GetOffAlertPlugin.class); // alerte de descente, en transports
        registerPlugin(IncomingFilePlugin.class); // fichiers GPX, KML, GeoJSON ouverts avec MY OSM
        setIntent(asViewIntent(getIntent()));
        super.onCreate(savedInstanceState);
        hideStatusBar();
    }

    /**
     * Un texte partagé vers MY OSM arrive en `ACTION_SEND`, que le greffon `App`
     * de Capacitor ne relaie pas : il est réécrit en adresse `myosm-share:?text=…`,
     * qui prend le même chemin qu'un lien `geo:` (`app/src/services/incoming.ts`).
     */
    @Override
    protected void onNewIntent(Intent intent) {
        Intent view = asViewIntent(intent);
        setIntent(view);
        super.onNewIntent(view);
    }

    private Intent asViewIntent(Intent intent) {
        Intent file = asFileIntent(intent);
        if (file != null) return file;
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return intent;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null) return intent;
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        String body = subject != null && !text.toString().contains(subject) ? subject + "\n" + text : text.toString();
        return new Intent(Intent.ACTION_VIEW, Uri.parse("myosm-share:?text=" + Uri.encode(body)));
    }

    /** Au-delà, le fichier n'est pas lu (`GEO_FILE_MAX_CHARS` côté page). */
    private static final int MAX_FILE_BYTES = 20_000_000;

    /**
     * Un fichier ouvert ou partagé vers MY OSM (`content://`) : il est lu tout
     * de suite, tant que la permission de l'expéditeur vaut, rangé dans
     * `IncomingFilePlugin`, et l'intention devient `myosm-file:?name=…`, qui
     * prend le chemin des liens (`app/src/services/incoming.ts`). `null` si ce
     * n'est pas un fichier, ou s'il ne se lit pas.
     */
    @SuppressWarnings("deprecation")
    private Intent asFileIntent(Intent intent) {
        if (intent == null) return null;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null || !"content".equals(uri.getScheme())) return null;
        String name = "";
        try (Cursor cursor = getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
        } catch (RuntimeException ignored) {
            // Sans nom : la page en donnera un.
        }
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) return null;
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                bytes.write(buffer, 0, read);
                if (bytes.size() > MAX_FILE_BYTES) return null;
            }
            IncomingFilePlugin.hold(name == null ? "" : name, bytes.toString("UTF-8"));
        } catch (IOException | SecurityException refused) {
            return null;
        }
        return new Intent(Intent.ACTION_VIEW, Uri.parse("myosm-file:?name=" + Uri.encode(name == null ? "" : name)));
    }

    @Override
    public void onResume() {
        super.onResume();
        hideStatusBar();
    }

    /**
     * Le greffon `SystemBars` de Capacitor réaffiche toutes les barres à son
     * chargement, et Android les rend au retour d'un autre écran : la barre est
     * donc re-masquée chaque fois que l'application reprend le focus.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideStatusBar();
    }

    /**
     * Barre d'état masquée : l'heure, les notifications et la batterie
     * recouvraient les boutons du haut de la carte, et un contact trop près du
     * bord ouvrait le volet des notifications au lieu du bouton visé. Un
     * glissement depuis le haut la fait réapparaître un instant. La barre de
     * navigation du bas, elle, reste : elle ne gêne pas.
     */
    private void hideStatusBar() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.statusBars());
    }
}
