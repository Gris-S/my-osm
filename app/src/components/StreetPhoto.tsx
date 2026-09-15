import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { CONFIG } from "../config";
import type { LonLat } from "../types";
import type { StreetPhotoRef } from "./MapView";
import { t as translate, useI18n } from "../i18n";
import { useBackClose } from "../hooks/useBackClose";

// ---------------------------------------------------------------------------
// Photo de rue Mapillary : le visualiseur officiel.
//
// `mapillary-js` fait ce qu'un simple affichage d'image ne peut pas faire —
// pivoter la caméra dans la photo, avancer et reculer le long de la rue,
// tourner aux intersections par les flèches posées au sol, dérouler les
// panoramas.
//
// Il pèse 2,5 Mo, d'où le **chargement à la demande** : le module et sa feuille
// de style ne sont importés qu'à l'ouverture de la première photo, jamais au
// démarrage de la carte. Vite en tire un fragment séparé, et qui n'ouvre pas de
// photo ne le télécharge jamais.
// ---------------------------------------------------------------------------

/** Ce que le visualiseur dit de la photo affichée. */
interface Shown {
  id: string;
  capturedAt?: number;
}

type Status = "loading" | "ready" | "error";

/** Délai au-delà duquel une vue qui n'affiche toujours rien est déclarée en panne. */
const VIEWER_TIMEOUT_MS = 12000;

/**
 * Trace de mise au point, en développement seulement.
 *
 * Le visualiseur peut échouer sans rien dire — jeton refusé, conteneur sans
 * taille, image introuvable — et un rectangle vide ne se diagnostique pas. Ces
 * lignes disent où l'on s'arrête. Elles disparaissent du build de production.
 */
function trace(message: string, detail?: unknown) {
  if (import.meta.env.DEV) console.info(`[vue de rue] ${message}`, detail ?? "");
}

interface StreetPhotoProps {
  photo: StreetPhotoRef;
  /** Plein écran : la photo prend toute la place, l'interface s'efface. */
  expanded: boolean;
  onToggleExpanded: () => void;
  /**
   * Position et orientation de la vue : la carte y plante son repère, et le
   * cône montre dans quelle direction on regarde.
   */
  onPosition: (position: LonLat & { bearing?: number }) => void;
  onClose: () => void;
}

export function StreetPhoto({ photo, expanded, onToggleExpanded, onPosition, onClose }: StreetPhotoProps) {
  const { t, locale } = useI18n();
  // Le geste retour sort du plein écran, puis ferme — comme Échap.
  useBackClose(true, () => (expanded ? onToggleExpanded() : onClose()));
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<{ moveTo(id: string): Promise<unknown>; resize(): void; remove(): void } | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [shown, setShown] = useState<Shown | null>(null);
  // Ce qui a échoué, quand quelque chose échoue : un rectangle vide ne se
  // diagnostique pas, un message si.
  const [failure, setFailure] = useState<string | null>(null);

  // Le rappel du parent est lu par une ref : le visualiseur n'est créé qu'une
  // fois, ses abonnements avec lui.
  const onPositionRef = useRef(onPosition);
  useEffect(() => {
    onPositionRef.current = onPosition;
  }, [onPosition]);
  // Dernières coordonnées connues : la boussole du visualiseur change bien
  // plus souvent que la photo, et il faut les deux pour orienter le repère.
  const coordsRef = useRef<LonLat | null>(null);

  // Photo de départ : celle qu'on a cliquée. Les suivantes se rejoignent par
  // `moveTo`, sans reconstruire le visualiseur.
  const shownId = useRef(photo.id);
  // Construction en cours : sans ce garde, le double montage de `StrictMode`
  // en lancerait deux, la première n'étant pas encore posée dans la ref.
  const buildingRef = useRef(false);
  // Démontage programmé, et annulable.
  const removalRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;

    // `StrictMode` monte les effets deux fois en développement : démonter le
    // visualiseur au premier nettoyage revenait à détruire une vue qui venait
    // d'être construite — elle recevait bien ses images, mais dans un conteneur
    // vidé, d'où un cadre blanc. Le démontage est donc **différé** et annulé
    // si l'effet repart aussitôt : le visualiseur traverse le double montage.
    if (removalRef.current !== null) {
      window.clearTimeout(removalRef.current);
      removalRef.current = null;
    }

    if (container && !viewerRef.current && !buildingRef.current) {
      buildingRef.current = true;

      (async () => {
        try {
          const [{ Viewer }] = await Promise.all([import("mapillary-js"), import("mapillary-js/dist/mapillary.css")]);
          trace("module chargé");
          trace("conteneur", { largeur: container.clientWidth, hauteur: container.clientHeight });

          const viewer = new Viewer({
            accessToken: CONFIG.MAPILLARY_TOKEN,
            container,
            imageId: shownId.current,
            component: {
              // `cover` est l'écran d'attente cliquable de Mapillary : on a
              // déjà cliqué pour arriver ici, il ferait un clic de trop.
              cover: false,
              // La barre de lecture de la séquence (lecture, précédent,
              // suivant, curseur) posée en haut de l'image : elle double les
              // flèches au sol, qui suffisent à remonter la rue, et masque le
              // haut de la photo.
              sequence: false,
            },
            // Le découpage en tuiles ne sert qu'à gagner du détail en zoomant
            // très près, et demande au jeton des droits que tous n'ont pas. La
            // vignette suffit à regarder une rue.
            imageTiling: false,
          });

          viewer.on("image", ({ image }) => {
            trace("image reçue", image.id);
            shownId.current = image.id;
            setShown({ id: image.id, capturedAt: image.capturedAt });
            setStatus("ready");
            coordsRef.current = { lon: image.lngLat.lng, lat: image.lngLat.lat };
            onPositionRef.current(coordsRef.current);
          });

          // La caméra pivote : le cône sur la carte pivote avec elle.
          viewer.on("bearing", ({ bearing }) => {
            if (coordsRef.current) onPositionRef.current({ ...coordsRef.current, bearing });
          });

          trace("visualiseur construit");
          // La bibliothèque vient de poser sa classe sur le conteneur : on
          // remesure, c'est là que la mise en page peut s'effondrer.
          requestAnimationFrame(() =>
            trace("conteneur après attachement", { largeur: container.offsetWidth, hauteur: container.offsetHeight })
          );
          viewerRef.current = viewer;
          // La taille est mesurée à la construction : une mesure de plus, une
          // image plus tard, évite une vue tronquée si le bandeau vient
          // d'apparaître.
          requestAnimationFrame(() => viewerRef.current?.resize());

          // Une vue qui ne rend jamais rien ne se signale pas d'elle-même : au
          // bout de douze secondes sans la moindre photo, on le dit.
          window.setTimeout(() => {
            setStatus((current) => {
              if (current === "ready") return current;
              setFailure(translate("photo.noImage"));
              return "error";
            });
          }, VIEWER_TIMEOUT_MS);
        } catch (error) {
          // L'échec est montré tel quel : c'est la seule chose qui permette de
          // savoir ce qui manque — jeton refusé, module introuvable, WebGL
          // indisponible.
          setFailure(error instanceof Error ? error.message : String(error));
          setStatus("error");
          console.error("Vue de rue Mapillary :", error);
        } finally {
          buildingRef.current = false;
        }
      })();
    }

    return () => {
      // Différé d'un tour de boucle : si l'effet repart dans la foulée (double
      // montage), la ligne au-dessus annule ce démontage.
      removalRef.current = window.setTimeout(() => {
        viewerRef.current?.remove();
        viewerRef.current = null;
        // `remove()` libère le contexte WebGL mais laisse sa trace dans le
        // DOM : on rend le conteneur tel qu'on l'a reçu.
        if (container) container.innerHTML = "";
        removalRef.current = null;
      }, 0);
    };
  }, []);

  // Un autre point cliqué sur la carte : on s'y rend, sans tout reconstruire.
  useEffect(() => {
    if (!viewerRef.current || photo.id === shownId.current) return;
    viewerRef.current.moveTo(photo.id).catch(() => {
      /* photo indisponible : le visualiseur reste où il est */
    });
  }, [photo.id]);

  // Le visualiseur dessine dans un canevas : il faut lui dire que sa place a
  // changé, sinon l'image reste à la taille du bandeau réduit.
  useEffect(() => {
    viewerRef.current?.resize();
  }, [expanded]);

  // Échap sort du plein écran, puis ferme. Le reste du clavier et la souris
  // appartiennent au visualiseur, qui en fait la rotation et la navigation.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (expanded) onToggleExpanded();
      else onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded, onToggleExpanded, onClose]);

  const date = shown?.capturedAt
    ? new Date(shown.capturedAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className={`street-photo ${expanded ? "is-expanded" : ""}`}>
      <div className="street-photo-head">
        <span className="street-photo-title">
          {t("photo.title")}
          {date ? ` · ${date}` : ""}
        </span>
        <button
          className="street-photo-close"
          onClick={onToggleExpanded}
          aria-label={expanded ? t("photo.reduce") : t("photo.expand")}
          title={expanded ? t("photo.reduceShort") : t("photo.expandShort")}
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button className="street-photo-close" onClick={onClose} aria-label={t("photo.close")}>
          <X size={16} />
        </button>
      </div>

      <div className="street-photo-stage">
        {/* Le visualiseur remplit ce conteneur et y dessine en WebGL : React
            n'y touche plus une fois qu'il est monté. */}
        <div className="street-photo-viewer" ref={containerRef} />
        {status === "loading" && <p className="street-photo-note">{t("photo.loading")}</p>}
        {status === "error" && (
          <p className="street-photo-note">
            {t("photo.failed")}
            {failure && <span className="street-photo-failure">{failure}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
