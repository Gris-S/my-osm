# Édition manuelle de la carte — relevé Alpin Quest PRO

**Source** : fiche Google Play de « Alpin Quest PRO – Outdoor GPS »
(`com.alpinquest.app`), éditeur « Alpin Quests Pro Exploration tout-terrain »,
description et notes de version lues le **2 septembre 2026** (application mise à
jour le 29 août 2026, payante 9,99 €, 500+ téléchargements).

Relevé fait à la demande, pour servir de référence quand ces fonctions seront
envisagées dans ce projet. Ce n'est **pas** une spécification : c'est ce que
l'éditeur annonce, non ce qui a été essayé.

> **Attention à l'homonymie.** Ce n'est pas l'AlpineQuest connu
> (`psyberia.alpinequest.free`, 5 M+ téléchargements ; `…full`, 100 k+, 14,99 €),
> dont le sous-titre officiel *Off-Road Explorer* est exactement ce que traduit
> le nom d'éditeur d'ici. Deux applications sans lien.

## Une distinction à poser d'emblée

« Édition de la carte » recouvre deux choses très différentes, et Alpin Quest ne
fait que la première :

1. **Dessiner par-dessus la carte** — des objets qui appartiennent à
   l'utilisateur et à lui seul : itinéraires, zones, annotations. Le fond de
   carte n'est pas touché.
2. **Modifier les données du fond** — corriger OpenStreetMap lui-même, à la
   manière d'iD ou de Vespucci, avec comptes, changesets et remontée amont.

Tout ce qui suit relève du **cas 1**. Si le besoin réel est le cas 2, ce relevé
ne sert pas — c'est un autre chantier, avec authentification OSM et API
d'édition.

## Les primitives de dessin annoncées

| Objet | Ce qui est annoncé |
| --- | --- |
| **Itinéraire** | Tracé à la main sur la carte, multipoint |
| **Zone (polygone)** | Création et édition, sélection multipoint |
| **Zone à main levée** | Dessin libre **au doigt** (ajouté dans la version d'août 2026) |
| **Briefing** | Outil de dessin à main levée, libre |
| **Cercle** | Cité uniquement dans la liste des objets exportables |
| **Chaîne** | Cité uniquement dans la liste des objets exportables |
| **Point / cible** | Enregistrement illimité, **saisie manuelle par coordonnées MGRS** |
| **Point photo** | Point documenté par une photo prise sur place |

Les deux dernières lignes du tableau des objets — cercle et chaîne — ne sont
décrites nulle part ailleurs que dans la note de version (« les briefings, les
zones, les cercles et les chaînes peuvent être exportés »). **Hypothèse non
vérifiée** : cercles de portée et polylignes de mesure, deux classiques des
outils tactiques. À confirmer avant de s'en servir comme référence.

## L'édition proprement dite

C'est là que se trouve le détail intéressant, parce que c'est ce qui distingue
un outil de dessin d'un gribouillage :

- **Déplacer, supprimer ou ajouter un point** d'un itinéraire déjà tracé.
- **Édition des points intermédiaires d'un segment** : insérer des points entre
  deux sommets pour **courber** le segment. C'est la fonction qui manque
  presque toujours ailleurs — sans elle, un itinéraire dessiné à la main reste
  une suite de droites.
- **Édition d'une zone** après création.
- **Import puis édition** : une zone peut venir d'un KML de cadastre et être
  retouchée ensuite.

## Ce qui accompagne le dessin

- **Calcul de surface** d'une zone : m², km², acre, hectare.
- **Export de tout objet dessiné** en GPX et KML.
- **Export de la carte en PDF imprimable**, avec choix de l'échelle et du
  format de papier (ajouté en août 2026).
- Les **couches importées** (MBTiles) sont rendues aussi sur la vue 3D.
- Partage d'un point par **lien profond**.

## Ce que ça vaudrait ici

Rien de tout cela n'existe dans ce projet aujourd'hui — `useBookmarks` ne
connaît que des points, et `MapView` ne sait dessiner que ce que les services
lui donnent. Par ordre de rapport valeur / coût, à mon sens :

1. **Export/import GPX et KML** des lieux enregistrés. Aucun dessin à écrire,
   et ça sort les dossiers de `localStorage`, où ils sont aujourd'hui
   prisonniers. C'est le préalable à tout le reste.
2. **Mesure de distance et de surface** par une polyligne posée à la main.
   Petit périmètre, résultat immédiatement utile, et ça oblige à écrire la
   couche d'objets utilisateur dont tout le reste dépendra.
3. **Itinéraire tracé à la main**, avec déplacement et insertion de points.
   Attention : `RouteResult` porte aujourd'hui des tronçons calculés par un
   moteur ; un tracé manuel est un objet d'une autre nature et n'a pas à
   passer par `roadRoute` ni par `journeys`.
4. **Zones polygonales** et surface.
5. **Dessin à main levée**. Le plus vendeur en démonstration, le moins utile au
   quotidien — à garder pour la fin.

L'insertion de points intermédiaires (point 3) est le détail à ne pas sauter :
c'est elle qui sépare un outil utilisable d'un jouet.

## À vérifier si le sujet est repris

- Ce que sont réellement « cercles » et « chaînes ».
- Si l'édition se fait au doigt directement sur la carte ou par une liste de
  points — la fiche ne le dit pas.
- S'il existe une notion de calque pour regrouper les objets dessinés.
- Comment l'application gère la précision : simplification des tracés à main
  levée, accrochage aux objets existants, aucune des deux ?
