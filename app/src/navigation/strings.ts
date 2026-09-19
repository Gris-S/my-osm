import { currentLang, currentLocale, useI18n } from "../i18n";

// ---------------------------------------------------------------------------
// Les phrases du guidage.
//
// Elles vivent ici et non dans `src/i18n/`, et c'est **la seule entorse** du
// module à la règle du projet. Elle est le prix de ce qui a été demandé :
// pouvoir retirer la navigation en supprimant un dossier. Une clé posée dans
// `fr.ts` doit l'être aussi dans `en.ts` — c'est ce qui garantit qu'aucune
// traduction ne manque — et la suppression obligerait donc à repasser dans les
// deux dictionnaires pour y retrouver une trentaine de lignes mêlées au reste.
//
// Le patron du projet est respecté par ailleurs :
//
// - **le français est la référence** : ses clés définissent le type, l'anglais
//   est typé dessus, une traduction manquante ou en trop casse le build ;
// - **la langue en vigueur est celle du magasin de `src/i18n`** : le guidage
//   suit donc le réglage des paramètres, sans en tenir un second ;
// - **un composant appelle `useNav()`**, qui s'abonne à ce magasin et le
//   redessine au changement de langue.
// ---------------------------------------------------------------------------

const fr = {
  // Bouton de départ, dans le panneau d'itinéraire
  "nav.start": "Démarrer",
  "nav.startAria": "Démarrer la navigation à pied",

  // Bandeau de manœuvre et barre du bas
  // Les trois chiffres de la barre du bas ne portent pas de libellé à l'écran —
  // un temps, une heure et une distance se reconnaissent à leur forme. Ces
  // clés servent d'infobulle et d'étiquette d'accessibilité : ce qui est
  // évident à l'œil ne l'est pas pour une synthèse vocale.
  "nav.remaining": "Temps restant",
  "nav.arrival": "Heure d'arrivée",
  "nav.distance": "Distance restante",
  "nav.minutes": "min",
  "nav.recenter": "Recentrer",
  "nav.stop": "Terminer",
  "nav.details": "Détail du parcours",
  "nav.locating": "Recherche de votre position…",
  "nav.rerouting": "Recalcul de l'itinéraire…",
  "nav.computing": "Calcul de l'itinéraire…",
  "nav.arrived": "Vous êtes arrivé",
  "nav.arrivedAt": "Vous êtes arrivé à {name}",
  "nav.offRoute": "Vous vous êtes écarté du parcours",

  // Erreurs
  "nav.errorNoRoute": "Aucun itinéraire à pied entre ces points.",
  "nav.errorService": "Service d'itinéraire indisponible ({status}).",
  "nav.errorPosition": "Position indisponible : la navigation a besoin de la géolocalisation.",
  "nav.errorDenied": "Géolocalisation refusée — autorisez-la pour être guidé.",
  // Le calcul d'itinéraire est distant, y compris pour la voiture : hors ligne
  // il n'y a rien à rendre, et le dire vaut mieux que de laisser remonter le
  // « Failed to fetch » du navigateur.
  "nav.errorOffline": "Le calcul d'itinéraire demande une connexion. Les cartes téléchargées restent consultables.",

  // Ce que la navigation ne sait pas faire, dit dans les paramètres plutôt que
  // découvert au volant. Sans service Android — écarté : il faudrait une
  // notification permanente et la permission de position en arrière-plan — la
  // WebView est bridée puis déchargée dès que l'écran s'éteint.
  "settings.background.hint":
    "La navigation s'arrête si l'écran s'éteint ou si vous passez à une autre application : gardez MY OSM au premier plan. L'écran est maintenu allumé pendant tout le trajet.",

  // Manœuvres. `{name}` est la voie où l'on arrive ; les variantes « …Named »
  // ne servent que lorsqu'elle en porte une.
  "step.depart": "Prenez la direction indiquée",
  "step.departNamed": "Prenez {name}",
  "step.continue": "Continuez tout droit",
  "step.continueNamed": "Continuez sur {name}",
  "step.left": "Tournez à gauche",
  "step.leftNamed": "Tournez à gauche sur {name}",
  "step.right": "Tournez à droite",
  "step.rightNamed": "Tournez à droite sur {name}",
  "step.slightLeft": "Serrez à gauche",
  "step.slightLeftNamed": "Serrez à gauche sur {name}",
  "step.slightRight": "Serrez à droite",
  "step.slightRightNamed": "Serrez à droite sur {name}",
  "step.sharpLeft": "Tournez franchement à gauche",
  "step.sharpLeftNamed": "Tournez franchement à gauche sur {name}",
  "step.sharpRight": "Tournez franchement à droite",
  "step.sharpRightNamed": "Tournez franchement à droite sur {name}",
  "step.uturn": "Faites demi-tour",
  "step.uturnNamed": "Faites demi-tour sur {name}",
  "step.roundabout": "Prenez le rond-point",
  "step.roundaboutNamed": "Au rond-point, prenez {name}",
  "step.roundaboutExit": "Au rond-point, prenez la {exit}e sortie",
  "step.roundaboutExitNamed": "Au rond-point, prenez la {exit}e sortie sur {name}",
  "step.roundaboutFirst": "Au rond-point, prenez la 1re sortie",
  "step.roundaboutFirstNamed": "Au rond-point, prenez la 1re sortie sur {name}",
  "step.arrive": "Vous êtes arrivé",
  "step.arriveNamed": "Vous êtes arrivé, {name}",
  "step.waypoint": "Étape {index} atteinte",

  // Détail : le profil du dénivelé
  "profile.title": "Dénivelé",
  "profile.loading": "Lecture du relief…",
  "profile.error": "Relief indisponible ici.",
  "profile.ascent": "D+",
  "profile.descent": "D−",
  "profile.done": "{percent} % parcourus",
  "profile.steps": "≈ {count} pas",
  "profile.stepsHint": "estimation, {length} m par pas",
  "profile.axisStart": "départ",
  "profile.axisEnd": "arrivée",

  // Section « Navigation » de la fenêtre des paramètres
  "settings.section": "Navigation",
  "settings.camera": "Caméra navigation piéton",
  "settings.camera.adaptive": "Adaptatif",
  "settings.camera.fixed": "Fixe",
  "settings.camera.hint.adaptive":
    "Le zoom suit la distance au prochain changement de direction : la carte s'écarte pour montrer où vous tournez, puis se resserre à l'approche.",
  "settings.camera.hint.fixed": "La carte garde toujours la même échelle pendant la navigation.",

  // Fiche de fin de trajet
  "trip.title": "Trajet terminé",
  "trip.titleArrived": "Vous êtes arrivé",
  "trip.route": "{from} → {to}",
  "trip.elapsed": "Temps",
  "trip.announced": "annoncé {time}",
  "trip.ahead": "{time} d'avance",
  "trip.late": "{time} de retard",
  "trip.onTime": "à l'heure",
  "trip.distance": "Distance",
  "trip.steps": "Pas",
  "trip.stepsCounted": "comptés",
  "trip.stepsEstimated": "estimés",
  "trip.stepsDevice": "podomètre",
  "trip.speed": "Vitesse",
  "trip.pace": "Allure",
  "trip.paceUnit": "/km",
  "trip.close": "Fermer",
  "trip.saved": "Enregistré dans l'historique",
  "trip.notSaved": "Non enregistré — l'historique est désactivé",
  "trip.interrupted": "Trajet interrompu avant l'arrivée",

  // Historique
  "menu.history": "Historique",
  "menu.modes": "Modes",
  "modes.title": "Modes",
  "modes.run": "Mode course",
  "modes.run.hint": "Affiche le bouton orange sous le menu pour lancer une course.",
  "modes.walkSummary": "Résumé après une marche",
  "modes.walkSummary.hint": "La fiche de fin s'ouvre au terme d'une navigation à pied. Désactivé, le trajet est enregistré sans rien afficher.",
  "modes.runSummary": "Résumé après une course",
  "modes.runSummary.hint": "La fiche de fin, avec le graphe de l'allure, s'ouvre quand on termine une course. Désactivé, la course est enregistrée sans rien afficher.",
  "history.title": "Historique",
  "history.empty": "Aucun trajet enregistré pour l'instant.",
  "history.disabled": "L'enregistrement est désactivé dans les paramètres.",
  "history.loading": "Lecture de l'historique…",
  "history.share": "Partager",
  "history.delete": "Supprimer",
  "history.confirmDelete": "Supprimer ce trajet ? Il ne sera pas récupérable.",
  "history.confirmYes": "Supprimer",
  "history.confirmNo": "Annuler",
  "history.preparing": "Préparation…",
  "history.copied": "Image copiée — collez-la où vous voulez.",
  "history.downloaded": "Copie impossible sur ce navigateur : l'image a été enregistrée.",
  "history.noProfile": "Relief non enregistré pour ce trajet.",
  "history.previous": "Trajet précédent",
  "history.next": "Trajet suivant",
  "history.position": "{index} sur {total}",
  "history.shareTitle": "Trajet à pied",

  // Conservation de l'historique
  "settings.retention": "Conserver l'historique",
  "settings.retention.never": "Sans limite",
  "settings.retention.year": "1 an",
  "settings.retention.6months": "6 mois",
  "settings.retention.3months": "3 mois",
  "settings.retention.month": "1 mois",
  "settings.retention.week": "1 semaine",
  "settings.retention.day": "1 jour",
  "settings.retention.off": "Ne rien enregistrer",
  "settings.retention.hint.never": "Les trajets sont gardés indéfiniment, sur cet appareil seulement.",
  "settings.retention.hint.span": "Un trajet est effacé passé ce délai. La vérification a lieu à l'ouverture de l'historique et à la fin de chaque trajet.",
  "settings.retention.hint.off": "Aucun trajet n'est enregistré, et l'historique existant est effacé.",

  // Musique en cours, pendant la navigation (`music/`)
  "music.label": "Musique en cours",
  "music.play": "Lecture",
  "music.pause": "Pause",
  "music.previous": "Titre précédent",
  "music.next": "Titre suivant",
  "music.noAccess": "Pour contrôler votre musique pendant la navigation, activez l'accès dans Paramètres › Navigation.",
  "music.dismiss": "Masquer",
  "music.open": "Ouvrir le lecteur",

  // Mode course (`running/`)
  "run.button": "Démarrer une course",
  "run.confirmTitle": "Démarrer une course ?",
  "run.confirmText": "Le chronomètre part tout de suite et l'écran reste allumé jusqu'à la fin.",
  "run.confirmNo": "Annuler",
  "run.confirmYes": "Démarrer",
  "run.title": "Course",
  "run.active": "En course",
  "run.pausedLabel": "En pause",
  "run.waiting": "Recherche du signal GPS…",
  "run.pause": "Mettre en pause",
  "run.resume": "Reprendre",
  "run.stop": "Terminer",
  "run.recenter": "Recentrer",
  "run.distance": "Distance",
  "run.pace": "Allure",
  "run.avgPace": "Allure moy.",
  "run.from": "Départ : {from}",
  "run.summaryTitle": "Course terminée",
  "run.duration": "Durée",
  "run.pausedFor": "dont {time} de pause",
  "run.avgPaceLong": "Allure moyenne",
  "run.avgSpeed": "{speed} de moyenne",
  "run.elevation": "Dénivelé",
  "run.elevationPending": "calcul en cours…",
  "run.elevationMissing": "indisponible",
  "run.paceChart": "Allure au fil de la course",
  "run.paceChartHint": "Plus haut, plus rapide. Pointillés : allure moyenne.",
  "run.chartTooShort": "Course trop courte pour tracer l'allure.",
  "run.regularity.high": "Très régulière",
  "run.regularity.good": "Régulière",
  "run.regularity.fair": "Assez irrégulière",
  "run.regularity.low": "Irrégulière",
  "run.regularityDetail": "±{seconds} s/km",
  "settings.music": "Musique pendant la navigation",
  "settings.music.grant": "Autoriser l'accès",
  "settings.music.granted": "Accès autorisé",
  "settings.music.manage": "Gérer ou retirer l'accès",
  "settings.music.hint.missing":
    "Sert uniquement à afficher et contrôler votre musique pendant la navigation. Android demande pour cela d'autoriser MY OSM dans « Accès aux notifications ». Aucune donnée n'est collectée.",
  "settings.music.hint.granted":
    "Sert uniquement à afficher et contrôler votre musique pendant la navigation. Aucune donnée n'est collectée.",
  "settings.music.hint.web": "Disponible dans l'application Android seulement.",

  // Guidage en transports en commun
  "transit.startAria": "Démarrer la navigation de ce trajet",
  "transit.walkTo": "Marcher {minutes} min jusqu'à {place}",
  "transit.walk": "Marcher {minutes} min",
  "transit.board": "Prendre {line} à {place}",
  "transit.boardPlain": "Monter à {place}",
  "transit.direction": "direction {direction}",
  "transit.departsAt": "départ à {time}",
  "transit.alight": "Descendre à {place}",
  "transit.arriveAt": "arrivée à {time}",
  "transit.stopsLeft_one": "{count} arrêt",
  "transit.stopsLeft_other": "{count} arrêts",
  "transit.exit": "Sortie {number} — {name}",
  "transit.exitUnnumbered": "Sortie « {name} »",
  "transit.connection": "Suivre « Correspondance » {line}",
  "transit.arrived": "Vous êtes arrivé",
  "transit.arrivedAt": "Vous êtes arrivé à {place}",
  "transit.remaining": "La suite",
  "transit.done": "Fin du trajet",
  "transit.next": "Étape suivante",
  "transit.previous": "Étape précédente",
  "transit.ahead": "Avancé d'une étape à la main",
  "transit.aheadMany": "Avancé de {count} étapes à la main",
  "transit.behind": "Reculé d'une étape à la main",
  "transit.behindMany": "Reculé de {count} étapes à la main",
  "transit.resync": "Suivre l'horaire",

  // Simulation (développement seulement)
  "sim.start": "Simuler la marche",
  "sim.stop": "Arrêter la simulation",

  // -------------------------------------------------------------------------
  // Navigation voiture (`src/navigation/car/`)
  // -------------------------------------------------------------------------

  // Bouton de départ, puis l'écran de choix d'itinéraire
  "car.start": "Démarrer",
  "car.startAria": "Choisir un itinéraire et démarrer la navigation",
  "car.pickOnMap": "Touchez un itinéraire pour le voir, une seconde fois pour partir",
  "car.pickOnMapSingle": "Touchez l'itinéraire pour partir",
  "car.computingChoices": "Recherche des itinéraires…",
  "car.cancel": "Annuler",
  "car.incident.roadworks": "Travaux",
  "car.incident.closure": "Route fermée",
  "car.incident.accident": "Accident",
  "car.incident.other": "Incident",
  "car.arrivalAt": "Heure d'arrivée",
  "car.tollFree": "Sans péage",
  // La bulle d'un itinéraire porte une seule ligne de péage : elle ne redit
  // donc pas le nom de la proposition. Et le montant n'est affiché que
  // lorsqu'il est officiel — seules APRR et AREA publient leur grille ;
  // ailleurs on dit qu'on ne sait pas plutôt que d'estimer.
  "car.tollUnpriced": "Péage, tarif non publié",
  "car.tollAtLeast": "au moins {price}",
  // Ce que la circulation ajoute au temps de trajet, sur la bulle d'une
  // proposition. Sans lui, la durée de TomTom paraissait fausse à côté de celle
  // d'OSRM, qui ignore le trafic.
  "car.trafficDelay": "+{minutes} min de trafic",
  "car.noKeyHint":
    "Sans clé TomTom, l'itinéraire est calculé sans la circulation et les péages ne sont ni évités ni chiffrés.",

  // Bandeau de manœuvre
  "car.then": "puis",
  "car.lanes": "Voies à emprunter",
  "car.computing": "Calcul de l'itinéraire…",
  "car.locating": "Recherche de votre position…",
  "car.rerouting": "Recalcul de l'itinéraire…",
  "car.trafficRerouted": "Itinéraire modifié — {minutes} min gagnées sur le trafic",
  "car.offRoute": "Vous vous êtes écarté du parcours",
  "car.arrived": "Vous êtes arrivé",
  "car.arrivedAt": "Vous êtes arrivé à {name}",

  // Barre du bas et compteur
  "car.remaining": "Temps restant",
  "car.distance": "Distance restante",
  "car.recenter": "Recentrer",
  "car.stop": "Terminer",
  "car.kmh": "km/h",
  "car.limit": "Vitesse autorisée",
  "car.speedStale": "Signal perdu — dernière vitesse connue",

  // Radars — le seul son de l'application
  "car.radarFixed": "Radar fixe",
  "car.radarTower": "Radar tourelle",
  "car.radarAverage": "Radar de vitesse moyenne",
  "car.radarLight": "Radar de feu rouge",
  "car.radarCrossing": "Radar de passage à niveau",

  // Manœuvres. L'action seule : la route où elle mène est écrite en dessous,
  // sur sa propre ligne, et n'a donc pas à figurer dans la phrase.
  "car.depart": "Partez",
  "car.arrive": "Vous êtes arrivé",
  "car.waypoint": "Étape {index} atteinte",
  "car.straight": "Tout droit",
  "car.left": "Tournez à gauche",
  "car.right": "Tournez à droite",
  "car.slightLeft": "Serrez à gauche",
  "car.slightRight": "Serrez à droite",
  "car.sharpLeft": "Tournez franchement à gauche",
  "car.sharpRight": "Tournez franchement à droite",
  "car.keepLeft": "Tenez la gauche",
  "car.keepRight": "Tenez la droite",
  "car.uturn": "Faites demi-tour",
  "car.roundabout": "Au rond-point",
  "car.roundaboutExit": "Rond-point, {exit}e sortie",
  "car.merge": "Insérez-vous",
  "car.fork": "À l'embranchement",
  "car.enterMotorway": "Prenez l'autoroute",
  "car.exit": "Prenez la sortie",
  "car.exitNumbered": "Sortie {exit}",

  // Erreurs
  "car.errorNoRoute": "Aucun itinéraire routier entre ces points.",
  "car.errorService": "Service d'itinéraire indisponible ({status}).",

  "sim.startDrive": "Simuler la conduite",
  "sim.stopDrive": "Arrêter la simulation",
} as const;

type NavDict = Record<keyof typeof fr, string>;
export type NavKey = keyof typeof fr;

const en: NavDict = {
  "nav.start": "Start",
  "nav.startAria": "Start walking navigation",

  "nav.remaining": "Time remaining",
  "nav.arrival": "Arrival time",
  "nav.distance": "Distance remaining",
  "nav.minutes": "min",
  "nav.recenter": "Recentre",
  "nav.stop": "End",
  "nav.details": "Route detail",
  "nav.locating": "Looking for your position…",
  "nav.rerouting": "Recalculating the route…",
  "nav.computing": "Calculating the route…",
  "nav.arrived": "You have arrived",
  "nav.arrivedAt": "You have arrived at {name}",
  "nav.offRoute": "You have left the route",

  "nav.errorNoRoute": "No walking route between these points.",
  "nav.errorService": "Routing service unavailable ({status}).",
  "nav.errorPosition": "Position unavailable: navigation needs location services.",
  "nav.errorDenied": "Location denied — allow it to be guided.",
  "nav.errorOffline": "Route calculation needs a connection. Downloaded maps stay available.",
  "settings.background.hint":
    "Navigation stops if the screen turns off or you switch to another app: keep MY OSM in the foreground. The screen is kept awake for the whole trip.",

  "step.depart": "Head in the indicated direction",
  "step.departNamed": "Head onto {name}",
  "step.continue": "Continue straight ahead",
  "step.continueNamed": "Continue on {name}",
  "step.left": "Turn left",
  "step.leftNamed": "Turn left onto {name}",
  "step.right": "Turn right",
  "step.rightNamed": "Turn right onto {name}",
  "step.slightLeft": "Bear left",
  "step.slightLeftNamed": "Bear left onto {name}",
  "step.slightRight": "Bear right",
  "step.slightRightNamed": "Bear right onto {name}",
  "step.sharpLeft": "Turn sharply left",
  "step.sharpLeftNamed": "Turn sharply left onto {name}",
  "step.sharpRight": "Turn sharply right",
  "step.sharpRightNamed": "Turn sharply right onto {name}",
  "step.uturn": "Make a U-turn",
  "step.uturnNamed": "Make a U-turn onto {name}",
  "step.roundabout": "Enter the roundabout",
  "step.roundaboutNamed": "At the roundabout, take {name}",
  "step.roundaboutExit": "At the roundabout, take exit {exit}",
  "step.roundaboutExitNamed": "At the roundabout, take exit {exit} onto {name}",
  "step.roundaboutFirst": "At the roundabout, take the 1st exit",
  "step.roundaboutFirstNamed": "At the roundabout, take the 1st exit onto {name}",
  "step.arrive": "You have arrived",
  "step.arriveNamed": "You have arrived, {name}",
  "step.waypoint": "Stop {index} reached",

  "profile.title": "Elevation",
  "profile.loading": "Reading the terrain…",
  "profile.error": "Terrain unavailable here.",
  "profile.ascent": "Ascent",
  "profile.descent": "Descent",
  "profile.done": "{percent}% covered",
  "profile.steps": "≈ {count} steps",
  "profile.stepsHint": "estimate, {length} m per step",
  "profile.axisStart": "start",
  "profile.axisEnd": "finish",

  "settings.section": "Navigation",
  "settings.camera": "Walking navigation camera",
  "settings.camera.adaptive": "Adaptive",
  "settings.camera.fixed": "Fixed",
  "settings.camera.hint.adaptive":
    "The zoom follows the distance to the next turn: the map pulls back to show where you turn, then closes in as you approach.",
  "settings.camera.hint.fixed": "The map keeps the same scale throughout navigation.",

  "trip.title": "Trip finished",
  "trip.titleArrived": "You have arrived",
  "trip.route": "{from} → {to}",
  "trip.elapsed": "Time",
  "trip.announced": "estimated {time}",
  "trip.ahead": "{time} ahead",
  "trip.late": "{time} behind",
  "trip.onTime": "on time",
  "trip.distance": "Distance",
  "trip.steps": "Steps",
  "trip.stepsCounted": "counted",
  "trip.stepsEstimated": "estimated",
  "trip.stepsDevice": "pedometer",
  "trip.speed": "Speed",
  "trip.pace": "Pace",
  "trip.paceUnit": "/km",
  "trip.close": "Close",
  "trip.saved": "Saved to history",
  "trip.notSaved": "Not saved — history is turned off",
  "trip.interrupted": "Trip ended before arrival",

  "menu.history": "History",
  "menu.modes": "Modes",
  "modes.title": "Modes",
  "modes.run": "Running mode",
  "modes.run.hint": "Shows the orange button under the menu to start a run.",
  "modes.walkSummary": "Summary after a walk",
  "modes.walkSummary.hint": "The end-of-trip card opens when a walking navigation ends. When off, the trip is saved without showing anything.",
  "modes.runSummary": "Summary after a run",
  "modes.runSummary.hint": "The end card, with the pace chart, opens when you finish a run. When off, the run is saved without showing anything.",
  "history.title": "History",
  "history.empty": "No trips recorded yet.",
  "history.disabled": "Recording is turned off in the settings.",
  "history.loading": "Reading history…",
  "history.share": "Share",
  "history.delete": "Delete",
  "history.confirmDelete": "Delete this trip? It cannot be recovered.",
  "history.confirmYes": "Delete",
  "history.confirmNo": "Cancel",
  "history.preparing": "Preparing…",
  "history.copied": "Image copied — paste it wherever you like.",
  "history.downloaded": "Copying is not available in this browser: the image was saved instead.",
  "history.noProfile": "No terrain recorded for this trip.",
  "history.previous": "Previous trip",
  "history.next": "Next trip",
  "history.position": "{index} of {total}",
  "history.shareTitle": "Walking trip",

  "settings.retention": "Keep history",
  "settings.retention.never": "No limit",
  "settings.retention.year": "1 year",
  "settings.retention.6months": "6 months",
  "settings.retention.3months": "3 months",
  "settings.retention.month": "1 month",
  "settings.retention.week": "1 week",
  "settings.retention.day": "1 day",
  "settings.retention.off": "Record nothing",
  "settings.retention.hint.never": "Trips are kept indefinitely, on this device only.",
  "settings.retention.hint.span": "A trip is removed once it is older than this. The check runs when history is opened and at the end of each trip.",
  "settings.retention.hint.off": "No trip is recorded, and existing history is erased.",

  "music.label": "Now playing",
  "music.play": "Play",
  "music.pause": "Pause",
  "music.previous": "Previous track",
  "music.next": "Next track",
  "music.noAccess": "To control your music during navigation, allow access in Settings › Navigation.",
  "music.dismiss": "Hide",
  "music.open": "Open the player",

  "run.button": "Start a run",
  "run.confirmTitle": "Start a run?",
  "run.confirmText": "The timer starts right away and the screen stays on until you finish.",
  "run.confirmNo": "Cancel",
  "run.confirmYes": "Start",
  "run.title": "Run",
  "run.active": "Running",
  "run.pausedLabel": "Paused",
  "run.waiting": "Waiting for GPS signal…",
  "run.pause": "Pause",
  "run.resume": "Resume",
  "run.stop": "Finish",
  "run.recenter": "Recenter",
  "run.distance": "Distance",
  "run.pace": "Pace",
  "run.avgPace": "Avg pace",
  "run.from": "Start: {from}",
  "run.summaryTitle": "Run complete",
  "run.duration": "Duration",
  "run.pausedFor": "including {time} paused",
  "run.avgPaceLong": "Average pace",
  "run.avgSpeed": "{speed} average",
  "run.elevation": "Elevation",
  "run.elevationPending": "computing…",
  "run.elevationMissing": "unavailable",
  "run.paceChart": "Pace over the run",
  "run.paceChartHint": "Higher is faster. Dashed line: average pace.",
  "run.chartTooShort": "Run too short to chart the pace.",
  "run.regularity.high": "Very steady",
  "run.regularity.good": "Steady",
  "run.regularity.fair": "Somewhat uneven",
  "run.regularity.low": "Uneven",
  "run.regularityDetail": "±{seconds} s/km",
  "settings.music": "Music during navigation",
  "settings.music.grant": "Allow access",
  "settings.music.granted": "Access allowed",
  "settings.music.manage": "Manage or remove access",
  "settings.music.hint.missing":
    "Only used to show and control your music during navigation. Android requires allowing MY OSM under “Notification access” for this. No data is collected.",
  "settings.music.hint.granted":
    "Only used to show and control your music during navigation. No data is collected.",
  "settings.music.hint.web": "Available in the Android app only.",

  "transit.startAria": "Start navigation for this journey",
  "transit.walkTo": "Walk {minutes} min to {place}",
  "transit.walk": "Walk {minutes} min",
  "transit.board": "Take {line} at {place}",
  "transit.boardPlain": "Board at {place}",
  "transit.direction": "towards {direction}",
  "transit.departsAt": "departs at {time}",
  "transit.alight": "Get off at {place}",
  "transit.arriveAt": "arrives at {time}",
  "transit.stopsLeft_one": "{count} stop",
  "transit.stopsLeft_other": "{count} stops",
  "transit.exit": "Exit {number} — {name}",
  "transit.exitUnnumbered": "Exit “{name}”",
  "transit.connection": "Follow “Correspondance” signs to {line}",
  "transit.arrived": "You have arrived",
  "transit.arrivedAt": "You have arrived at {place}",
  "transit.remaining": "What follows",
  "transit.done": "End of journey",
  "transit.next": "Next step",
  "transit.previous": "Previous step",
  "transit.ahead": "Moved one step ahead by hand",
  "transit.aheadMany": "Moved {count} steps ahead by hand",
  "transit.behind": "Moved one step back by hand",
  "transit.behindMany": "Moved {count} steps back by hand",
  "transit.resync": "Follow the timetable",

  "sim.start": "Simulate walking",
  "sim.stop": "Stop the simulation",

  // -------------------------------------------------------------------------
  // Car navigation (`src/navigation/car/`)
  // -------------------------------------------------------------------------

  "car.start": "Start",
  "car.startAria": "Pick a route and start navigation",
  "car.pickOnMap": "Tap a route to see it, tap again to set off",
  "car.pickOnMapSingle": "Tap the route to set off",
  "car.computingChoices": "Looking for routes…",
  "car.cancel": "Cancel",
  "car.incident.roadworks": "Roadworks",
  "car.incident.closure": "Road closed",
  "car.incident.accident": "Accident",
  "car.incident.other": "Incident",
  "car.arrivalAt": "Arrival time",
  "car.tollFree": "Toll-free",
  "car.tollUnpriced": "Toll, price not published",
  "car.tollAtLeast": "at least {price}",
  "car.trafficDelay": "+{minutes} min traffic",
  "car.noKeyHint":
    "Without a TomTom key the route ignores live traffic, and tolls are neither avoided nor priced.",

  "car.then": "then",
  "car.lanes": "Lanes to use",
  "car.computing": "Calculating the route…",
  "car.locating": "Looking for your position…",
  "car.rerouting": "Recalculating the route…",
  "car.trafficRerouted": "Route changed — {minutes} min saved on traffic",
  "car.offRoute": "You have left the route",
  "car.arrived": "You have arrived",
  "car.arrivedAt": "You have arrived at {name}",

  "car.remaining": "Time left",
  "car.distance": "Distance left",
  "car.recenter": "Recentre",
  "car.stop": "End",
  "car.kmh": "km/h",
  "car.limit": "Speed limit",
  "car.speedStale": "Signal lost — last known speed",

  "car.radarFixed": "Fixed speed camera",
  "car.radarTower": "Speed camera tower",
  "car.radarAverage": "Average speed camera",
  "car.radarLight": "Red light camera",
  "car.radarCrossing": "Level crossing camera",

  "car.depart": "Set off",
  "car.arrive": "You have arrived",
  "car.waypoint": "Stop {index} reached",
  "car.straight": "Straight on",
  "car.left": "Turn left",
  "car.right": "Turn right",
  "car.slightLeft": "Bear left",
  "car.slightRight": "Bear right",
  "car.sharpLeft": "Turn sharp left",
  "car.sharpRight": "Turn sharp right",
  "car.keepLeft": "Keep left",
  "car.keepRight": "Keep right",
  "car.uturn": "Make a U-turn",
  "car.roundabout": "At the roundabout",
  "car.roundaboutExit": "Roundabout, exit {exit}",
  "car.merge": "Merge",
  "car.fork": "At the fork",
  "car.enterMotorway": "Join the motorway",
  "car.exit": "Take the exit",
  "car.exitNumbered": "Exit {exit}",

  "car.errorNoRoute": "No road route between these points.",
  "car.errorService": "Routing service unavailable ({status}).",

  "sim.startDrive": "Simulate driving",
  "sim.stopDrive": "Stop the simulation",
};

const DICTS: Record<string, NavDict> = { fr, en };

/**
 * Traduit une clé du guidage. Utilisable partout, y compris hors de React :
 * la langue est lue à l'appel, comme le `t()` du projet.
 */
export function navText(key: NavKey, vars?: Record<string, string | number>): string {
  const template = DICTS[currentLang()]?.[key] ?? fr[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/**
 * Ce dont un composant du guidage a besoin, **et l'abonnement** qui le
 * redessine au changement de langue : `useI18n()` est appelé pour lui seul,
 * c'est lui qui porte l'abonnement au magasin de langue du projet.
 */
export function useNav(): { nav: typeof navText; locale: string } {
  const { locale } = useI18n();
  return { nav: navText, locale };
}

/** L'heure d'arrivée, dans la locale de l'interface. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
}

/**
 * Traduit une clé au pluriel, à partir des variantes `<clé>_one` et
 * `<clé>_other` — même règle que le `tp()` du projet : le français dit
 * « 0 arrêt » là où l'anglais dit « 0 stops ».
 */
export function navPlural(
  key: string,
  count: number,
  vars?: Record<string, string | number>
): string {
  const one = currentLang() === "fr" ? Math.abs(count) < 2 : Math.abs(count) === 1;
  return navText(`${key}_${one ? "one" : "other"}` as NavKey, { count, ...vars });
}

/**
 * Le temps restant, coupé en un nombre et son unité — c'est le nombre qui est
 * écrit en gros dans la barre, l'unité en petit dessous.
 *
 * Au-delà de l'heure il n'y a plus d'unité à mettre à part : `1h20` se lit
 * d'un bloc, et un « min » accroché dessous ne dirait rien de plus. Les minutes
 * y sont écrites sur deux chiffres, comme une heure — `1h05`, jamais `1h5`.
 */
export function splitDuration(seconds: number): { value: string; unit: string | null } {
  const totalMin = Math.max(0, Math.round(seconds / 60));
  if (totalMin < 60) return { value: String(totalMin), unit: navText("nav.minutes") };
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return { value: `${hours}h${String(minutes).padStart(2, "0")}`, unit: null };
}

/**
 * Une distance de guidage, arrondie comme on l'annonce à voix haute : au mètre
 * jusqu'à dix, à la dizaine jusqu'à cent, à la cinquantaine ensuite. Annoncer
 * « dans 187 mètres » donnerait une précision que le GPS n'a pas.
 */
export function formatGuidanceDistance(meters: number): string {
  if (meters < 10) return `${Math.max(0, Math.round(meters))} m`;
  if (meters < 100) return `${Math.round(meters / 10) * 10} m`;
  if (meters < 1000) return `${Math.round(meters / 50) * 50} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}
