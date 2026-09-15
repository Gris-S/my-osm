import { describe, expect, it } from "vitest";
import {
  candidateFromPage,
  candidateFromSelection,
  cleanAddress,
  isNavigationLink,
  parseCoordinates,
  parseMapLink,
  placeFromCandidate,
  pointFromText,
  WEB_BLOCKED_HOSTS,
  WEB_LINK_PATTERNS,
  webSearchUrl,
} from "../src/services/webPlace";

describe("parseMapLink — la position d'un lien de carte, sans l'ouvrir", () => {
  it("Google Maps : le lieu (!3d!4d) plutôt que le centre de la vue (@)", () => {
    const link = parseMapLink(
      "https://www.google.com/maps/place/McDonald's/@48.6,2.4,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d48.6243!4d2.4401"
    );
    expect(link).toEqual({ kind: "point", lat: 48.6243, lon: 2.4401, label: "McDonald's" });
  });

  it("Google Maps : coordonnées dans q, ou adresse en texte", () => {
    expect(parseMapLink("https://maps.google.com/?q=48.8566,2.3522")).toMatchObject({ kind: "point", lat: 48.8566, lon: 2.3522 });
    expect(parseMapLink("https://www.google.fr/maps?q=12+rue+de+Rivoli+Paris")).toEqual({ kind: "query", text: "12 rue de Rivoli Paris" });
  });

  it("un lien Google raccourci n'est pas lisible sans interroger Google", () => {
    expect(parseMapLink("https://maps.app.goo.gl/abc123")).toEqual({ kind: "short" });
  });

  it("Plans d'Apple, ancien et nouveau format", () => {
    expect(parseMapLink("https://maps.apple.com/?ll=45.76,4.83&q=Bellecour")).toEqual({ kind: "point", lat: 45.76, lon: 4.83, label: "Bellecour" });
    expect(parseMapLink("https://maps.apple.com/place?coordinate=43.2965,5.3698&name=Vieux-Port")).toMatchObject({ lat: 43.2965, lon: 5.3698 });
    expect(parseMapLink("https://maps.apple.com/?daddr=1+Place+Bellecour,+Lyon")).toEqual({ kind: "query", text: "1 Place Bellecour, Lyon" });
  });

  it("OpenStreetMap, Waze, Bing, HERE", () => {
    expect(parseMapLink("https://www.openstreetmap.org/?mlat=44.84&mlon=-0.58#map=17/44.84/-0.58")).toMatchObject({ lat: 44.84, lon: -0.58 });
    expect(parseMapLink("https://www.openstreetmap.org/#map=18/43.6047/1.4442")).toMatchObject({ lat: 43.6047, lon: 1.4442 });
    expect(parseMapLink("https://waze.com/ul?ll=45.1885%2C5.7245&navigate=yes")).toMatchObject({ lat: 45.1885, lon: 5.7245 });
    expect(parseMapLink("https://www.waze.com/live-map/directions?to=ll.44.8745%2C-0.4289")).toMatchObject({ lat: 44.8745, lon: -0.4289 });
    expect(parseMapLink("https://www.bing.com/maps?cp=47.2184~-1.5536&lvl=16")).toMatchObject({ lat: 47.2184, lon: -1.5536 });
    expect(parseMapLink("https://share.here.com/l/50.6292,3.0573")).toMatchObject({ lat: 50.6292, lon: 3.0573 });
  });

  it("geo: avec position, avec position dans la question, ou avec une adresse", () => {
    expect(parseMapLink("geo:47.39,0.68")).toMatchObject({ lat: 47.39, lon: 0.68 });
    expect(parseMapLink("geo:0,0?q=48.85,2.29(Tour Eiffel)")).toEqual({ kind: "point", lat: 48.85, lon: 2.29, label: "Tour Eiffel" });
    expect(parseMapLink("geo:0,0?q=Place+Plumereau+Tours")).toEqual({ kind: "query", text: "Place Plumereau Tours" });
  });

  it("un lien qui n'est pas une carte ne donne rien", () => {
    expect(parseMapLink("https://example.com/contact")).toBeNull();
    expect(parseMapLink("pas un lien")).toBeNull();
  });
});

describe("motifs du navigateur intégré", () => {
  const blocked = new RegExp(WEB_BLOCKED_HOSTS, "i");
  const isMapLink = (url: string) => WEB_LINK_PATTERNS.some((pattern) => new RegExp(pattern, "i").test(url));

  it("bloque Google sous toutes ses formes, et rien d'autre", () => {
    for (const host of ["improving.duckduckgo.com", "google.fr", "www.google.com", "www.google.co.uk", "fonts.googleapis.com", "www.gstatic.com", "www.youtube.com", "stats.g.doubleclick.net"]) {
      expect(blocked.test(host), host).toBe(true);
    }
    for (const host of ["duckduckgo.com", "notgoogle.com", "google.example.org", "www.mcdonalds.fr", "openstreetmap.org"]) {
      expect(blocked.test(host), host).toBe(false);
    }
  });

  it("retient les liens de carte que parseMapLink sait lire, pas les autres", () => {
    expect(isMapLink("https://www.google.com/maps/place/X/@1.5,2.5")).toBe(true);
    expect(isMapLink("https://maps.app.goo.gl/abc")).toBe(true);
    expect(isMapLink("geo:0,0?q=Tours")).toBe(true);
    expect(isMapLink("https://maps.apple.com/?ll=1.5,2.5")).toBe(true);
    expect(isMapLink("https://www.openstreetmap.org/#map=1/1.5/2.5")).toBe(true);
    expect(isMapLink("https://duckduckgo.com/?q=maps")).toBe(false);
    expect(isMapLink("https://www.mcdonalds.fr/restaurants")).toBe(false);
  });
});

describe("parseCoordinates et pointFromText — ce qu'on colle dans la barre", () => {
  it("reconnaît des coordonnées décimales, refuse le reste", () => {
    expect(parseCoordinates("48.8566, 2.3522")).toEqual({ lat: 48.8566, lon: 2.3522 });
    expect(parseCoordinates("48.8566 2.3522")).toEqual({ lat: 48.8566, lon: 2.3522 });
    expect(parseCoordinates("12 34")).toBeNull();
    expect(parseCoordinates("95.1, 2.1")).toBeNull();
  });

  it("un lien de carte collé donne sa position, un texte ordinaire rien", () => {
    expect(pointFromText("https://maps.apple.com/?ll=45.76,4.83&q=Bellecour")).toEqual({ lat: 45.76, lon: 4.83, label: "Bellecour" });
    expect(pointFromText("mcdonalds evry")).toBeNull();
    expect(pointFromText("https://www.google.fr/maps?q=rue+de+Rivoli")).toBeNull();
  });
});

describe("candidateFromPage — le lieu que décrit une page, s'il n'y en a qu'un", () => {
  const restaurant = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: "McDonald's Évry",
    telephone: "01 60 00 00 00",
    url: "https://www.mcdonalds.fr/restaurants/evry/1",
    address: { "@type": "PostalAddress", streetAddress: "2 rue du Marché", postalCode: "91000", addressLocality: "Évry", addressCountry: "FR" },
    geo: { "@type": "GeoCoordinates", latitude: "48.6243", longitude: 2.4401 },
  };

  it("lit un établissement schema.org, position comprise", () => {
    expect(candidateFromPage({ ld: [JSON.stringify(restaurant)] })).toEqual({
      name: "McDonald's Évry",
      address: "2 rue du Marché, 91000 Évry",
      lat: 48.6243,
      lon: 2.4401,
      phone: "01 60 00 00 00",
      website: "https://www.mcdonalds.fr/restaurants/evry/1",
    });
  });

  it("préfère l'établissement au siège social dans un @graph", () => {
    const graph = {
      "@graph": [
        { "@type": "Organization", name: "McDonald's France", address: { streetAddress: "1 rue Gustave Eiffel", addressLocality: "Guyancourt" } },
        restaurant,
      ],
    };
    expect(candidateFromPage({ ld: [JSON.stringify(graph)] })).toMatchObject({ name: "McDonald's Évry" });
  });

  it("ne propose ni le siège seul, ni une liste de plusieurs établissements", () => {
    const office = { "@type": "Organization", name: "Siège", address: "1 rue Gustave Eiffel, Guyancourt" };
    expect(candidateFromPage({ ld: [JSON.stringify(office)] })).toBeNull();
    const other = { ...restaurant, name: "McDonald's Corbeil", geo: { latitude: 48.61, longitude: 2.48 } };
    expect(candidateFromPage({ ld: [JSON.stringify([restaurant, other])] })).toBeNull();
  });

  it("à défaut, un unique lien de carte ou une unique adresse balisée", () => {
    expect(candidateFromPage({ links: ["https://maps.apple.com/?ll=45.76,4.83&q=Bellecour", "https://duckduckgo.com/?q=maps"] })).toMatchObject({ lat: 45.76, lon: 4.83 });
    expect(candidateFromPage({ links: ["https://maps.apple.com/?ll=45.76,4.83", "https://maps.apple.com/?ll=43.3,5.37"] })).toBeNull();
    expect(candidateFromPage({ addr: ["  12 rue de Rivoli\n75004 Paris "] })).toEqual({ address: "12 rue de Rivoli 75004 Paris" });
    expect(candidateFromPage({ title: "Accueil" })).toBeNull();
  });
});

describe("candidateFromSelection et placeFromCandidate", () => {
  it("une sélection est une adresse à placer, ou des coordonnées", () => {
    expect(candidateFromSelection("  2 rue du Marché, 91000 Évry ")).toEqual({ address: "2 rue du Marché, 91000 Évry" });
    expect(candidateFromSelection("48.6243, 2.4401")).toEqual({ lat: 48.6243, lon: 2.4401 });
    expect(candidateFromSelection("ok")).toBeNull();
  });

  it("fabrique un lieu hors OSM, et refuse une position absente", () => {
    const place = placeFromCandidate({ lat: 48.62431, lon: 2.44012, address: "2 rue du Marché", website: "javascript:alert(1)" }, "macdo evry");
    expect(place).toEqual({ id: "web/48.62431,2.44012", name: "2 rue du Marché", group: null, lat: 48.62431, lon: 2.44012, address: undefined, phone: undefined, website: undefined });
    expect(placeFromCandidate({ address: "sans position" }, "x")).toBeNull();
    expect(placeFromCandidate({ lat: 48.6, lon: 2.4 }, "macdo evry")?.name).toBe("macdo evry");
  });
});

describe("webSearchUrl", () => {
  it("passe la recherche, la région, les réglages de confidentialité et le thème sombre", () => {
    const url = new URL(webSearchUrl("https://duckduckgo.com/", "macdo évry", { lang: "fr", dark: true }));
    const get = (key: string) => url.searchParams.get(key);
    expect(get("q")).toBe("macdo évry");
    expect(get("kl")).toBe("fr-fr");
    expect(get("kae")).toBe("d");
    // Localisation, saisie, IA, publicités, promotions : coupées. Fiche du lieu : gardée.
    expect([get("kat"), get("kac"), get("kbg"), get("kbe"), get("k1"), get("kak"), get("kau")]).toEqual(["-1", "-1", "-1", "0", "-1", "-1", "-1"]);
    expect([get("kg"), get("kd"), get("kz"), get("kbk")]).toEqual(["p", "1", "1", "waze"]);
    expect(new URL(webSearchUrl("https://duckduckgo.com/", "x", { lang: "en", dark: false })).searchParams.has("kae")).toBe(false);
  });
});

describe("cleanAddress — une adresse de page que les géocodeurs comprennent", () => {
  it("développe les abréviations de voie et retire le code pays (fiche DuckDuckGo réelle)", () => {
    expect(cleanAddress("3 Rte de Lalande Nationale 89, Montussan, FR 33450")).toBe("3 Route de Lalande Nationale 89, Montussan, 33450");
    expect(cleanAddress("12 av. Jean Jaurès , 69007 Lyon, FR")).toBe("12 Avenue Jean Jaurès, 69007 Lyon");
    expect(cleanAddress("8 Bd Saint-Michel, 75006 Paris")).toBe("8 Boulevard Saint-Michel, 75006 Paris");
  });

  it("laisse intacts les mots qui contiennent une abréviation", () => {
    expect(cleanAddress("Avenue des Plantes, Averon")).toBe("Avenue des Plantes, Averon");
  });
});

describe("liens reçus d'une autre application", () => {
  it("lit l'intention « naviguer » d'Android, position ou adresse", () => {
    expect(parseMapLink("google.navigation:q=44.8745,-0.4289")).toMatchObject({ kind: "point", lat: 44.8745, lon: -0.4289 });
    expect(parseMapLink("google.navigation:q=3+Route+de+Lalande+Montussan&mode=d")).toEqual({ kind: "query", text: "3 Route de Lalande Montussan" });
  });

  it("distingue un itinéraire demandé d'un lieu à montrer", () => {
    expect(isNavigationLink("google.navigation:q=44.87,-0.42")).toBe(true);
    expect(isNavigationLink("https://www.google.com/maps/dir/?api=1&destination=Montussan")).toBe(true);
    expect(isNavigationLink("https://maps.apple.com/?daddr=Lyon")).toBe(true);
    expect(isNavigationLink("https://waze.com/ul?ll=45.18,5.72&navigate=yes")).toBe(true);
    expect(isNavigationLink("geo:44.87,-0.42")).toBe(false);
    expect(isNavigationLink("https://maps.apple.com/?ll=45.76,4.83")).toBe(false);
  });
});

describe("fiche DuckDuckGo d'un lieu unique (relevée sur la page réelle)", () => {
  const card = {
    name: "McDonald's",
    fields: ["3 Rte de Lalande Nationale 89, Montussan, FR 33450", "+33 5 56 72 97 81", "Mar 10–0", "Mer 10–0"],
    website: "https://www.mcdonalds.fr/restaurants/mcdonalds-montussan/1213",
  };

  it("donne le nom, l'adresse, le téléphone et le site", () => {
    expect(candidateFromPage({ card })).toEqual({
      name: "McDonald's",
      address: "3 Rte de Lalande Nationale 89, Montussan, FR 33450",
      phone: "+33 5 56 72 97 81",
      website: "https://www.mcdonalds.fr/restaurants/mcdonalds-montussan/1213",
    });
  });

  it("ne propose rien sans nom ni adresse reconnaissable", () => {
    expect(candidateFromPage({ card: { name: "", fields: card.fields } })).toBeNull();
    expect(candidateFromPage({ card: { name: "McDonald's", fields: ["Mar 10–0", "+33 5 56 72 97 81"] } })).toBeNull();
  });
});
