import type { CapacitorConfig } from "@capacitor/cli";

// ---------------------------------------------------------------------------
// Empaquetage Android de l'application.
//
// **Le code source n'est pas ici.** Il reste dans `../app`, et ce dossier
// ne contient que la coquille native : la configuration Capacitor, le projet
// Android engendré, et rien d'autre. `webDir` pointe donc vers le `dist/` du
// projet voisin — une seule source, deux enveloppes, aucune copie à tenir à
// jour. `npm run apk` reconstruit le web puis l'APK.
// ---------------------------------------------------------------------------

const config: CapacitorConfig = {
  appId: "org.osmlocal.plans",
  appName: "MY OSM",
  webDir: "../app/dist",

  android: {
    // Le schéma décide de l'origine de la page, donc de ce que les services
    // distants voient dans l'en-tête `Origin`. `https` est le seul qui donne un
    // contexte sécurisé, exigé par la géolocalisation, les capteurs de
    // mouvement et le stockage privé à l'origine (OPFS).
    // Débogage de la WebView : non réglé ici, Capacitor le suit sur le drapeau
    // « débogable » de l'APK — actif en debug (`outils/journal.sh`), coupé en
    // release (audit de sécurité du 15 septembre 2026).
  },

  server: {
    androidScheme: "https",
  },
};

export default config;
