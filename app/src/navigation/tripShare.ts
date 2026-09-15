import { navText } from "./strings";

// ---------------------------------------------------------------------------
// Faire sortir l'image d'un trajet de l'application.
//
// **Le partage du système doit être appelé dans le geste même de
// l'utilisateur.** Les navigateurs n'ouvrent la feuille de partage que sous
// « activation transitoire » : quelques secondes après le clic, la permission
// est perdue et `navigator.share` refuse. Fabriquer l'image d'abord — la carte
// met une à plusieurs secondes à peindre ses tuiles — puis appeler le partage
// arrivait donc toujours trop tard.
//
// D'où le partage en deux temps : l'image est **préparée à l'ouverture du
// détail**, pendant qu'on lit les chiffres, et le bouton n'est actif qu'une
// fois prête. Le clic n'a alors plus rien à attendre, et la feuille s'ouvre.
//
// Deux chemins, choisis sur **l'appareil et non sur ce que l'API propose** :
//
//   - **sur un téléphone ou une tablette**, la feuille de partage du système,
//     qui laisse choisir l'application — messagerie, notes, photos. C'est le
//     geste attendu là-bas, et il n'a pas d'équivalent ;
//   - **sur un ordinateur**, le presse-papiers, puis le téléchargement s'il
//     échoue. Chrome et Edge savent bien ouvrir une feuille de partage sous
//     Windows et macOS, mais on ne s'en sert pas : coller une image est plus
//     direct que passer par une boîte de dialogue système, et le comportement
//     reste le même sous Linux, où cette API n'existe dans aucun navigateur.
//     Un seul geste à connaître pour les trois systèmes.
//
// L'interface dit lequel a eu lieu : « partagé », « copié » et « enregistré »
// ne demandent pas la même chose ensuite.
// ---------------------------------------------------------------------------

export type ShareOutcome = "shared" | "cancelled" | "copied" | "downloaded";

/**
 * Fait sortir l'image. **À appeler directement depuis le gestionnaire du
 * clic**, sans `await` avant : c'est cette absence d'attente qui permet à la
 * feuille de partage de s'ouvrir.
 */
export function shareImage(blob: Blob, name: string): Promise<ShareOutcome> {
  const file = new File([blob], name, { type: "image/png" });

  // `canShare` est le seul moyen de savoir si **les fichiers** passent : un
  // navigateur peut connaître `share` et refuser les pièces jointes, et lui en
  // envoyer quand même fait échouer tout le partage.
  if (isHandheld() && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    return navigator
      .share({ title: navText("history.shareTitle"), files: [file] })
      .then<ShareOutcome>(() => "shared")
      // Annulation de l'utilisateur, ou refus du navigateur. On ne copie ni ne
      // télécharge dans son dos : un fichier qui apparaît sans qu'on l'ait
      // demandé ressemble à un incident.
      .catch<ShareOutcome>(() => "cancelled");
  }

  return copyImage(blob).then<ShareOutcome>((copied) => {
    if (copied) return "copied";
    download(blob, name);
    return "downloaded";
  });
}

/**
 * Vrai sur un téléphone ou une tablette, où la feuille de partage est le geste
 * attendu ; faux sur un ordinateur, où l'on préfère le presse-papiers.
 *
 * `userAgentData.mobile` est la réponse propre, mais elle n'existe que sur les
 * navigateurs Chromium : ailleurs, il faut lire la chaîne d'agent, avec le cas
 * particulier de l'iPad, qui se présente comme un Safari de bureau depuis
 * iOS 13 et que seul son nombre de points de contact trahit.
 */
function isHandheld(): boolean {
  const hints = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (typeof hints?.mobile === "boolean") return hints.mobile;

  const agent = navigator.userAgent;
  if (/Android|iPhone|iPod|iPad|IEMobile|Opera Mini/i.test(agent)) return true;
  return /Macintosh/.test(agent) && navigator.maxTouchPoints > 1;
}

/**
 * Met l'image dans le presse-papiers. Elle se colle alors dans une messagerie,
 * un traitement de texte, un carnet de notes — ce qui, sur un ordinateur, tient
 * lieu de « partager vers l'application de mon choix ».
 *
 * L'API demande un contexte sécurisé et n'est pas partout : son échec n'est pas
 * une erreur, c'est le cas ordinaire qui mène au téléchargement. Elle est
 * appelée sans `await` préalable, comme le partage, parce qu'elle réclame la
 * même activation du geste.
 */
async function copyImage(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // L'URL est révoquée au tour suivant : la révoquer aussitôt annulerait le
  // téléchargement dans certains navigateurs.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Le nom du fichier : la date et la destination, lisibles dans un dossier. */
export function imageFileName(day: string, destination: string): string {
  const slug = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  const to = slug(destination).slice(0, 40);
  return `${to ? `${slug(day)}-${to}` : slug(day)}.png`;
}
