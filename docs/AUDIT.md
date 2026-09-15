# Audit — plateforme transport universelle

**15 septembre 2026** · branche `plateforme-transport` · MY OSM 0.1.0-alpha.13 ·
mesures sur Pixel 8 (APK de travail), par le câble.

Document de référence : `docs/ARCHITECTURE-API.md` (§6 : ce qui a été fait autrement
que prévu, et pourquoi).

---

## 1. Verdict

L'expérience parisienne — horaires groupés par destination, tracé d'une ligne,
itinéraire en transports, navigation guidée — **fonctionne dans les sept villes de
test**, par Transitous hors d'Île-de-France. **Paris ne régresse pas** : mêmes sources,
pas une requête de plus, durées dans la tolérance. Le budget de requêtes
est tenu et vérifié par des tests. Aucune fuite mémoire mesurée sur quatre tours de
quatre villes.

Restent ouverts, sans bloquer : les perturbations (non faites), l'heure affichée dans le
fuseau de l'appareil pour une ville lointaine, et deux obligations avant la sortie
officielle (contacter Transitous, sortir les clés d'API de l'APK) — §9.

## 2. Ce qui est livré

| Étape | Contenu | Commit |
|---|---|---|
| 1 | Couche `src/transport/` : modèle canonique, registre des régions, orchestrateur (rangs, disjoncteurs, reprises, annulation), client HTTP natif avec `User-Agent`, cache SWR | `446694b` |
| 2a | Départs, lignes déclarées et tracés de Paris par l'orchestrateur (adaptateur IDFM) | `c72b0ac` |
| 2b | Itinéraires par l'orchestrateur ; « hors zone » est une liste vide, pas une panne | `0d7a038` |
| 3 | Adaptateur Transitous : départs, tracés, itinéraires | `3e97b6a` |
| 5 | Qualité de chaque horaire, source nommée, « Sources et licences », pastilles hors Île-de-France | `e86272f` |
| 4 | Arrêts hybrides OSM + Transitous, un marqueur par station, cache IndexedDB 7 jours | `3881d05` |
| 6–7 | Navigation guidée vérifiée partout, tests de budget, cet audit | ce commit |

Code : 24 fichiers, 2 820 lignes dans `src/transport/` ; adaptateurs chargés à la
demande (fragments de 3,2 ko pour IDFM et 7,1 ko pour Transitous). Tests : 115, dont 40
pour la couche transport, **aucun ne touche le réseau**.

### Qui répond, où

| Capacité | Île-de-France | Ailleurs |
|---|---|---|
| Arrêts sur la carte | tuiles OSM | tuiles OSM, complétées par Transitous au zoom 16 |
| Lignes d'un arrêt (pastilles) | référentiel IDFM | lignes lues dans la fiche de l'arrêt |
| Départs | IDFM (clé) → Transitous | Transitous |
| Tracé d'une ligne | IDFM → Transitous | Transitous (par une course) |
| Itinéraire | Navitia/IDFM (clé) → Transitous | Transitous |
| Sorties de station | IDFM | — |
| Perturbations | — | — (non fait, §9) |

## 3. Sept villes

Mesures du 15 septembre 2026 vers 18 h (heure de Paris), position simulée à 1–3 km de la
station, sur la version en cours de chaque étape (alpha.11 pour ce tableau). « Requête »
= appel aux sources de transport, relevé par `window.__myosm.transportRequests`.

| Ville | Station | Lignes | Temps réel / théorique | Départs | Tracé | Itinéraire |
|---|---|---|---|---|---|---|
| Paris | Châtelet - Les Halles | 3 | 3 / 0 | IDFM, 2 appels SIRI | 1 appel, 1 076 ms | Navitia, 1 423 ms |
| Amsterdam | Centraal Station | 25 | 8 / 17 | 376 ms | 73 ms | 323 ms, 1 correspondance |
| Los Angeles | Union Station | 14 | 13 / 1 | 115 ms | 121 ms | 158 ms |
| Tokyo | 新宿西口 (1 h du matin) | 0 — service terminé | — | 168 ms | — | 1 084 ms (premiers trains) |
| São Paulo | Sé | 24 | 0 / 24 | 127 ms | 76 ms | 446 ms |
| Sydney | Central Chalmers Street | 12 | 12 / 0 | 178 ms | 80 ms | 234 ms |
| Genève | Gare Cornavin | 17 | 15 / 2 | 408 ms | 118 ms | 271 ms |

Chaque ville hors Paris : **une requête par action** (départs, tracé, itinéraire).
« Sources et licences » : 14 liens, dont `transitous.org/sources` et la page de
copyright d'OpenStreetMap.

**Arrêts hybrides** (alpha.12) : à Genève Cornavin et Amsterdam Centraal, OSM a tous les
arrêts et Transitous n'en ajoute aucun ; à São Paulo, 5 arrêts sur 19 viennent de
Transitous — touchés, ils ouvrent leurs départs (7 lignes) par leur identifiant de
station. À Paris : aucune requête d'arrêts.

**Pastilles** : après l'ouverture d'une fiche, l'arrêt porte ses lignes sur la carte
(Genève « TER 23468, TGV Lyria 9780, 14 +13 », Amsterdam « 51, 52, 53 +22 »,
São Paulo « 5119-10… +4 ») ; à Paris, les pastilles du référentiel IDFM, inchangées.

**Navigation guidée** (alpha.12) : lancée depuis l'itinéraire à Genève (« Take 15 at
Genève, Plainpalais », vers Nations), à Sydney (bus 333 vers North Bondi) et à Paris
(« Walk 3 min to Bastille », puis ligne 1) : bandeau de la manœuvre, suite du trajet,
tracé par étapes, arrêt propre. Hors d'Île-de-France, aucune recherche de sortie de
station n'est envoyée à IDFM.

## 4. Non-régression Paris

Mêmes parcours que la référence (§1 du document d'architecture), tolérance ±20 %, pas
plus de requêtes.

| Parcours | Référence | Après | Verdict |
|---|---|---|---|
| Carte au démarrage | 2 338 ms · 18 requêtes | 2 146 ms (médiane de 4) · 17–18 requêtes | ✅ |
| Arrêts visibles, Châtelet z16 | 626 ms · 7 requêtes | 639 ms · 7 requêtes | ✅ |
| Fiche Châtelet - Les Halles + horaires | 654 ms · 11 requêtes | 5 requêtes (dont 2 SIRI) | ✅ requêtes ; durée non comparable¹ |
| Départs par destination + tracé | 549 ms · 1 requête | 680–2 110 ms · 1 requête | ⚠️ réseau² |
| Itinéraire en transports | 1 333 ms · 3 requêtes | 816–1 423 ms · 2 appels Navitia | ✅ |

¹ Le script de référence tenait le message « Recherche des prochains passages… » pour
une réponse ; corrigé depuis, il mesure l'arrivée réelle des horaires (1 063 ms).
² Le temps est celui du téléchargement du tracé (123 ko pour le RER A, 426 ms de réseau
pour le RER D) : l'orchestrateur ajoute moins de 10 ms. Aucune requête de plus.

Rien de parisien ne passe par Transitous tant que la clé IDFM est là, et la capacité
« arrêts » n'est pas déclarée en Île-de-France : le budget parisien ne bouge pas.

## 5. Budget de requêtes

| Interaction | Engagement (§2g) | Mesuré sur le téléphone | Test |
|---|---|---|---|
| Vue posée (arrêts) | 3 au plus, 0 au cache chaud | 2–3 à la découverte, 0 en revenant | `transportBudget.test.ts` |
| Fiche d'une station + horaires | 2 au plus | 1 (Transitous) ; 2 SIRI à Paris, comme avant | idem |
| Tracé d'une ligne | 1, 0 au cache chaud | 1 | idem |
| Itinéraire A → B | 1 hors Paris | 1 | idem |
| Référentiel IDFM hors Île-de-France | — | **0** (était jusqu'à 376 ko par déplacement) | — |
| Changement de région, retour | 0 | arrêts 0 (IndexedDB) ; départs et tracés redemandés³ | — |

³ Le cache mémoire d'une région quittée est oublié par conception (§6.2 du document
d'architecture) ; les départs n'ont de toute façon que 30 secondes de validité.

## 6. Performance, mémoire, fuites

**Mémoire** — quatre tours de Genève, São Paulo, Paris et Amsterdam (zoom 14 puis 16,
fiche, horaires, tracé, fermeture ; six changements de région par tour), tas mesuré
après ramasse-miettes forcé :

| Tour | Tas | Nœuds du DOM | Écouteurs |
|---|---|---|---|
| départ | 20,7 Mo | 133 | 198 |
| 1 | 25,5 Mo | 138 | 198 |
| 2 | 26,2 Mo | 138 | 198 |
| 3 | 26,7 Mo | 138 | 198 |
| 4 | 27,1 Mo | 138 | 198 |

Le premier tour remplit les caches (POI déjà vus, arrêts, départs, relevé des appels) ;
ensuite le tas prend 0,7, 0,5 puis 0,4 Mo : la hausse ralentit, chaque cache étant
plafonné. Nœuds du DOM et écouteurs ne bougent plus : ni marqueur, ni fiche, ni
abonnement ne restent derrière une fiche fermée ou une région quittée. **Pas de fuite
mesurée** ; un essai plus long confirmerait le plafond.

**Démarrage** — quatre rechargements de la page sur Paris : 1 561, 2 246, 2 047 et
2 341 ms (référence 2 338 ms), 17 à 18 requêtes (référence 18). Une première mesure
isolée à 2 896 ms ne s'est pas reproduite.

**Poids** — adaptateurs en fragments séparés, chargés à la première capacité demandée
dans leur région : 3,2 ko (IDFM) et 7,1 ko (Transitous). Le fichier principal porte
l'orchestrateur, le modèle et la fusion des arrêts.

**Règles tenues** — aucune horloge ajoutée au niveau d'`App` ; `setData` seulement si la
liste des lieux change ; demandes d'arrêts après 400 ms sans mouvement, la précédente
annulée ; toute requête reçoit un `AbortSignal` (carte déplacée, fiche fermée, région
quittée).

## 7. Sécurité et vie privée

- **Aucun HTML venu d'une source** : tous les textes de Transitous et d'IDFM (noms,
  destinations, lignes) sont rendus comme texte par React — aucun
  `dangerouslySetInnerHTML` ni `innerHTML` dans le code ajouté. Les couleurs de ligne
  sont validées (`^[0-9a-f]{3,8}$`) avant usage.
- **Réponses bornées** : 5 Mo au plus, JSON seulement, délai par capacité, 4 appels
  simultanés par hôte, disjoncteur par source.
- **`User-Agent`** : `MY-OSM/<version> (+https://github.com/Gris-S/my-osm)` — aucune
  donnée personnelle (vérifié : aucune adresse personnelle dans le dépôt).
- **Ce qui part vers Transitous** : la position d'une station consultée, l'emprise
  d'une tuile z15 regardée au zoom 16, et **les deux extrémités d'un itinéraire —
  dont « ma position » quand c'est le départ**, comme Navitia à Paris. Rien d'autre :
  aucun identifiant, aucun historique.
- **Plus rien vers IDFM hors d'Île-de-France** : ni la position des arrêts regardés
  (référentiel des lignes), ni celle des stations où l'on descend (sorties).
- **Diagnostic** : le relevé des appels (`window.__myosm.transportRequests`) n'existe
  que dans l'APK de travail (`__DIAGNOSTICS__`), comme le reste de l'objet.
- **CSP inchangée** : les appels des adaptateurs passent par le natif.
- **Cache IndexedDB** (`osm-local:transport-cache`) : arrêts publics seulement, purgé
  de ses entrées échues à chaque session ; rien ne quitte l'appareil.

## 8. Conformité des sources

| Obligation | Source | État |
|---|---|---|
| Projet ouvert et non commercial | Transitous | ✅ dépôt public, GPL-3.0 |
| `User-Agent` identifiant l'application et un contact | Transitous, OSM | ✅ (adaptateurs) · ⚠️ Photon et Nominatim restent appelés depuis la WebView |
| Mise en cache des réponses | Transitous | ✅ départs 30 s, itinéraires 1 min, tracés et arrêts 7 jours |
| Lien visible vers `transitous.org/sources` | Transitous | ✅ « Sources et licences » |
| Contact avant un usage important | Transitous | ⏳ à faire avant la sortie officielle (décision du 15 septembre) |
| Attribution ODbL | OpenStreetMap | ✅ crédits du menu et « Sources et licences » |
| Quota 1 000 appels par jour | IDFM (PRIM) | ✅ inchangé : aucun rafraîchissement périodique, caches conservés |

## 9. Limites connues et suite

1. **Perturbations non faites.** Transitous les joint aux départs (`place.alerts`) :
   c'est la suite logique, avec retrait du HTML à la normalisation.
2. **Heures dans le fuseau de l'appareil.** Consulter Tokyo depuis Paris affiche les
   heures de Paris ; sur place, l'appareil est à l'heure locale et tout est juste. Les
   « dans N min » sont exacts partout.
3. **Tokyo** : noms de lignes parfois abrégés (« JC ») ou numériques, accepté (décision
   du 15 septembre, pas d'ODPT). **Amsterdam** : temps réel partiel, pas d'OVapi.
4. **São Paulo** : aucun temps réel publié — la fiche le dit, départ par départ.
5. **Pastilles hors Île-de-France** : seulement après l'ouverture de la fiche d'un
   arrêt (aucune source ne donne les lignes de tous les arrêts visibles sans une
   requête par arrêt).
6. **Avant la sortie officielle** : contacter Transitous ; sortir les clés d'API de
   l'APK ; donner un `User-Agent` aux appels Photon et Nominatim.
7. **Codes de mission SNCF** : dans le flux francilien de Transitous, certaines
   destinations de RER sont des codes (« ZECO », « NOTE ») ; sans effet tant qu'IDFM
   répond à Paris, visible si Transitous prend le relais.

## 10. Revérifier

- `npm test` (dans `app/`) : 115 tests, dont le budget de requêtes
  (`tests/transportBudget.test.ts`), les adaptateurs sur réponses enregistrées
  (`transitous.test.ts`, `transportJourneys.test.ts`) et la fusion des arrêts
  (`transportStops.test.ts`).
- Sur le téléphone (APK de travail) : `window.__myosm.transportRequests` liste les
  300 derniers appels des adaptateurs, avec durée et issue.
