import { describe, expect, it } from "vitest";
import { designatesSpecificPlace, groupStops, looksLikeStation, resultKind, stationsFirst } from "../src/search/searchResults";
import type { Place } from "../src/types";

const stop = (id: string, name: string, rawType: string, lon: number, lat: number): Place => ({
  id, name, group: "transport", rawType, lon, lat,
});
const address: Place = { id: "a", name: "56 Rue de la Roquette", group: null, lon: 2.372, lat: 48.854 };
const park: Place = { id: "p", name: "Parc de Bercy", group: "outdoors", rawType: "park", lon: 2.38, lat: 48.835 };

describe("nature d'un résultat", () => {
  it("distingue adresse, lieu et arrêt", () => {
    expect(resultKind(address)).toBe("address");
    expect(resultKind(park)).toBe("place");
    expect(resultKind(stop("s", "Bastille", "subway", 2.369, 48.853))).toBe("transit");
  });
});

describe("regroupement des arrêts", () => {
  it("réunit métro et bus du même nom au même endroit, et ouvre la station", () => {
    const bus = stop("b", "Bastille", "bus_stop", 2.3690, 48.8532);
    const metro = stop("m", "Bastille", "subway", 2.3692, 48.8530);
    const entries = groupStops([bus, address, metro]);
    expect(entries).toHaveLength(2);
    expect(entries[0].members).toHaveLength(2);
    expect(entries[0].place.id).toBe("m");
  });

  it("réunit aussi les quais sous leur station (« Opéra » : quatre quais)", () => {
    const station = stop("s", "Opéra", "station", 2.3312, 48.8706);
    const quais = [1, 2, 3, 4].map((n) => stop(`q${n}`, "Opéra", "stop", 2.331 + n * 0.0003, 48.8712));
    const entries = groupStops([station, ...quais]);
    expect(entries).toHaveLength(1);
    expect(entries[0].members).toHaveLength(5);
  });

  it("réunit les variantes de nom et les entrées (« Gare du Nord »), sous le nom le plus court", () => {
    const places = [
      stop("m", "Gare du Nord (Métro)", "station", 2.3572, 48.8796),
      stop("u", "Gare du Nord USFRT", "stop", 2.3544, 48.8792),
      stop("s", "Gare du Nord", "stop", 2.3564, 48.8797),
      stop("e", "Gare du Nord", "train_station_entrance", 2.3577, 48.8813),
      stop("b", "Gare du Nord - Dunkerque", "bus_stop", 2.3553, 48.8799),
    ];
    const entries = groupStops(places);
    expect(entries).toHaveLength(1);
    // La station, débarrassée de la précision entre parenthèses.
    expect(entries[0].place.id).toBe("m");
    expect(entries[0].place.name).toBe("Gare du Nord");
  });

  it("ne confond pas un nom avec un autre qui le contient sans être le même mot", () => {
    const a = stop("1", "Gare", "station", 2.30, 48.85);
    const b = stop("2", "Garenne", "station", 2.3005, 48.8502);
    expect(groupStops([a, b])).toHaveLength(2);
  });

  it("ouvre la station et non l'un de ses quais (« Saint-Denis - Université »)", () => {
    // L'ordre est celui du géocodeur : le quai au nom le plus court arrivait
    // en tête et l'emportait, faute de départager station et quai.
    const quais = [1, 2, 3].map((n) => stop(`q${n}`, "Saint-Denis - Université", "stop", 2.3641 + n * 0.0002, 48.9457));
    const serre = stop("c", "Saint-Denis-Université", "stop", 2.3652, 48.94596);
    const station = stop("s", "Saint-Denis - Université", "station", 2.36465, 48.94586);
    const entries = groupStops([...quais, serre, station]);
    expect(entries).toHaveLength(1);
    expect(entries[0].place.id).toBe("s");
    expect(entries[0].place.name).toBe("Saint-Denis - Université");
  });

  it("écarte ce qui porte le nom exact de la station au même endroit", () => {
    const station = stop("s", "Saint-Denis - Université", "station", 2.36465, 48.94586);
    // Le bâtiment voyageurs, rendu sans catégorie, et la station de vélos.
    const batiment: Place = { id: "w", name: "Saint-Denis - Université", group: null, rawType: "transportation", lon: 2.36477, lat: 48.9459 };
    const velos: Place = { id: "v", name: "Saint-Denis - Université", group: "shop", rawType: "bicycle_rental", lon: 2.3638, lat: 48.94567 };
    const entries = groupStops([batiment, station, velos]);
    expect(entries).toHaveLength(1);
    expect(entries[0].place.id).toBe("s");
  });

  it("ne fait pas disparaître un lieu dont le nom commence seulement pareil", () => {
    const station = stop("s", "Bastille", "station", 2.3692, 48.8530);
    const cafe: Place = { id: "c", name: "Bastille Café", group: "food", rawType: "cafe", lon: 2.3695, lat: 48.8533 };
    expect(groupStops([station, cafe])).toHaveLength(2);
  });

  it("réunit la station et le nom qui la contient (« Gare Saint-Lazare », « Station Berri-UQAM »)", () => {
    const places = [
      stop("a", "Saint-Lazare", "station", 2.3252, 48.8757),
      stop("b", "Gare Saint-Lazare", "station", 2.3245, 48.8754),
      stop("c", "Paris-Saint-Lazare", "station", 2.3262, 48.8760),
    ];
    const entries = groupStops(places);
    expect(entries).toHaveLength(1);
    expect(entries[0].members).toHaveLength(3);
  });

  it("réunit les arrêts d'une grande station jusqu'à 700 m (« Châtelet »)", () => {
    const station = stop("s", "Châtelet", "station", 2.3470, 48.8586);
    // Châtelet - Les Halles, à quelque cinq cents mètres de là.
    const rer = stop("r", "Châtelet - Les Halles", "stop", 2.3465, 48.8625);
    expect(groupStops([station, rer])).toHaveLength(1);
  });

  it("garde séparés deux arrêts homonymes éloignés (« Mairie »)", () => {
    const a = stop("1", "Mairie", "bus_stop", 2.30, 48.85);
    const b = stop("2", "Mairie", "bus_stop", 2.40, 48.80);
    expect(groupStops([a, b])).toHaveLength(2);
  });
});

describe("lieux rendus plusieurs fois", () => {
  const street = (id: string, name: string, address: string, lon: number, lat: number): Place => ({
    id, name, group: null, rawType: "residential", lon, lat, address,
  });

  it("réunit les tronçons d'une même voie, même sous des codes postaux différents", () => {
    const entries = groupStops([
      street("1", "King's Cross Road", "WC1X London", -0.1155, 51.5285),
      street("2", "King's Cross Road", "N1 London", -0.1148, 51.5305),
    ]);
    expect(entries).toHaveLength(1);
  });

  it("garde deux voies homonymes de deux communes", () => {
    const entries = groupStops([
      street("1", "Rue de la Gare", "35000 Rennes", -1.6778, 48.1173),
      street("2", "Rue de la Gare", "44000 Nantes", -1.5536, 47.2184),
    ]);
    expect(entries).toHaveLength(2);
  });

  it("ne réunit pas deux commerces d'une même enseigne à deux adresses", () => {
    // Le géocodeur donne la rue d'un commerce, et son numéro quand il l'a :
    // deux McDonald's voisins ne portent donc pas la même adresse, et le
    // rapprochement par la distance ne vaut que pour ce qui n'a pas de
    // catégorie — une voie, une place.
    const shop = (id: string, street: string, lon: number): Place => ({
      id, name: "McDonald's", group: "food", rawType: "fast_food", lon, lat: 48.8566,
      address: `${street} 75001 Paris`,
    });
    const entries = groupStops([shop("1", "Rue de Rivoli", 2.35), shop("2", "Rue Saint-Honoré", 2.354)]);
    expect(entries).toHaveLength(2);
  });
});

describe("ressemblance à une station (70 %)", () => {
  it("accepte le nom exact, sans accents ni majuscules", () => {
    expect(looksLikeStation("gare de lyon", "Gare de Lyon")).toBe(true);
    expect(looksLikeStation("chatelet", "Châtelet")).toBe(true);
  });
  it("accepte une faute de frappe", () => {
    expect(looksLikeStation("bastile", "Bastille")).toBe(true);
  });
  it("accepte un début de nom dès trois lettres", () => {
    expect(looksLikeStation("Ranel", "Ranelagh")).toBe(true);
    expect(looksLikeStation("Ra", "Ranelagh")).toBe(false);
  });
  it("refuse un mot pris au milieu du nom", () => {
    expect(looksLikeStation("lyon", "Gare de Lyon")).toBe(false);
  });
  it("accepte plusieurs mots pris dans le nom (« part dieu » → « Lyon Part-Dieu »)", () => {
    expect(looksLikeStation("part-dieu", "Lyon Part-Dieu")).toBe(true);
    expect(looksLikeStation("gare de lyon", "Paris Gare de Lyon")).toBe(true);
  });
});

describe("stations en tête", () => {
  it("fait passer la station ressemblante devant les autres, dans leur ordre", () => {
    const station = stop("m", "Bastille", "subway", 2.369, 48.853);
    const entries = groupStops([address, park, station]);
    expect(stationsFirst(entries, "bastille").map((e) => e.place.id)).toEqual(["m", "a", "p"]);
  });
  it("ne touche à rien sans station ressemblante", () => {
    const entries = groupStops([address, park]);
    expect(stationsFirst(entries, "roquette")).toBe(entries);
  });
});

describe("« afficher tous les … » seulement pour ce qui se répète", () => {
  const never = () => false;
  const always = () => true;
  const food = (id: string): Place => ({ id, name: "McDonald's", group: "fastfood", rawType: "fast_food", lon: 2.35, lat: 48.85 });

  it("se tait pour une station, même à moitié tapée", () => {
    const station = stop("m", "Ranelagh", "subway", 2.27, 48.855);
    expect(designatesSpecificPlace("Ranel", groupStops([station]), always)).toBe(true);
  });
  it("se tait pour une rue ou une adresse", () => {
    expect(designatesSpecificPlace("rue de Rivoli", [], always)).toBe(true);
    expect(designatesSpecificPlace("56 rue de la roquette", [], always)).toBe(true);
    expect(designatesSpecificPlace("Avenue Mozart", [], always)).toBe(true);
  });
  it("se tait pour un lieu unique nommé exactement", () => {
    expect(designatesSpecificPlace("Parc de Bercy", groupStops([park]), never)).toBe(true);
  });
  it("reste pour une enseigne, même si une voie porte aussi son nom", () => {
    const street: Place = { id: "s", name: "Mcdonald's", group: null, lon: 2.7, lat: 47.9 };
    expect(designatesSpecificPlace("McDonald's", groupStops([street, food("1"), food("2")]), always)).toBe(false);
  });
  it("reste pour une enseigne qui se répète", () => {
    expect(designatesSpecificPlace("McDonald's", groupStops([food("1"), food("2")]), always)).toBe(false);
    expect(designatesSpecificPlace("Starbucks", [], always)).toBe(false);
  });
});
