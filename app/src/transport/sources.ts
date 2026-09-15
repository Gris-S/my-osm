// ---------------------------------------------------------------------------
// Le nom d'une source de transports, tel qu'on l'écrit sous des horaires ou un
// itinéraire. Ce sont des noms propres : ils ne se traduisent pas.
// ---------------------------------------------------------------------------

const NAMES: Record<string, string> = {
  idfm: "Île-de-France Mobilités",
  transitous: "Transitous",
};

export function sourceName(id: string | undefined): string {
  return (id && NAMES[id]) || id || "";
}
