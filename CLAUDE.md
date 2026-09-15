# MY OSM — consignes pour Claude

- **Plan du projet :** voir `README.md` à la racine.
- **Règles techniques et décisions d'architecture :** `app/CLAUDE.md` — à lire avant
  de toucher au code.
- **Le code ne se modifie que dans `app/`.** `apk/` n'est que l'enveloppe Android.
- **À chaque modification, monter la version** sans attendre qu'on la demande :
  `version` dans `app/package.json`, au format `0.1.0-alpha.N` tant qu'on est en
  alpha (N + 1). Elle s'affiche au bas du menu principal et l'APK la reprend.
- **Après chaque grosse modification, faire une sauvegarde** sans attendre qu'on
  la demande : `outils/save.sh "description-courte"`.
- **Après une modification qui touche l'APK,** reconstruire (`cd apk && npm run apk`,
  après `source ~/.local/share/android-env.sh`) : l'APK à jour arrive dans
  `livrables/`. Pour une version **à partager** (non débogable, sans outils de
  diagnostic) : `npm run apk:release` → `livrables/MY-OSM.apk`.
