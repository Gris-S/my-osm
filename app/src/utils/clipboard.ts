// ---------------------------------------------------------------------------
// Copie dans le presse-papiers.
//
// `navigator.clipboard` n'existe que dans un contexte sécurisé (HTTPS ou
// localhost) : servie en HTTP sur un réseau local — le cas quand on teste
// l'app depuis un téléphone — l'API est simplement absente. D'où le repli par
// champ de saisie hors écran, qui marche partout.
// ---------------------------------------------------------------------------

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission refusée ou contexte non sécurisé : on tente le repli */
  }

  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "-1000px";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

/** Coordonnées d'un lieu, dans la forme qu'attendent les applications de carte. */
export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}
