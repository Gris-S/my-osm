package org.osmlocal.plans;

import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * La voix du guidage voiture (`app/src/navigation/voice.ts`).
 *
 * Une WebView Android n'a pas de synthèse vocale (`speechSynthesis` y est
 * absent) : ce greffon passe par celle du téléphone, `TextToSpeech`, c'est-à-dire
 * par le moteur que l'utilisateur a installé — celui de Google sur un Pixel,
 * RHVoice ou eSpeak ailleurs. La synthèse se fait sur l'appareil ; rien de ce
 * qui est dit ne part d'ici vers le réseau. Sans moteur, `isAvailable` répond
 * non et l'application grise son bouton.
 *
 * Le moteur n'est lié qu'à la première demande, pas au lancement : qui ne se
 * sert pas de la voix ne le réveille jamais. Pendant une annonce, la musique
 * baisse (`AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`) puis reprend son niveau.
 */
@CapacitorPlugin(name = "Speech")
public class SpeechPlugin extends Plugin {

    private TextToSpeech tts;
    private boolean ready = false;
    private boolean failed = false;
    private final List<PluginCall> waiting = new ArrayList<>();
    private AudioManager audio;
    private AudioFocusRequest focus;
    private int sequence = 0;

    private final AudioAttributes attributes = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build();

    @PluginMethod
    public synchronized void isAvailable(PluginCall call) {
        if (ready || failed) {
            answer(call);
            return;
        }
        waiting.add(call);
        if (tts != null) return;
        tts = new TextToSpeech(getContext().getApplicationContext(), status -> {
            synchronized (SpeechPlugin.this) {
                ready = status == TextToSpeech.SUCCESS;
                failed = !ready;
                if (ready) {
                    tts.setAudioAttributes(attributes);
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String id) {
                            requestFocus();
                        }

                        @Override
                        public void onDone(String id) {
                            // La dernière annonce de la file : la musique reprend.
                            if (id.equals(String.valueOf(sequence))) abandonFocus();
                        }

                        @Override
                        public void onError(String id) {
                            abandonFocus();
                        }
                    });
                }
                for (PluginCall pending : waiting) answer(pending);
                waiting.clear();
            }
        });
    }

    private void answer(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", ready);
        call.resolve(result);
    }

    @PluginMethod
    public synchronized void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (!ready || text == null || text.isEmpty()) {
            call.reject("Pas de synthèse vocale.");
            return;
        }
        // La voix choisie dans les réglages, si elle existe encore ; sinon la
        // langue, et le moteur prend sa voix par défaut.
        String wanted = call.getString("voice", "");
        Voice chosen = null;
        if (wanted != null && !wanted.isEmpty()) {
            try {
                java.util.Set<Voice> all = tts.getVoices();
                if (all != null) for (Voice voice : all) if (wanted.equals(voice.getName())) chosen = voice;
            } catch (Exception e) {
                // Moteur capricieux : on retombe sur la langue.
            }
        }
        String lang = call.getString("lang", "");
        if (chosen != null) tts.setVoice(chosen);
        else if (lang != null && !lang.isEmpty()) tts.setLanguage(Locale.forLanguageTag(lang));
        boolean flush = Boolean.TRUE.equals(call.getBoolean("flush", false));
        sequence++;
        tts.speak(text, flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, String.valueOf(sequence));
        call.resolve();
    }

    /**
     * Les voix du moteur : son nom, sa langue, sa qualité, si elle demande le
     * réseau, et si elle est déjà sur le téléphone. Android ne dit **pas** si
     * une voix est masculine ou féminine : il n'y a que son nom.
     */
    @PluginMethod
    public synchronized void voices(PluginCall call) {
        if (!ready) {
            call.reject("Pas de synthèse vocale.");
            return;
        }
        JSArray list = new JSArray();
        try {
            java.util.Set<Voice> all = tts.getVoices();
            if (all != null) {
                for (Voice voice : all) {
                    JSObject item = new JSObject();
                    item.put("name", voice.getName());
                    item.put("locale", voice.getLocale().toLanguageTag());
                    item.put("quality", voice.getQuality());
                    item.put("network", voice.isNetworkConnectionRequired());
                    item.put("installed", !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED));
                    list.put(item);
                }
            }
        } catch (Exception e) {
            // Certains moteurs lèvent ici : une liste vide vaut mieux qu'un plantage.
        }
        JSObject result = new JSObject();
        result.put("voices", list);
        result.put("engine", tts.getDefaultEngine());
        Voice current = tts.getVoice();
        result.put("current", current != null ? current.getName() : null);
        call.resolve(result);
    }

    /**
     * Ouvre l'écran du moteur où l'on télécharge des voix. L'application ne
     * peut pas le faire elle-même : c'est le moteur qui télécharge, et
     * l'utilisateur qui valide.
     */
    @PluginMethod
    public synchronized void installVoices(PluginCall call) {
        try {
            Intent intent = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
            if (tts != null && tts.getDefaultEngine() != null) intent.setPackage(tts.getDefaultEngine());
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Réglages de la synthèse vocale introuvables.", e);
        }
    }

    @PluginMethod
    public synchronized void stop(PluginCall call) {
        if (tts != null) tts.stop();
        abandonFocus();
        call.resolve();
    }

    private void requestFocus() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (audio == null) audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;
        if (focus == null) {
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes)
                .build();
        }
        audio.requestAudioFocus(focus);
    }

    private void abandonFocus() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (audio != null && focus != null) audio.abandonAudioFocusRequest(focus);
    }

    @Override
    protected synchronized void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        abandonFocus();
    }
}
