// ---------------------------------------------------------------------------
// Les combinateurs de signaux d'annulation, avec leur repli.
//
// `AbortSignal.any` et `AbortSignal.timeout` sont récents : la première demande
// une WebView 116 (août 2023), la seconde 103. L'application s'installe à
// partir d'Android 7 (`minSdkVersion 24`), où la WebView peut être bien plus
// ancienne — et Vite ne transpile pas les **méthodes** manquantes, seulement la
// syntaxe. Sans ces replis, le téléchargement d'une zone levait un `TypeError`
// dès la première tuile, c'est-à-dire que la fonction centrale de
// l'application ne démarrait pas du tout ; la couche transport tombait de même.
//
// Les deux fonctions préfèrent l'implantation native quand elle existe : le
// repli ne sert que là où elle manque.
// ---------------------------------------------------------------------------

/**
 * Un signal qui s'arrête dès que l'un des signaux donnés s'arrête. Les valeurs
 * absentes sont ignorées, ce qui permet de passer des signaux facultatifs.
 */
export function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const list = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (typeof AbortSignal.any === "function") return AbortSignal.any(list);

  const controller = new AbortController();
  // Déjà arrêté : inutile de poser quoi que ce soit.
  const already = list.find((signal) => signal.aborted);
  if (already) {
    controller.abort(already.reason);
    return controller.signal;
  }

  const stop = () => {
    for (const signal of list) signal.removeEventListener("abort", onAbort);
  };
  const onAbort = (event: Event) => {
    stop();
    controller.abort((event.target as AbortSignal).reason);
  };
  for (const signal of list) signal.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

/** Un signal qui s'arrête tout seul au bout de `ms`, avec la même erreur que la version native. */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);

  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("Délai dépassé", "TimeoutError")), ms);
  return controller.signal;
}
