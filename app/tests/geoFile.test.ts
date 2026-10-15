import { describe, expect, it } from "vitest";
import { geoFileBounds, nearestOrder, parseGeoFile, thinTrack, tracksLength } from "../src/services/geoFile";

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="essai" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Boucle de Vincennes</name></metadata>
  <wpt lat="48.8283" lon="2.4352"><name><![CDATA[Château & donjon]]></name></wpt>
  <wpt lat="48.8350" lon="2.4400"/>
  <trk><name>Trace</name><trkseg>
    <trkpt lat="48.8283" lon="2.4352"><ele>50</ele></trkpt>
    <trkpt lat="48.8300" lon="2.4400"></trkpt>
    <trkpt lat="48.8350" lon="2.4400"/>
  </trkseg></trk>
</gpx>`;

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Mes lieux</name>
  <Placemark><name>Gare de Lyon</name><Point><coordinates>2.3736,48.8443,0</coordinates></Point></Placemark>
  <Placemark><name>Balade</name><LineString><coordinates>
    2.37,48.84,0 2.38,48.85,0
  </coordinates></LineString></Placemark>
</Document></kml>`;

describe("ouvrir un fichier de points et de traces", () => {
  it("lit un GPX : nom, points nommés, trace", () => {
    const file = parseGeoFile("boucle.gpx", GPX);
    expect(file?.name).toBe("Boucle de Vincennes");
    expect(file?.points).toEqual([
      { lat: 48.8283, lon: 2.4352, name: "Château & donjon" },
      { lat: 48.835, lon: 2.44, name: "" },
    ]);
    expect(file?.tracks).toHaveLength(1);
    expect(file?.tracks[0]).toHaveLength(3);
    expect(tracksLength(file!.tracks)).toBeGreaterThan(700);
  });

  it("accepte un GPX à préfixe d'espace de noms", () => {
    const file = parseGeoFile("x.gpx", `<gpx:gpx xmlns:gpx="x"><gpx:wpt lat="1" lon="2"><gpx:name>A</gpx:name></gpx:wpt></gpx:gpx>`);
    expect(file?.points).toEqual([{ lat: 1, lon: 2, name: "A" }]);
  });

  it("lit un KML : points et lignes, nom du document", () => {
    const file = parseGeoFile("lieux.kml", KML);
    expect(file?.name).toBe("Mes lieux");
    expect(file?.points).toEqual([{ lon: 2.3736, lat: 48.8443, name: "Gare de Lyon" }]);
    expect(file?.tracks[0]).toEqual([
      { lon: 2.37, lat: 48.84 },
      { lon: 2.38, lat: 48.85 },
    ]);
  });

  it("lit un GeoJSON, et prend le nom du fichier faute d'autre", () => {
    const file = parseGeoFile(
      "sortie.geojson",
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { name: "Départ" }, geometry: { type: "Point", coordinates: [2.35, 48.85] } },
          { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[2.35, 48.85], [2.36, 48.86]] } },
        ],
      }),
    );
    expect(file?.name).toBe("sortie");
    expect(file?.points[0]).toEqual({ lon: 2.35, lat: 48.85, name: "Départ" });
    expect(file && geoFileBounds(file)).toEqual([2.35, 48.85, 2.36, 48.86]);
  });

  it("refuse ce qui n'est pas une carte", () => {
    expect(parseGeoFile("notes.txt", "bonjour")).toBeNull();
    expect(parseGeoFile("vide.gpx", "<gpx></gpx>")).toBeNull();
    expect(parseGeoFile("faux.json", "{ pas du json")).toBeNull();
    expect(parseGeoFile("hors.gpx", `<gpx><wpt lat="200" lon="2"/></gpx>`)).toBeNull();
  });
});

describe("une trace avec ses consignes de guidage", () => {
  const consignes = ["Tournez à gauche sur Rue de B", "Restez sur la droite", "Tournez à droite", "Continuez tout droit"];
  const wpts = Array.from({ length: 12 }, (_, i) => `<wpt lat="48.${70 + i}" lon="2.1"><name>${i === 11 ? "End" : consignes[i % 4]}</name></wpt>`).join("");
  const trk = `<trk><trkseg>${Array.from({ length: 12 }, (_, i) => `<trkpt lat="48.${70 + i}" lon="2.1"/>`).join("")}</trkseg></trk>`;

  it("garde la trace, et met les consignes à part", () => {
    const file = parseGeoFile("boucle.gpx", `<gpx>${wpts}${trk}</gpx>`);
    expect(file?.points).toEqual([]);
    expect(file?.guidance).toHaveLength(12);
    expect(file?.tracks[0]).toHaveLength(12);
  });

  it("garde des lieux, même nombreux, qui ne sont pas des consignes", () => {
    const lieux = Array.from({ length: 12 }, (_, i) => `<wpt lat="48.${70 + i}" lon="2.1"><name>Café ${i}</name></wpt>`).join("");
    expect(parseGeoFile("cafés.gpx", `<gpx>${lieux}${trk}</gpx>`)?.points).toHaveLength(12);
  });

});

describe("garder une trace, ordonner des lieux", () => {
  it("allège une trace sans perdre ses bouts", () => {
    const track = Array.from({ length: 1001 }, (_, i) => ({ lon: 2 + i * 0.00001, lat: 48.8 }));
    const thin = thinTrack(track, 15);
    expect(thin.length).toBeLessThan(100);
    expect(thin[0]).toEqual(track[0]);
    expect(thin[thin.length - 1].lon).toBeCloseTo(track[1000].lon, 6);
  });

  it("visite le plus proche d'abord, depuis ma position", () => {
    const at = (name: string, lon: number) => ({ name, lon, lat: 48.8 });
    const order = nearestOrder({ lon: 2.0, lat: 48.8 }, [at("loin", 2.3), at("près", 2.01), at("milieu", 2.1)]);
    expect(order.map((p) => p.name)).toEqual(["près", "milieu", "loin"]);
  });
});
