package org.osmlocal.plans;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capteur de luminosité ambiante, pour le thème « Automatique ».
 *
 * Aucune API web ne donne ce capteur dans une WebView Android (`AmbientLightSensor`
 * n'y existe pas, vérifié sur Pixel 8) : ce greffon le lit côté natif et envoie
 * chaque relevé, en lux, sous l'événement `light`. Toute la décision clair /
 * sombre se prend côté web (`app/src/services/ambientLight.ts`) ; ici on ne fait
 * que relayer.
 *
 * L'écoute s'arrête quand l'application passe en arrière-plan et reprend au
 * retour, si elle était demandée : un capteur qui tourne pour un écran qu'on ne
 * regarde pas ne sert à rien.
 */
@CapacitorPlugin(name = "AmbientLight")
public class AmbientLightPlugin extends Plugin implements SensorEventListener {

    private SensorManager manager;
    private Sensor sensor;
    /** Vrai tant que la page a demandé l'écoute (`start` sans `stop`). */
    private boolean wanted = false;
    private boolean registered = false;

    @Override
    public void load() {
        manager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        sensor = manager != null ? manager.getDefaultSensor(Sensor.TYPE_LIGHT) : null;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", sensor != null);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (sensor == null) {
            call.reject("Pas de capteur de luminosité sur cet appareil.");
            return;
        }
        wanted = true;
        register();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        wanted = false;
        unregister();
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        unregister();
    }

    @Override
    protected void handleOnResume() {
        if (wanted) register();
    }

    @Override
    protected void handleOnDestroy() {
        unregister();
    }

    private void register() {
        if (registered || sensor == null) return;
        manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL);
        registered = true;
    }

    private void unregister() {
        if (!registered) return;
        manager.unregisterListener(this);
        registered = false;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        JSObject data = new JSObject();
        data.put("lux", event.values[0]);
        notifyListeners("light", data);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // Sans objet : seule la valeur en lux compte.
    }
}
