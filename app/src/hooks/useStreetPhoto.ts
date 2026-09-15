import { useCallback, useState } from "react";
import type { StreetPhotoRef } from "../components/MapView";
import type { LonLat } from "../types";

// ---------------------------------------------------------------------------
// La photo de rue ouverte, son plein écran et la position qu'elle montre.
// Sorti d'`App` sans rien changer : la carte suit la photo, et éteindre les
// photos de rue referme la vue.
// ---------------------------------------------------------------------------

export function useStreetPhoto(
  mapillary: boolean,
  setFlyTarget: (target: LonLat & { zoom?: number; initial?: boolean }) => void,
) {
  // Photo de rue ouverte, s'il y en a une, et son plein écran. En plein écran
  // toute l'interface flottante s'efface : on regarde la rue, pas les boutons.
  const [streetPhoto, setStreetPhoto] = useState<StreetPhotoRef | null>(null);
  const [photoExpanded, setPhotoExpanded] = useState(false);
  // Où l'on se tient dans la rue, et vers où l'on regarde : la carte y plante
  // un repère orienté, comme le personnage d'une vue immersive.
  const [streetPosition, setStreetPosition] = useState<(LonLat & { bearing?: number }) | null>(null);

  const closeStreetPhoto = useCallback(() => {
    setStreetPhoto(null);
    setPhotoExpanded(false);
    setStreetPosition(null);
  }, []);

  // La carte suit la photo consultée. Elle ne se recentre qu'au **changement
  // de photo** : la boussole, elle, change à chaque mouvement de souris, et
  // recentrer à chaque degré rendrait la carte inutilisable.
  const handlePhotoPosition = useCallback((position: LonLat & { bearing?: number }) => {
    setStreetPosition((current) => {
      if (!current || current.lon !== position.lon || current.lat !== position.lat) {
        setFlyTarget({ lon: position.lon, lat: position.lat });
      }
      return position;
    });
  }, [setFlyTarget]);
  // Éteindre les photos de rue referme la vue : les points ayant disparu de la
  // carte, la fenêtre resterait ouverte sur un endroit qu'on ne peut plus
  // désigner.
  const [photosOn, setPhotosOn] = useState(mapillary);
  if (photosOn !== mapillary) {
    setPhotosOn(mapillary);
    if (!mapillary) {
      setStreetPhoto(null);
      setPhotoExpanded(false);
      setStreetPosition(null);
    }
  }

  return { streetPhoto, setStreetPhoto, photoExpanded, setPhotoExpanded, streetPosition, closeStreetPhoto, handlePhotoPosition };
}
