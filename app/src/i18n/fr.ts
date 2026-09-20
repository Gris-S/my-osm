// ---------------------------------------------------------------------------
// Dictionnaire français — **la référence**.
//
// Ses clés définissent le type `Dict` ; `en.ts` est typé dessus, si bien qu'une
// traduction manquante ou en trop casse le build. Ajouter une phrase à
// l'interface, c'est donc ajouter la clé ici puis sa traduction là-bas, jamais
// l'une sans l'autre.
//
// Conventions : les clés sont groupées par zone d'interface et nommées
// `zone.chose`. Les variables se notent `{nom}`. Un libellé qui varie avec un
// nombre porte deux clés, `…_one` et `…_other`, choisies par `tp()` — le
// français dit « 1 lieu » là où l'anglais dit « 1 place », mais « 0 lieu » là
// où l'anglais dit « 0 places ».
// ---------------------------------------------------------------------------

export const fr = {
  // Écran de repli (ErrorBoundary)
  "error.title": "Une erreur est survenue",
  "error.reload": "Recharger la page",

  // Boutons flottants de la carte
  "locate.aria": "Me localiser",
  "compass.aria": "Orienter la carte vers le nord",
  "compass.aligned": "Carte orientée au nord",

  // Bandeau d'état du chargement des commerces
  "mapStatus.empty": "Aucune catégorie affichée — ouvrez le menu en haut à gauche",
  "mapStatus.loading": "Chargement des commerces…",
  // Hors ligne. Le premier est permanent tant que la connexion manque ; le
  // second le remplace quand la carte a réellement dû laisser des cases vides,
  // c'est-à-dire qu'on est sorti des zones téléchargées. Sans eux, une carte
  // grise ne disait pas si elle était en panne ou simplement hors zone.
  "mapStatus.offline": "Hors ligne",
  "mapStatus.offlineGap": "Hors ligne — cette zone n'est pas téléchargée",

  // Géolocalisation du navigateur (`hooks/useGeolocation.ts`)
  "geo.unsupported": "Géolocalisation non disponible sur cet appareil.",
  "geo.denied": "Géolocalisation refusée — autorisez-la dans les réglages du téléphone.",
  "geo.unavailable": "Position indisponible pour le moment.",
  "geo.timeout":
    "Aucune position au bout de dix secondes — vérifiez que la localisation est activée, et autorisée pour MY OSM dans les réglages du téléphone.",

  // Recherche d'enseigne
  "brand.loading": "recherche…",
  "brand.failed": "échec de la recherche",
  "brand.none": "aucun lieu ici",
  "brand.count_one": "{count} lieu",
  "brand.count_other": "{count} lieux",
  "brand.countAtLeast_one": "{count} lieu ou plus",
  "brand.countAtLeast_other": "{count} lieux ou plus",
  "brand.searchHere": "Rechercher dans cette zone",

  // Menu principal (burger) et fenêtre des paramètres
  "menu.aria": "Menu principal",
  "menu.title": "Menu",
  "menu.settings": "Paramètres",
  "menu.download": "Téléchargement",
  "menu.api": "API",
  /* Soutien à l'auteur, au bas du menu. Le nom du service reste tel qu'il
     s'écrit, en anglais : c'est la page qu'on trouvera de l'autre côté. */
  "menu.coffee": "M'offrir un café",
  "menu.version": "Version {version}",
  "menu.sources": "Sources et licences",
  "sources.title": "Sources et licences",
  "sources.close": "Fermer",
  "sources.intro": "Les données affichées viennent de ces services. Elles restent la propriété de leurs auteurs et suivent chacune leur licence.",
  "sources.group.map": "Carte",
  "sources.group.transport": "Transports",
  "sources.group.services": "Recherche, itinéraires et calques",
  "sources.role.osm": "Données de la carte, lieux et arrêts — © les contributeurs d'OpenStreetMap",
  "sources.licence.odbl": "licence ODbL",
  "sources.role.openfreemap": "Tuiles vectorielles du fond de carte",
  "sources.role.idfm": "Horaires en temps réel, itinéraires, lignes et sorties de station en Île-de-France",
  "sources.role.transitous": "Horaires, temps réel et itinéraires partout ailleurs, agrégés des réseaux du monde entier",
  "sources.licence.transitous": "chaque réseau a sa licence, voir la liste des sources",
  "sources.role.photon": "Recherche d'adresses et de lieux",
  "sources.role.ban": "Recherche d'adresses en France",
  "sources.role.osrm": "Itinéraires à pied et en voiture",
  "sources.role.openmeteo": "Météo, qualité de l'air et pollens",
  "sources.role.meteofrance": "Vigilances météo",
  "sources.role.tomtom": "Trafic et navigation voiture",
  "sources.role.bisonfute": "Événements de trafic en France",
  "sources.role.ign": "Orthophotographie et courbes de niveau en France",
  "sources.role.esri": "Imagerie satellite",
  "sources.role.mapillary": "Photos de rue",
  "sources.app": "logiciel libre, sous licence GPL-3.0.",
  "settings.title": "Paramètres",
  "settings.close": "Fermer",
  "settings.homeWork": "Maison et travail",
  "settings.homeWork.unset": "Pas encore définie",
  "settings.homeWork.change": "Modifier",
  "settings.homeWork.set": "Définir",
  "settings.homeWork.clear": "Retirer",
  "settings.homeWork.cancel": "Annuler",
  "settings.homeWork.search": "Chercher l'adresse",
  "settings.homeWork.empty": "Aucun résultat",
  "settings.theme": "Thème",
  "settings.theme.auto": "Automatique",
  "settings.theme.light": "Clair",
  "settings.theme.dark": "Sombre",
  "settings.theme.hintSensor": "Sombre dans l'obscurité, clair à la lumière, d'après le capteur de luminosité du téléphone.",
  "settings.theme.hintSystem": "Pas de capteur de luminosité ici : l'application suit le thème de l'appareil.",
  "settings.language": "Langue",
  "settings.language.system": "Système",
  "settings.language.hint": "L'application suit la langue de votre appareil.",

  // Fenêtre d'accueil, au tout premier lancement (`FirstRunNotice`)
  "firstRun.title": "Bienvenue dans MY OSM",
  "firstRun.lead": "Deux choses valent une minute avant de commencer.",
  "firstRun.tomtom.title": "Ajoutez une clé TomTom — vivement conseillé",
  "firstRun.tomtom.body":
    "Sans elle, la navigation voiture n'a ni circulation en direct, ni péages évités, ni vitesses limites, ni voies à emprunter, et ne propose qu'un seul itinéraire.",
  "firstRun.tomtom.free": "Elle est gratuite, prend deux minutes, et ne demande aucune carte bancaire.",
  "firstRun.github.title": "Le projet est libre",
  "firstRun.github.body":
    "Code source, signalement de bogues et versions se trouvent sur GitHub. Les retours y sont les bienvenus.",
  "firstRun.addKey": "Ajouter la clé",
  "firstRun.openGithub": "Voir sur GitHub",
  "firstRun.later": "Plus tard",
  "firstRun.close": "Fermer",

  // --- Fenêtre « API » du menu burger ---------------------------------------
  // Les clés se saisissent dans l'application parce qu'un `.env.local` n'existe
  // plus une fois l'application empaquetée. Voir `services/apiKeys.ts`.
  "apikeys.title": "Clés d'API",
  /* Le chemin vers la fenêtre des clés, cité par les messages qui en manquent
     une. Une seule clé de traduction, pour qu'il ne se contredise jamais d'un
     écran à l'autre. */
  "apikeys.where": "Menu › API",
  "apikeys.intro":
    "Ces services sont facultatifs : sans clé, l'application fonctionne, certaines fonctions en moins. Une clé saisie ici remplace celle du fichier .env.local.",
  "apikeys.placeholder": "Aucune clé",
  "apikeys.save": "Enregistrer",
  "apikeys.clear": "Supprimer",
  "apikeys.restore": "Rétablir",
  "apikeys.show": "Afficher la clé",
  "apikeys.hide": "Masquer la clé",
  "apikeys.unsaved": "non enregistrée",
  "apikeys.checking": "vérification…",
  "apikeys.valid": "active",
  "apikeys.invalid": "refusée",
  "apikeys.unreachable": "service injoignable",
  "apikeys.absent": "absente",

  // D'où vient la clé employée. Le dire évite de croire une suppression sans
  // effet quand une clé compilée reprend la main.
  "apikeys.origin.stored": "Clé saisie dans l'application.",
  "apikeys.origin.builtIn": "Clé du fichier .env.local, compilée dans l'application.",
  "apikeys.origin.none": "Aucune clé — le service est désactivé.",

  "apikeys.group.tomtom": "TomTom",
  "apikeys.group.tomtom.hint":
    "Navigation voiture : circulation en direct, péages évités, vitesses limites, voies à emprunter. Et la couleur du débit sur le calque « Trafic ».",
  "apikeys.group.tomtom.link": "Obtenir une clé gratuite sur tomtom.com",
  "apikeys.tomtom": "Clé",

  "apikeys.group.idfm": "Île-de-France Mobilités (PRIM)",
  "apikeys.group.idfm.hint":
    "Prochains passages aux arrêts, et itinéraires en transports en commun. 1 000 appels par jour.",
  "apikeys.group.idfm.link": "Obtenir une clé gratuite sur prim.iledefrance-mobilites.fr",
  "apikeys.group.idfm.apis":
    "API employées : « Prochains passages (plateforme Île-de-France Mobilités) - requête unitaire » et « Calculateur Île-de-France Mobilités - Accès générique (v2) ».",
  "apikeys.idfm": "Clé",

  "apikeys.group.mapillary": "Mapillary",
  "apikeys.group.mapillary.hint": "Photos de rue et leur couverture sur la carte.",
  "apikeys.group.mapillary.link": "Créer un jeton gratuit sur mapillary.com",
  "apikeys.group.mapillary.apis": "Enregistrer une application, puis copier son « Client Token » (MLY|…).",
  /* Mapillary est le seul service de la fenêtre qui appartienne à une
     entreprise dont on cherche précisément à s'éloigner. Le dire là où la
     clé se saisit, et pas ailleurs : c'est le moment où le choix se fait. */
  "apikeys.group.mapillary.warning":
    "Mapillary appartient à Meta (Facebook). Sans jeton, rien ne lui est envoyé ; avec un jeton, les zones de carte consultées lui parviennent, avec l’adresse IP de l’appareil.",
  "apikeys.mapillary": "Jeton",

  "apikeys.group.meteofrance": "Météo-France",
  "apikeys.group.meteofrance.hint":
    "Vigilance météorologique dans l'encart météo.",
  "apikeys.group.meteofrance.link": "Obtenir des identifiants gratuits sur portail-api.meteofrance.fr",
  "apikeys.group.meteofrance.apis": "Souscrire à l'API « Données Publiques de Vigilance », puis « Générer Token » : choisir « API Key » (pas OAuth2) et une longue validité. La copier aussitôt — le portail ne la réaffiche pas.",
  "apikeys.meteofranceApiKey": "Clé d'API",

  // Barre de recherche
  "search.placeholder": "Rechercher un lieu ou une adresse",
  "search.clear": "Effacer",
  "search.brandAll": "Afficher tous les « {brand} »",
  "search.brandHint": "Enseigne, dans la zone visible",
  "search.loading": "Recherche…",
  "search.recentBrand": "Enseigne",
  "search.recent": "Recherche récente",
  "settings.stationsFirst": "Stations en premier dans la recherche",
  "settings.stationsFirst.hint": "Une station ou un arrêt dont le nom ressemble à ce que vous tapez passe en tête des résultats.",
  "search.web": "Chercher « {query} » sur le web",
  "search.webHint": "DuckDuckGo, dans l'application",
  "search.pastedPoint": "Point collé",
  "search.pastedPointHint": "Coordonnées reconnues",
  "webSearch.close": "Fermer",
  "webSearch.back": "Page précédente",
  "webSearch.hint": "Touchez « Itinéraire » ou sélectionnez l'adresse",
  "webSearch.locating": "Recherche de l'adresse…",
  "webSearch.notFound": "Adresse introuvable sur la carte",
  "webSearch.notFoundHint": "Sélectionnez l'adresse complète, avec la ville",
  "webSearch.shortLink": "Lien Google raccourci : non suivi",
  "webSearch.shortLinkHint": "Sélectionnez plutôt l'adresse sur la page",
  "webSearch.blocked": "Google bloqué : rien n'a été envoyé",
  "webSearch.blockedHint": "Choisissez un autre résultat, ou sélectionnez l'adresse",
  "webSearch.go": "Voir sur la carte",
  "incoming.place": "Lieu reçu",

  // Catégories de lieux (`filters.ts`)
  "filters.grocery": "Supérettes & alimentation",
  "filters.bakery": "Boulangeries & pâtisseries",
  "filters.fastfood": "Fast-foods",
  "filters.food": "Restaurants & cafés",
  "filters.nightlife": "Bars & vie nocturne",
  "filters.health": "Santé",
  "filters.beauty": "Beauté & bien-être",
  "filters.fashion": "Mode & accessoires",
  "filters.home": "Maison & bricolage",
  "filters.culture": "Culture & musées",
  "filters.outdoors": "Parcs & nature",
  "filters.sport": "Sport & forme",
  "filters.lodging": "Hôtels & hébergement",
  "filters.transport": "Transports",
  "filters.parking": "Stationnement",
  "filters.shop": "Autres commerces & services",

  // Fiche lieu
  "sheet.close": "Fermer",
  "sheet.place": "Lieu",
  "sheet.itinerary": "Itinéraire",
  "sheet.call": "Appeler",
  "sheet.website": "Site web",
  "sheet.save": "Enregistrer",
  "sheet.saved": "Enregistré",
  "sheet.saveTitle": "Enregistrer ce lieu",
  "sheet.savedTitle": "Enregistré dans « {folder} » — appuyer pour retirer",
  "sheet.share": "Partager",
  "sheet.copied": "Copié",
  "sheet.shareSystem": "Partager le lieu…",
  "sheet.shareSystemHint": "Messagerie, e-mail, autres applications",
  "sheet.copyCoords": "Copier les coordonnées",

  // Horaires d'ouverture
  "hours.loading": "Recherche des horaires…",
  "hours.unavailable": "Horaires indisponibles pour le moment",
  "hours.unknown": "Horaires non renseignés",
  "hours.checkToday": "Horaires du jour à vérifier",
  // La valeur d'OSM existe mais ne se lit pas — horaires au coucher du
  // soleil, saisons imbriquées. On ne montre pas la syntaxe brute pour autant.
  "hours.unreadable": "Horaires particuliers, à vérifier sur place",
  "hours.open": "Ouvert",
  "hours.closed": "Fermé",
  "hours.allDay": "24 h/24",
  "hours.variable": "Horaires variables",
  "hours.closesAt": "ferme à {time}",
  "hours.opensAt": "ouvre {when} à {time}",
  "hours.today": "aujourd'hui",
  "hours.tomorrow": "demain",
  "hours.publicClosed": "Fermé les jours fériés",
  "hours.public": "Jours fériés : {value}",
  "hours.schoolClosed": "Fermé pendant les vacances scolaires",
  "hours.school": "Vacances scolaires : {value}",
  "hours.closedOn": "Fermé le {date}",
  "day.mon": "Lundi",
  "day.tue": "Mardi",
  "day.wed": "Mercredi",
  "day.thu": "Jeudi",
  "day.fri": "Vendredi",
  "day.sat": "Samedi",
  "day.sun": "Dimanche",
  "dayWhen.mon": "lundi",
  "dayWhen.tue": "mardi",
  "dayWhen.wed": "mercredi",
  "dayWhen.thu": "jeudi",
  "dayWhen.fri": "vendredi",
  "dayWhen.sat": "samedi",
  "dayWhen.sun": "dimanche",
  "month.jan": "janvier",
  "month.feb": "février",
  "month.mar": "mars",
  "month.apr": "avril",
  "month.may": "mai",
  "month.jun": "juin",
  "month.jul": "juillet",
  "month.aug": "août",
  "month.sep": "septembre",
  "month.oct": "octobre",
  "month.nov": "novembre",
  "month.dec": "décembre",

  // Menu des catégories
  "filterMenu.aria": "Catégories affichées",
  "filterMenu.title": "Afficher sur la carte",
  "filterMenu.all": "Tout",
  "filterMenu.none": "Aucun",
  "filterMenu.some": "{count} sur {total}",
  "filterMenu.more": "Voir les catégories suivantes",
  "filterMenu.button": "Filtrer ce qui est affiché sur la carte",
  "filterMenu.buttonTitle": "Filtres",

  // Menu d'affichage de la carte (calques)
  "layers.aria": "Affichage de la carte",
  "layers.type": "Type de carte",
  "layers.plan": "Plan",
  "layers.satellite": "Satellite",
  "layers.relief": "Relief",
  "layers.reliefTitle": "Ombrer le terrain, et le mettre en volume en vue 3D",
  "layers.3d": "Vue 3D",
  "layers.3dTitle": "Incliner la carte et afficher les bâtiments en volume",
  "layers.streetPhotos": "Photos de rue",
  "layers.streetPhotosTitle": "Afficher les rues photographiées, et ouvrir une photo au clic",
  // Où saisir une clé : dans l'application, et non dans un fichier. `.env.local`
  // n'existe plus une fois l'application empaquetée — y renvoyer quelqu'un sur
  // un téléphone ne lui donnait aucun moyen d'agir.
  "layers.streetPhotosNoToken": "Demande un jeton Mapillary (gratuit) — Menu › API",
  "layers.streetPhotosNote": "Ajoutez un jeton Mapillary dans {file}. Il est gratuit et sans carte bancaire.",

  // Lieux enregistrés
  "bookmarks.aria": "Lieux enregistrés",
  "bookmarks.empty": "Aucun lieu enregistré ici.",
  "bookmarks.show": "Afficher sur la carte",
  "bookmarks.hide": "Masquer sur la carte",
  "bookmarks.color": "Couleur du dossier",
  "bookmarks.colorValue": "Couleur {color}",
  "bookmarks.rename": "Renommer le dossier",
  "bookmarks.delete": "Supprimer le dossier",
  "bookmarks.confirmAria": "Confirmer la suppression",
  "bookmarks.confirmEmpty": "Supprimer « {folder} » ?",
  "bookmarks.confirm_one": "Supprimer « {folder} » et {count} lieu enregistré ?",
  "bookmarks.confirm_other": "Supprimer « {folder} » et {count} lieux enregistrés ?",
  "bookmarks.cancel": "Annuler",
  "bookmarks.confirmDelete": "Supprimer",
  "bookmarks.defaultFolder": "Favoris",
  "folder.fallbackName": "Nouveau dossier",
  "folder.placeholder": "Nom du dossier",
  "folder.create": "Créer le dossier",
  "folder.new": "Nouveau dossier",

  // Fenêtre d'enregistrement d'un lieu
  "save.title": "Enregistrer",
  "save.name": "Nom",
  "save.folder": "Dossier",
  "save.submit": "Enregistrer",
  "save.move": "Déplacer ici",

  // Photo de rue
  "photo.title": "Photo de rue",
  "photo.expand": "Agrandir la photo",
  "photo.reduce": "Réduire la photo",
  "photo.expandShort": "Plein écran",
  "photo.reduceShort": "Réduire",
  "photo.close": "Fermer la photo",
  "photo.loading": "Chargement de la vue…",
  "photo.failed": "Photo indisponible.",
  "photo.noImage": "Aucune image reçue. La console du navigateur en dira la raison.",

  // Encart météo
  "weather.aria": "Météo",
  "weather.here": "Ma position",
  "weather.feels": "{label} · ressenti {temp}°",
  "weather.alerts": "Vigilance",
  "weather.alertTitle": "Vigilance {level} : {phenomenon} · {temp} °C",
  "weather.alertBadge": "Vigilance {level} : {phenomenon}",
  "weather.plainTitle": "{label} · {temp} °C",
  "weather.loading": "Relevés en cours…",
  "weather.air": "Qualité de l'air",
  "weather.airScale": "indice européen",
  "weather.airMissing": "Indice indisponible pour ce lieu.",
  "weather.pollens": "Pollens",
  "weather.pollensNone": "Aucun pollen notable en ce moment.",
  "weather.pollensMissing": "Relevé de pollens indisponible.",
  "weather.pollenUnit": "{value} gr/m³",

  // Codes temps de l'OMM
  "sky.clear": "Ciel dégagé",
  "sky.clearNight": "Nuit claire",
  "sky.few": "Peu nuageux",
  "sky.overcast": "Couvert",
  "sky.fog": "Brouillard",
  "sky.drizzle": "Bruine",
  "sky.rain": "Pluie",
  "sky.snow": "Neige",
  "sky.showers": "Averses",
  "sky.snowShowers": "Averses de neige",
  "sky.thunder": "Orage",
  "sky.cloudy": "Temps couvert",

  // Indice européen de la qualité de l'air
  "aqi.good": "Bon",
  "aqi.fair": "Moyen",
  "aqi.moderate": "Dégradé",
  "aqi.poor": "Mauvais",
  "aqi.veryPoor": "Très mauvais",
  "aqi.extreme": "Extrêmement mauvais",

  // Pollens
  "pollen.alder": "Aulne",
  "pollen.birch": "Bouleau",
  "pollen.grass": "Graminées",
  "pollen.mugwort": "Armoise",
  "pollen.olive": "Olivier",
  "pollen.ragweed": "Ambroisie",
  "pollen.low": "Faible",
  "pollen.moderate": "Modéré",
  "pollen.high": "Élevé",

  // Vigilance Météo-France
  "vigilance.wind": "Vent violent",
  "vigilance.rain": "Pluie-inondation",
  "vigilance.storm": "Orages",
  "vigilance.flood": "Crues",
  "vigilance.snow": "Neige-verglas",
  "vigilance.heat": "Canicule",
  "vigilance.cold": "Grand froid",
  "vigilance.avalanche": "Avalanches",
  "vigilance.waves": "Vagues-submersion",
  "vigilance.other": "Phénomène dangereux",
  "vigilance.yellow": "Jaune",
  "vigilance.orange": "Orange",
  "vigilance.red": "Rouge",
  "vigilanceIn.yellow": "jaune",
  "vigilanceIn.orange": "orange",
  "vigilanceIn.red": "rouge",

  // Prochains passages
  "departures.title": "Prochains passages",
  "departures.noKey": "Ajoutez une clé Île-de-France Mobilités (gratuite) dans {file} pour voir les horaires en temps réel.",
  "departures.loading": "Recherche des prochains passages…",
  "departures.error": "Passages indisponibles pour le moment.",
  "departures.refreshError": "Mise à jour impossible — ce sont les passages précédents.",
  "departures.none": "Aucun passage annoncé — service terminé.",
  "departures.silentNote": "Ces lignes desservent l'arrêt mais n'annoncent rien pour le moment : service terminé, ou horaires non diffusés ici par Île-de-France Mobilités.",
  "departures.silentLine": "aucun passage annoncé",
  "departures.ended": "Service terminé",
  "departures.noneAfter": "Aucun passage annoncé ensuite.",
  "departures.cancelled": "supprimé",
  "departures.atPlatform": "à quai",
  "departures.inMinutes": "dans {minutes} min",
  "departures.platform": "voie {platform}",
  "departures.towards": "Vers {destination}",
  "departures.realtime": "temps réel",
  "departures.scheduled": "horaire théorique",
  "departures.scheduledShort": "théorique",
  "departures.dueNow": "départ prévu",
  "departures.source": "Source : {source}",
  "departures.moreLines_one": "Voir l'autre ligne",
  "departures.moreLines_other": "Voir les {count} autres lignes",
  "departures.fewerLines": "Masquer les autres lignes",

  // Durées et distances
  "format.hours": "{hours} h",
  "format.hoursMinutes": "{hours} h {minutes} min",
  "format.minutes": "{minutes} min",

  // Panneau d'itinéraire
  "route.driving": "Voiture",
  "route.walking": "À pied",
  "route.transit": "Transports en commun",
  "itinerary.close": "Fermer l'itinéraire",
  "itinerary.from": "De",
  "itinerary.to": "Vers",
  "itinerary.originPlaceholder": "Adresse de départ",
  "itinerary.destinationPlaceholder": "Destination",
  "itinerary.stepPlaceholder": "Étape {index}",
  "itinerary.here": "Ma position",
  // Domicile et travail : deux rôles, pas deux signets. Ils se définissent dans
  // le champ d'itinéraire, là où l'on s'aperçoit qu'ils manquent.
  "itinerary.home": "Maison",
  "itinerary.work": "Travail",
  "itinerary.roleUnset": "Toucher pour définir",
  "itinerary.roleAssigning": "Choisissez l'adresse ci-dessous",
  "itinerary.rolePlaceholder": "Chercher l'adresse à retenir",
  "itinerary.mapHint": "Ou touchez un point sur la carte",
  "itinerary.cancel": "Annuler",
  "itinerary.moveUp": "Monter ce point",
  "itinerary.moveDown": "Descendre ce point",
  "itinerary.remove": "Retirer ce point",
  "itinerary.addStep": "Ajouter une étape",
  "itinerary.stepsFull": "Maximum de {count} étapes atteint",
  "itinerary.needOrigin": "Choisis un point de départ, ou active la géolocalisation.",
  "itinerary.computing": "Calcul de l'itinéraire…",
  "itinerary.noTransit": "Aucun trajet en transports pour ce parcours.",
  "itinerary.noTransitSteps": "Aucun trajet en transports desservant toutes les étapes.",
  "itinerary.transitNote": "Horaires {source}, au départ de l'heure du calcul.",
  "itinerary.singleRoute": "Un seul parcours est proposé : chaque étape est enchaînée au plus tôt.",

  // Trajet en transports : résumé et frise
  "journey.departure": "Départ {when}",
  "journey.now": "maintenant",
  "journey.inMinutes": "dans {minutes} min",
  "journey.atTime": "à {time}",
  "journey.noTransfer": "sans correspondance",
  "journey.transfers_one": "{count} correspondance",
  "journey.transfers_other": "{count} correspondances",
  "journey.walkTotal": "{minutes} min à pied",
  "journey.directionTitle": "Direction {direction}",
  "journey.direction": "direction {direction}",
  "journey.walk": "Marcher {minutes} min",
  "journey.walkTo": "Marcher {minutes} min jusqu'à {to}",
  "journey.board": "Monter à {name}",
  /* Le temps de marche d'une correspondance, replié sur l'étape du
     transport suivant : la marche elle-même ne fait plus une étape. */
  "journey.transfer": "Correspondance {minutes} min",
  "journey.alight": "Descendre à {name}",
  "journey.stopover": "Étape : {name}",
  "journey.stepFallback": "Étape {index}",
  "journey.stops_one": "{count} arrêt",
  "journey.stops_other": "{count} arrêts",
  "journey.nextDepartures": "Départs suivants",
  "journey.nextLoading": "Recherche des départs suivants…",
  "journey.nextError": "Horaires suivants indisponibles.",
  "journey.nextNone": "Aucun départ suivant annoncé — dernier passage.",
  "journey.arrival": "Arrivée",

  // Messages d'erreur montrés à l'utilisateur
  "error.unknown": "Erreur inconnue",
  "error.noRoute": "Aucun itinéraire trouvé",
  "error.routeFailed": "Calcul d'itinéraire échoué ({status})",
  // Le calcul est **distant** (OSRM, TomTom) : il n'y a pas de moteur embarqué,
  // et hors ligne il n'y a donc rien à rendre. Sans cette phrase, c'est le
  // « Failed to fetch » du navigateur qui s'affichait, en anglais.
  "error.routeOffline": "Le calcul d'itinéraire demande une connexion. Les cartes téléchargées restent consultables.",
  "error.transitOutside": "Départ ou arrivée hors de la zone couverte par les transports franciliens.",
  "error.transitNoSolution": "Aucun itinéraire en transports à cette heure — service terminé ?",
  "error.transitUnavailable": "Calcul d'itinéraire en transports indisponible.",
  "error.transitNoKey": "Ajoutez une clé Île-de-France Mobilités (gratuite) dans Menu › API pour les itinéraires en transports.",
  "error.transitRefused": "Clé Île-de-France Mobilités refusée pour le calcul d'itinéraires.",
  "error.transitQuota": "Quota Île-de-France Mobilités atteint pour aujourd'hui.",
  "error.transitFailed": "Calcul d'itinéraire en transports échoué ({status})",

  // Lieux sans nom
  "place.unnamed": "Lieu",
  "place.address": "Adresse",
  "place.picked": "Position sélectionnée",

  // Mentions d'attribution des sources cartographiques
  "attribution.elevation": "Altitude : Mapzen, USGS, SRTM",
  "attribution.contours": "Courbes de niveau : IGN",
  "attribution.photos": "Photos © contributeurs Mapillary",

  // Fenêtre « Téléchargement »
  "download.title": "Téléchargement",
  "download.pickArea": "Choisir une zone",
  "download.tap.country": "Touchez un pays pour le choisir. Zoomez pour viser une région.",
  "download.tap.region": "Touchez une région. Dézoomez pour un pays, zoomez pour un département.",
  "download.tap.department": "Touchez un département. Dézoomez pour une région ou un pays.",
  "download.searching": "Recherche de la zone…",
  "download.nothingHere": "Aucune zone à cet endroit.",
  "download.lookupFailed": "Zone introuvable — pas de réseau ?",
  "download.selected": "{kind} : {name}",
  "download.kind.country": "Pays",
  "download.kind.region": "Région",
  "download.kind.department": "Département",
  "download.legendDownloaded": "En vert : les zones déjà téléchargées.",
  "download.level": "Niveau de détail",
  "download.tierMap": "Carte seule",
  "download.tierMapHint": "Fond de carte navigable, sans horaires ni recherche.",
  "download.tierPlaces": "Carte + commerces",
  "download.tierPlacesHint": "Horaires, téléphone et adresse des lieux, et la recherche hors ligne.",
  "download.addresses": "Adresses (recherche par numéro de rue)",
  "download.addressCounting": "Comptage des adresses…",
  "download.addressNone": "Aucune adresse ici — la couverture s'arrête à la France.",
  "download.addressCount": "{count} adresses · {size}",
  "download.satellite": "Imagerie satellite",
  "download.maxZoom": "Zoom maximal : {zoom}",
  "download.satelliteOnly": "Imagerie seule : {size}",
  "download.relief": "Relief du terrain",
  "download.reliefOnly": "Relief seul : {size}. Ombrage à plat, volume en vue 3D",
  "download.reliefContours": ", et courbes de niveau à partir du zoom 11.",
  "download.reliefNoContours": ". Les courbes de niveau ne couvrent que la France.",
  "download.namePlaceholder": "Nom de la zone (Paris, vacances…)",
  "download.unnamed": "Zone sans nom",
  "download.roughly": "Ordre de grandeur : ",
  "download.about": "Environ ",
  "download.quota": "{used} utilisés sur {total}",
  "download.confirmHeavyAria": "Confirmer le téléchargement",
  "download.confirmHeavy": "Cette zone pèse environ {size}. Sur un forfait mobile, mieux vaut attendre le wifi.",
  "download.cancel": "Annuler",
  "download.anyway": "Télécharger quand même",
  "download.launch": "Télécharger cette zone",
  "download.behaviour": "Comportement",
  "download.wifiOnly": "Téléchargement en wifi uniquement",
  "download.connection": "Connexion détectée : {connection}.",
  "download.connectionUnknown": "Ce navigateur ne dit pas le type de connexion — cette option n'aura aucun effet ici.",
  "download.pauseOffline": "Suspendre quand la connexion se coupe, reprendre à son retour",
  "download.storedIn": "Enregistrées sur cet appareil uniquement.",
  "download.regions": "Zones téléchargées",
  "download.checkUpdates": "Vérifier les mises à jour",
  "download.lastChecked": "Dernière vérification : {date}. Elle se refait toute seule chaque semaine.",
  "download.neverChecked": "Pas encore vérifiées. La vérification se fait toute seule chaque semaine, dès que le réseau le permet.",
  "download.checkOffline": "Impossible de vérifier — pas de réseau. Nouvel essai dès que la connexion revient.",
  "download.upToDate": "Tout est à jour.",
  "download.stale_one": "{count} zone à mettre à jour.",
  "download.stale_other": "{count} zones à mettre à jour.",
  "download.noRegions": "Aucune zone pour l'instant.",
  "download.confirmDeleteAria": "Confirmer la suppression",
  "download.confirmDelete": "Supprimer « {region} » et les {size} qu'elle occupe ? Elle devra être retéléchargée entièrement.",
  "download.delete": "Supprimer",
  "download.places_one": "{count} lieu",
  "download.places_other": "{count} lieux",
  "download.metaSatellite": "satellite",
  "download.metaRelief": "relief",
  "download.metaStale": "à mettre à jour",
  "download.ready": "Prête hors ligne",
  "download.update": "Mettre à jour",
  "download.resume": "Reprendre",
  "download.redownload": "Retélécharger",
  "download.failureStorageFull": "Stockage plein : libérez de la place, puis reprenez.",
  "download.failureWrite": "L'appareil a refusé d'enregistrer les fichiers. Reprenez pour réessayer.",
  "download.failureMoved": "Les cartes sont maintenant rangées dans l'application, à l'abri d'un effacement : retéléchargez cette zone.",
  "download.spaceShort": "Il reste {free} de libre et cette zone pèse environ {size} : le téléchargement risque de s'arrêter faute de place.",
  "download.stop": "Interrompre",

  // Avancement d'un téléchargement
  "progress.style": "Habillage de la carte",
  "progress.prepare": "Préparation",
  "progress.tiles": "Tuiles",
  "progress.places": "Commerces et horaires",
  "progress.addresses": "Adresses",
  "progress.addressesCount": "Adresses — {done} / {total}",
  "progress.done": "Terminé",

  // Connexion réseau
  "network.offline": "hors ligne",
  "network.unknown": "type de connexion inconnu",
  "network.saveData": "économiseur de données actif",
  "network.wifi": "wifi",
  "network.ethernet": "filaire",
  "network.cellular": "données mobiles",
  "network.cellularType": "données mobiles ({type})",

  // Calque « Trafic »
  "layers.traffic": "Trafic",
  "layers.trafficTitle": "Bouchons, accidents et chantiers du réseau routier national",
  "traffic.jam": "Bouchon",
  "traffic.accident": "Accident",
  "traffic.roadworks": "Travaux",
  "traffic.closure": "Circulation modifiée",
  "traffic.other": "Événement",
  "traffic.attribution": "Trafic : Bison Futé / DIR",
  "traffic.flowAttribution": "Débit : TomTom",
  "traffic.loading": "Lecture du trafic…",
  "traffic.failed": "Trafic indisponible",
  "traffic.zoomIn": "Agrandissez pour voir le trafic",
} as const;

export type Dict = Record<keyof typeof fr, string>;
export type TranslationKey = keyof typeof fr;

/**
 * Les clés qui portent un pluriel, c'est-à-dire celles dont le dictionnaire
 * contient les variantes `…_one` et `…_other` : ce sont les seules que `tp()`
 * accepte, et le type les tient à jour tout seul.
 */
type StripOne<K> = K extends `${infer Base}_one` ? Base : never;
export type PluralKey = StripOne<TranslationKey>;
