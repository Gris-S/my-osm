# MY OSM

Application de cartographie locale basée sur OpenStreetMap : carte vectorielle,
commerces et horaires, itinéraires et guidage. Une seule base de code, livrée en
deux formes : **site web installable** et **application Android (APK)**.

## Plan du dossier

```
MY OSM/
├── README.md        ← ce fichier : la carte du projet
├── CLAUDE.md        ← consignes pour Claude (renvoie vers app/CLAUDE.md)
│
├── app/             ← LE CODE SOURCE (React + Vite + MapLibre)
│   ├── src/             tout le code de l'application
│   ├── public/          icônes, favicon
│   ├── scripts/         outils de génération (icônes, style sombre…)
│   ├── notes/           notes de travail
│   ├── README.md        présentation détaillée et fonctionnalités
│   └── CLAUDE.md        règles techniques et décisions d'architecture
│
├── apk/             ← L'ENVELOPPE ANDROID (Capacitor) — aucun code métier
│   ├── capacitor.config.ts   nom, identifiant, pointe vers app/dist
│   ├── android/              projet Android engendré par Capacitor
│   └── README.md             construction, chaîne d'outils, limites connues
│
├── livrables/       ← CE QU'ON INSTALLE
│   ├── MY-OSM-debug.apk      dernier APK de travail (débogable)
│   ├── MY-OSM.apk            dernier APK à partager (release)
│   └── anciens/              APK précédents, datés
│
├── saves/           ← SAUVEGARDES DATÉES (une par grosse modification)
│   └── AAAA-MM-JJ_NN_description/
│
└── outils/
    └── save.sh      ← crée une sauvegarde dans saves/
```

**Règle d'or :** on ne modifie le code que dans `app/`. `apk/` se contente
d'empaqueter ce que `app/` produit.

## Commandes courantes

```bash
# Version web, en développement
cd app && npm run dev

# Construire l'APK (reconstruit le web, puis l'Android, puis copie dans livrables/)
source ~/.local/share/android-env.sh
cd apk && npm run apk

# APK à partager : non débogable, sans outils de diagnostic (livrables/MY-OSM.apk)
cd apk && npm run apk:release

# Installer l'APK sur un téléphone branché en USB
cd apk && npm run install

# Lire le journal de navigation du téléphone branché (appli ouverte)
outils/journal.sh

# Faire une sauvegarde
outils/save.sh "description-courte"
```

## Sauvegardes

Après chaque grosse modification, une copie du projet est faite dans `saves/`,
nommée `AAAA-MM-JJ_NN_description` : la date, un numéro d'ordre, et ce qui venait
d'être fait. Elles se trient donc d'elles-mêmes dans l'ordre chronologique.

Pour rester légères, elles **ne contiennent pas** ce qui se régénère :
`node_modules/`, `app/dist/`, les dossiers `build/` d'Android, ni `livrables/`.

**Restaurer une sauvegarde :** copier son contenu à la racine de `MY OSM/`, puis
`npm install` dans `app/` et dans `apk/`.

Les trois premières (`01` à `03`) sont les copies faites à la main avant cette
organisation ; elles contiennent encore leurs `node_modules`. `00` est l'archive
de la toute première version.

## Identité de l'application

| | |
| --- | --- |
| Nom affiché | MY OSM |
| Identifiant Android | `org.osmlocal.plans` (ancien nom conservé pour garder les données déjà installées) |
| Clés de stockage local | `osm-local:*` (idem) |

## Licence

MY OSM est un logiciel libre, distribué sous **GNU General Public License v3.0
ou ultérieure** (voir `LICENSE`). Vous pouvez l'utiliser, l'étudier, le modifier
et le redistribuer ; toute version modifiée distribuée doit rester sous la même
licence, sources comprises.

Les données affichées ont leurs propres licences et attributions (OpenStreetMap
sous ODbL, services publics, fournisseurs de transport) : elles sont citées
dans l'application.
