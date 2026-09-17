# Publier une version

L'ordre compte : chaque étape suppose que la précédente est passée. Une étape
qui échoue arrête la publication — c'est tout l'intérêt d'avoir une liste.

---

## 0. Avant de commencer

- [ ] `git status` propre, tout est poussé
- [ ] `cd app && npm run lint` — **muet**, pas un avertissement
- [ ] `cd app && npm run build` — pas une erreur de typage
- [ ] `cd app && npm test` — tout au vert
- [ ] La version de `app/package.json` est montée et correspond au changelog
      fastlane : `0.1.0-alpha.N` → `fastlane/metadata/android/en-US/changelogs/10000NN.txt`

## 1. Le parcours, sur l'APK de travail

```bash
cd apk && npm run apk && npm run install-apk
outils/parcours.sh
```

- [ ] Toutes les vérifications passent
- [ ] Les captures de `parcours/<date>/` ont été **regardées** — une assertion
      qui passe ne dit pas qu'un panneau est lisible

## 2. Le parcours, sur la configuration de F-Droid

C'est celle que recevront la plupart des utilisateurs, et c'est la seule qui
n'ait aucune clé d'API.

```bash
cd apk && npm run apk:nokeys && npm run install-apk:nokeys
outils/parcours.sh
```

- [ ] Toutes les vérifications passent
- [ ] Les transports fonctionnent partout (Transitous), sans clé Île-de-France
- [ ] La voiture ne propose **qu'un** itinéraire, et l'écran de choix dit pourquoi
- [ ] Photos de rue, vigilance météo : **absentes et expliquées**, jamais
      silencieusement cassées

## 3. La construction depuis un clone propre

Ce que fera le serveur de F-Droid, et rien d'autre.

```bash
TMP=$(mktemp -d) && git clone https://github.com/Gris-S/my-osm.git "$TMP/c"
cd "$TMP/c" && npm --prefix app ci && npm --prefix apk ci
cd app && OSM_TARGET=apk MYOSM_DIAGNOSTICS=0 npm run build
```

- [ ] `npm ci` sort en **0** dans les deux dossiers
- [ ] La construction aboutit **sans `.env.local`**
- [ ] Aucune clé dans `dist/` : `grep -o "builtIn:\`[^\`]*\`" dist/assets/config-*.js`
      ne rend que des valeurs vides

## 4. La version à partager

```bash
export MYOSM_KEYSTORE=~/.clefs/my-osm-release.jks   # et ses trois mots de passe
cd apk && npm run apk:release
```

- [ ] **Aucun avertissement « aucune clé de release »** dans la sortie Gradle
- [ ] `unzip` de `livrables/MY-OSM.apk` : aucune des clés, pas de `__myosm`
- [ ] `apksigner verify --print-certs` montre **votre** certificat, pas celui de
      débogage
- [ ] La version lue dans l'APK correspond à `app/package.json`

> **À savoir :** le premier APK signé avec la vraie clé **ne s'installera pas
> par-dessus** un APK signé avec la clé de débogage. Il faut désinstaller — ce
> qui efface cartes hors ligne, historique et réglages. À dire dans les notes.

## 5. La release GitHub

- [ ] `git tag v0.1.0-alpha.N && git push --tags` — F-Droid suit les tags.
      **Le « v » compte** : `commit:` dans la recette F-Droid doit reprendre le
      nom exact du tag, et `AutoUpdateMode: Version v%v` le reconstruit.
- [ ] Notes de release **en anglais**, avec l'avertissement de désinstallation
- [ ] `sha256sum livrables/MY-OSM.apk` publiée avec le fichier
- [ ] L'asset s'appelle **exactement** `MY-OSM-0.1.0-alpha.N.apk` : la recette
      F-Droid le télécharge par ce nom (`Binaries:`) pour le comparer à sa
      propre construction. Autre nom, ou APK qui ne se reproduit pas : F-Droid
      saute la version

## 6. F-Droid

- [ ] `fastlane/metadata/android/en-US/` à jour : changelog du `versionCode`,
      captures, descriptions dans les limites (80 / 4000 / 500 caractères)
- [ ] `docs/fdroid/org.osmlocal.plans.yml` à jour (`versionName`,
      `versionCode`, `commit`, `CurrentVersion*`)
- [ ] `fdroid lint` et `fdroid rewritemeta` passés sur une copie, dans un
      dossier `metadata/` (`pip install fdroidserver` dans un venv suffit).
      `rewritemeta` retire les commentaires : c'est **sa** sortie qui part
      dans fdroiddata, le fichier commenté reste ici
- [ ] Les étapes de `build:` rejouées **d'un seul bash**, depuis
      `apk/android/app`, sur un clone du tag — puis `./gradlew assembleRelease`
- [ ] Première inclusion : merge request sur `gitlab.com/fdroid/fdroiddata`
      (`metadata/org.osmlocal.plans.yml`). Pas d'issue `rfp` : elle sert aux
      demandes faites par des tiers. La CI de la merge request fait la
      première vraie construction
- [ ] Versions suivantes : rien à faire, `UpdateCheckMode: Tags` repère le tag

---

## Ce que cette liste ne couvre pas

Elle ne remplace pas un usage réel. Le parcours vérifie ce qu'on a pensé à lui
faire vérifier : il n'a rien à dire d'une fonction qu'on ne lui a pas apprise.

**Un défaut trouvé à la main gagne son scénario** dans `outils/parcours.mjs`,
comme un calcul qui casse gagne son test. C'est la seule façon pour que la liste
grandisse au lieu de vieillir.
