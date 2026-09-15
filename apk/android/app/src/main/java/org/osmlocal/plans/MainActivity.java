package org.osmlocal.plans;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

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

    private static Intent asViewIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return intent;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null) return intent;
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        String body = subject != null && !text.toString().contains(subject) ? subject + "\n" + text : text.toString();
        return new Intent(Intent.ACTION_VIEW, Uri.parse("myosm-share:?text=" + Uri.encode(body)));
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
