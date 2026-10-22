# Vélos en libre-service et prix des carburants

Relevé du 20 octobre 2026, tiré de la liste `public-apis/public-apis`. Les deux
adresses ont répondu à un vrai appel et leur documentation a été lue ce jour-là.
C'est un instantané : à revérifier avant d'ouvrir le chantier.

**Vie privée, pour les deux :** chaque appel montre au service l'adresse IP et
la zone consultée. Pour rester fidèle à « rien n'est envoyé », les deux sont à
prévoir **désactivées par défaut**, activables dans les réglages, comme le mode
OpenStreetMap. La version Docker est concernée aussi (règle de parité).

## CityBikes : vélos en libre-service en direct

- **Ce que ça apporte :** vélos et places libres à chaque station (Vélib',
  Vélo'v et environ 700 réseaux dans le monde), sur la carte et dans la fiche.
- **Doc :** https://api.citybik.es/v2/
- **Accès :** sans clé. **Limite :** 300 requêtes par heure et par adresse IP,
  d'après les en-têtes de réponse. **CORS :** oui, appel direct possible depuis
  la version Docker.
- **Licence :** celle de chaque réseau (Vélib' : Licence Ouverte 2.0). La doc
  prévient que ce n'est « pas exactement de l'open data », car certaines
  données sont récupérées par des moyens détournés. Il faut **citer CityBikes
  avec un lien**.
- **F-Droid :** le logiciel du serveur (pybikes) est en AGPL, donc pas
  d'anti-feature « service non libre » attendue.
- Le flux officiel de Vélib' (GBFS) marche aussi, mais sans CORS, et sa page de
  doc renvoyait une erreur 403. CityBikes le couvre déjà.

## Pumperly : prix des carburants et bornes de recharge

- **Ce que ça apporte :** prix des carburants autour d'un point ou **le long
  d'un trajet**, ce qui s'accorde avec la navigation voiture
  (`src/navigation/car/`), plus les bornes de recharge. Données françaises
  tirées de prix-carburants.gouv.fr (mises à jour toutes les heures), bornes
  issues d'Open Charge Map (ODbL), 33 pays d'Europe.
- **Doc :** https://geiserx.github.io/Pumperly/reference/api/
- **Accès :** sans clé. Recherche autour d'un point sans limite annoncée,
  recherche le long d'un trajet limitée à 30 requêtes par minute.
- **CORS : non** (la doc le dit). Il faut passer par le relais, donc mettre à
  jour ses trois copies : `vite.config.ts`, `CONFIG.RELAY_TARGETS` et
  `docker/myosm.conf.template`, plus la politique de contenu
  (`src/security.ts`, `docker/security-headers.conf`).
- **Risque :** le serveur public est un projet perso, sans garantie de
  disponibilité. Le logiciel est en AGPL et s'héberge soi-même. L'autre
  solution est de lire directement le flux officiel de prix-carburants.gouv.fr.
- **À vérifier :** la recherche autour de Paris a répondu, mais un E10 à
  0,984 € a paru bas, et ce prix n'a pas été contrôlé.

## Décisions du 22 octobre 2026 (maquette : https://claude.ai/artifact/DKpvqzDcTHMS7gkAw9EHci)

- Deux modes dans Réglages › Modes, **éteints par défaut** : « Vélos en
  libre-service » et « Carburants et recharge ».
- **Vélos** : affichés avec la catégorie **Transports** (pas une catégorie à
  part). Pastille vélo + nombre ; fiche : mécaniques, électriques, places libres.
- **Carburants et recharge** : une ligne des **calques**, qui suit « Mon
  carburant » (réglage seul, pas de puce sur la carte), **Électrique compris** :
  Électrique → bornes et leur puissance au lieu des prix.
- **Prix** : interroger le flux officiel et Pumperly ; pour chaque prix, **le
  plus récent l'emporte**. À l'étranger, Pumperly seul. Attention : Pumperly
  date un prix du jour de sa collecte (`reportedAt`), pas de sa publication.
- **Fiche station-service** : titre « Station-service <enseigne> » (enseigne
  tirée d'OpenStreetMap, le flux officiel n'en a pas), adresse en dessous.
  « En rupture » (temporaire) et « Non vendu ici » (définitif), jamais « plus
  vendu ».
- **Icônes** pompe, borne, vélo sur les repères et dans les fiches.
- **Recherche** : « essence », « station service », enseignes, « borne »,
  « recharge », « vélib », « vélo » → « Afficher toutes les … » + les plus
  proches. Le nom d'un réseau d'une autre ville (« Vélo'v ») **recentre la
  carte sur sa ville**. Mode éteint → la recherche propose de l'allumer.
- **Étape suivante** : les prix le long du trajet en navigation voiture
  (Pumperly `/api/route-stations`).
