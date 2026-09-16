# MY OSM — l'enveloppe Android

**Le code source n'est pas ici.** Il reste dans `../app`, et ce dossier ne
contient que la coquille native : la configuration Capacitor et le projet
Android engendré. `capacitor.config.ts` pointe son `webDir` vers
`../app/dist` — une seule source, deux enveloppes, aucune copie à tenir à
jour.

## Construire

```bash
source ~/.local/share/android-env.sh   # JDK + SDK, installés sans droits root
npm run apk                            # reconstruit le web, puis l'APK
npm run install-apk                    # pose l'APK sur un appareil branché

npm run apk:nokeys                     # APK débogable, mais SANS AUCUNE CLÉ
npm run install-apk:nokeys             # → livrables/MY-OSM-sans-cles.apk
```

L'APK sort dans `android/app/build/outputs/apk/debug/app-debug.apk`, et `npm run apk` le recopie dans `../livrables/MY-OSM-debug.apk` — c'est ce fichier-là qu'on installe.

**`apk:nokeys` existe pour une raison précise.** La version *release* n'est pas
débogable — c'est voulu — donc rien ne peut la piloter : ni `outils/journal.sh`,
ni `outils/parcours.sh`. Or c'est justement la configuration que recevront les
utilisateurs de F-Droid : **aucune clé d'API**. Sans cette troisième variante,
elle ne serait jamais essayée autrement qu'à la main. `apk:nokeys` construit
donc un APK **débogable et sans clés** : la configuration de F-Droid, pilotable.

**Attention au nom des scripts npm.** `install` était un nom réservé : npm
l'exécute tout seul comme étape de `npm install` et de `npm ci`. `npm ci` dans
ce dossier lançait donc `adb install` et échouait sur toute machine sans
téléphone — le serveur de build de F-Droid compris. Renommé en `install-apk` le
16 septembre 2026. Les noms à ne jamais employer : `preinstall`, `install`,
`postinstall`, `prepare`, `prepublish`, `prepack`, `postpack`.

## La chaîne d'outils

Tout est sous le dossier personnel, **aucun `sudo` n'a été nécessaire** :

| | |
| --- | --- |
| JDK 21 (Temurin) | `~/.local/share/jdk-21` |
| Android SDK | `~/Android/Sdk` |
| Variables d'environnement | `~/.local/share/android-env.sh` |

SDK installé : `platform-tools`, `platforms;android-35`, `build-tools;35.0.0`,
`emulator`, `system-images;android-35;google_apis;x86_64`.

## L'émulateur ne fonctionne pas sur cette machine

Il est installé et l'AVD `plans-test` existe, mais il **plante en
`Segmentation fault`** peu après le démarrage, quel que soit le mode de rendu
(`swiftshader_indirect`, `guest`) et **y compris hors bac à sable**. Ce n'est
pas un problème de droits : `/dev/kvm` est en `0666`. L'hypothèse la plus
probable est l'incompatibilité des binaires préconstruits de Google avec la
glibc 2.43 et le noyau 7.2.3 de cet hôte.

Conséquence à connaître : **rien de ce qui est livré ici n'a été vu tourner.**
La vérification doit se faire sur un vrai téléphone.

## L'APK livré

`../livrables/MY-OSM-debug.apk`, signé avec la clé de débogage d'Android — toute application
doit être signée pour s'installer, y compris en « source non vérifiée » ; c'est
le certificat de débogage qui s'en charge, sans rien à fournir.

Trois choses ont été réglées pour qu'il soit utilisable :

- **Le Service Worker est retiré de la cible APK** (`OSM_TARGET=apk` dans
  `vite.config.ts`). En WebView Android il n'intercepterait pas les requêtes —
  il ne servirait donc pas les cartes hors ligne, ce pour quoi il existe — et il
  est connu pour empêcher l'injection du pont natif de Capacitor, ce qui aurait
  coûté la géolocalisation.
- **La géolocalisation passe par `navigator.geolocation`**, pas par un greffon.
  Capacitor intercepte la demande de la page (`BridgeWebChromeClient`,
  `onGeolocationPermissionsShowPrompt`) et réclame lui-même `ACCESS_FINE_LOCATION`
  et `ACCESS_COARSE_LOCATION` à l'exécution : l'API web suffit, et
  `@capacitor/geolocation` a été retiré des dépendances, où il était installé et
  compilé sans jamais être appelé. (Ce paragraphe affirmait le contraire — il
  décrivait une intention, pas le code.)
- **Un verrou d'éveil** (`src/navigation/useWakeLock.ts`) garde l'écran allumé
  pendant les trois guidages, et le reprend au retour d'arrière-plan — le
  système le retire sans jamais le rendre.

## Ce que l'APK a révélé sur le projet lui-même

Le premier essai sur un Pixel 8 a montré une carte vide. La cause n'était pas
l'empaquetage : **le worker de MapLibre n'était émis par aucun build**, parce que
MapLibre en calcule l'URL à l'exécution et que Vite ne peut pas l'analyser. Le
serveur de développement masquait le défaut depuis toujours. Corrigé dans
`vite.config.ts` (seconde entrée de build) — la version web en profite autant que
l'APK. Voir `CLAUDE.md`, « Contraintes techniques ».

## Le code natif écrit à la main

Presque tout `android/` est engendré par Capacitor. Ces fichiers-ci ne le sont
pas, et `cap sync` ne les touche pas :

- `android/app/src/main/java/org/osmlocal/plans/AmbientLightPlugin.java` — lit
  le capteur de luminosité pour le thème « Automatique ». Aucune API web ne le
  donne dans une WebView Android. Il se contente de relayer les lux ; la
  décision clair/sombre se prend côté web (`../app/src/services/ambientLight.ts`).
- `android/app/src/main/java/org/osmlocal/plans/NowPlayingPlugin.java` — la
  musique en cours pendant le guidage : titre, artiste, pochette, et
  pause / suivant / précédent, pour tout lecteur (YouTube Music, Qobuz…).
- `MediaNotificationListener.java` — service **vide**, déclaré au manifeste :
  Android ne montre les lecteurs actifs qu'aux applications dont un tel service
  a reçu « l'accès aux notifications ». Aucune notification n'est lue.
- `AndroidManifest.xml` — la déclaration de ce service (bloc `<service>`).
- `MainActivity.java` — enregistre les deux greffons (`registerPlugin`, **avant**
  `super.onCreate`), et **masque la barre d'état** (heure, notifications,
  batterie) : elle recouvrait les boutons du haut, et un contact près du bord
  ouvrait le volet des notifications. Elle est re-masquée à chaque reprise du
  focus, parce que le greffon `SystemBars` de Capacitor la réaffiche à son
  chargement ; un glissement depuis le haut la montre un instant. La barre de
  navigation du bas reste visible.

**Si le dossier `android/` est un jour régénéré** (`npx cap add android`), ces
fichiers sont à remettre : sans eux, le thème automatique retombe
silencieusement sur le thème du téléphone, et l'encart de musique n'apparaît
jamais.

## Ce qui manque encore, et qui est su

- **Les cartes hors ligne.** Reporté d'un commun accord. Le remplacement
  identifié est un protocole MapLibre (`addProtocol` + `transformRequest`) lisant
  le même OPFS par les mêmes fonctions de `services/offline/`. Le reste du
  hors-ligne — recherche d'adresses, dossiers, historique — repose sur IndexedDB
  et `localStorage` et fonctionne nativement.
- **Le calque « Trafic » et la vigilance météo.** Leurs deux flux passent par le
  proxy du serveur de développement, qui n'existe pas dans un APK. Les deux
  échouent **proprement** (vérifié : l'appel est intercepté des deux côtés), le
  reste de l'application n'en souffre pas. À rétablir par un appel HTTP natif.
- **L'arrière-plan.** L'écran reste allumé, mais si l'utilisateur quitte
  l'application, les minuteurs sont bridés et le guidage s'interrompt.
