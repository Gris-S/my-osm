// ---------------------------------------------------------------------------
// Comparer une saisie à un nom, comme le fait une barre de recherche : accents,
// casse et ponctuation ignorés, chaque mot tapé est un **début** de mot du nom
// (« boul ma » trouve « Boulangerie Martin »), et une faute de frappe passe sur
// les mots assez longs pour qu'elle ne change pas de sens (« boulangeire »).
//
// Pur et testé (`tests/searchText.test.ts`) : la recherche instantanée sur les
// lieux de la carte, les catégories et les enseignes s'en servent toutes.
// ---------------------------------------------------------------------------

/** Minuscules, sans accents ni ponctuation, espaces réduits. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Distance d'édition (insertion, suppression, substitution, inversion de deux lettres). */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2.splice(0, prev2.length, ...prev);
    prev = cur;
  }
  return prev[b.length];
}

/** Fautes tolérées pour un mot tapé : aucune sous 5 lettres, une jusqu'à 8, deux au-delà. */
export function allowedTypos(word: string): number {
  return word.length < 5 ? 0 : word.length <= 8 ? 1 : 2;
}

/**
 * Le mot tapé commence-t-il le mot du nom, à quelques fautes près ? La faute
 * se compte sur le début du mot du nom, de la longueur de la saisie : « boulangeire »
 * contre « boulangerie », « pharmaci » contre « pharmacie ».
 */
function wordMatches(typed: string, word: string): "exact" | "prefix" | "fuzzy" | null {
  if (word === typed) return "exact";
  if (word.startsWith(typed)) return "prefix";
  const typos = allowedTypos(typed);
  if (typos === 0) return null;
  const head = word.slice(0, typed.length);
  if (editDistance(typed, head, typos) <= typos) return "fuzzy";
  if (editDistance(typed, word, typos) <= typos) return "fuzzy";
  return null;
}

/**
 * À quel point le nom répond à la saisie, de 0 (pas du tout) à 1 (identique).
 * Chaque mot tapé doit trouver un mot du nom ; le nom entier tapé l'emporte
 * sur un début, un début sur une faute.
 */
export function textScore(query: string, name: string): number {
  return normalizedTextScore(normalizeText(query), normalizeText(name));
}

/** `textScore` sur des textes déjà passés par `normalizeText` (boucles sur des milliers de lieux). */
export function normalizedTextScore(q: string, n: string): number {
  if (!q || !n) return 0;
  if (q === n) return 1;
  const words = n.split(" ");
  let total = 0;
  for (const typed of q.split(" ")) {
    let best = 0;
    for (const word of words) {
      const match = wordMatches(typed, word);
      const value = match === "exact" ? 1 : match === "prefix" ? 0.8 : match === "fuzzy" ? 0.6 : 0;
      if (value > best) best = value;
    }
    if (best === 0) return 0;
    total += best;
  }
  const score = total / q.split(" ").length;
  // Le nom commence par la saisie : c'est ce qu'on attend en premier.
  return n.startsWith(q) ? Math.min(0.95, score + 0.1) : score * 0.9;
}

/** Singulier approximatif d'un mot, pour que « pharmacies » trouve « pharmacie ». */
export function singular(word: string): string {
  return word.length > 3 && /[sx]$/.test(word) ? word.slice(0, -1) : word;
}
