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
- **Version Docker (`docker/`)** : l'application web servie par nginx, pour grand
  écran, **sans le mode course** (`OSM_TARGET=docker` → `__RUN_MODE__` faux).
  **Tout changement de la version téléphone se reporte sur la version Docker**
  (demande explicite, 28 septembre 2026) : vérifier qu'il marche aussi dans
  l'image et dans la mise en page grand écran (`hooks/useWideLayout.ts`,
  `styles/ui/wide.css` — jamais active dans l'APK). Construire et essayer :
  `podman build -f docker/Dockerfile -t localhost/my-osm:dev .` puis
  `podman run -d -p 18080:8080 --read-only --tmpfs /tmp --cap-drop ALL localhost/my-osm:dev`
  (ouvrir `http://127.0.0.1:18080`, pas `localhost`). Le relais du trafic existe
  en trois exemplaires qui doivent rester d'accord : `vite.config.ts`,
  `CONFIG.RELAY_TARGETS` et `docker/myosm.conf.template` ; la politique de
  contenu en deux : `src/security.ts` et `docker/security-headers.conf`.
- **Publier une version Docker à tester** : pousser sur la branche `docker-test`,
  qui construit `ghcr.io/gris-s/my-osm:test` (`.github/workflows/docker.yml`).
  **Jamais de `latest` ni de tag de version** tant que l'utilisateur n'a pas validé
  l'image sur son serveur.
