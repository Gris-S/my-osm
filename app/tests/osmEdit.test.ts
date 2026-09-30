import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  codeFromRedirect,
  makePkce,
  namedAround,
  normalizeName,
  phoneForOsm,
  capitalizeStreet,
  sameName,
  sha256,
  splitAddress,
  tagsFor,
  tagsXml,
  websiteForOsm,
} from "../src/services/osmEdit";
import { CONFIG } from "../src/config";

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("sha256 (code PKCE)", () => {
  it("rend le vecteur de test FIPS 180-2", () => {
    expect(hex(sha256(new TextEncoder().encode("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("égale celui de Node sur toutes les longueurs autour d'un bloc", () => {
    for (let n = 0; n < 200; n++) {
      const data = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff);
      expect(hex(sha256(data))).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });

  it("donne le défi que recalcule OSM", () => {
    const { verifier, challenge } = makePkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("connexion", () => {
  it("demande S256, les deux permissions et l'adresse de retour choisie", () => {
    const url = new URL(authorizeUrl("CID", "defi", CONFIG.OSM_EDIT.REDIRECT_APP));
    expect(url.origin).toBe("https://www.openstreetmap.org");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("read_prefs write_api");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1/myosm-osm-callback");
  });

  it("lit le code, ou le refus, dans l'adresse de retour", () => {
    const back = CONFIG.OSM_EDIT.REDIRECT_APP;
    expect(codeFromRedirect(`${back}?code=abc123`, back)).toEqual({ code: "abc123" });
    expect(codeFromRedirect(`${back}?error=access_denied&error_description=x`, back)).toEqual({ error: "access_denied" });
    expect(codeFromRedirect("https://www.openstreetmap.org/login", back)).toBeNull();
  });
});

describe("adresse de la fiche du web", () => {
  it("découpe une adresse française ordinaire", () => {
    expect(splitAddress("12 Rue de Rivoli, 75004 Paris")).toEqual({
      housenumber: "12",
      street: "Rue de Rivoli",
      postcode: "75004",
      city: "Paris",
    });
  });

  it("découpe la forme DuckDuckGo, abréviation et code pays compris", () => {
    // Relevée sur la fiche d'un McDonald's absent d'OSM (voir `cleanAddress`).
    expect(splitAddress("3 Rte de Lalande Nationale 89, Montussan, FR 33450")).toEqual({
      housenumber: "3",
      street: "Route de Lalande Nationale 89",
      postcode: "33450",
      city: "Montussan",
    });
  });

  it("découpe une adresse sans virgule, code postal au milieu ou à la fin", () => {
    expect(splitAddress("19 rue du Midi 94300 Vincennes")).toEqual({
      housenumber: "19",
      street: "Rue du Midi",
      postcode: "94300",
      city: "Vincennes",
    });
    expect(splitAddress("12 Rue de Rivoli Paris 75004")).toEqual({
      housenumber: "12",
      street: "Rue de Rivoli Paris",
      postcode: "75004",
      city: "",
    });
  });

  it("met la majuscule initiale à la rue, sauf après une apostrophe", () => {
    expect(capitalizeStreet("rue du Midi")).toBe("Rue du Midi");
    expect(capitalizeStreet("via Roma")).toBe("Via Roma");
    expect(capitalizeStreet("élysée")).toBe("Élysée");
    expect(capitalizeStreet("'s-Gravendijkwal")).toBe("'s-Gravendijkwal");
    expect(capitalizeStreet("")).toBe("");
  });

  it("garde « bis » avec le numéro, et laisse vide ce qu'elle ne reconnaît pas", () => {
    expect(splitAddress("5 bis Avenue Foch, 94300 Vincennes").housenumber).toBe("5bis");
    expect(splitAddress("Centre commercial")).toEqual({ housenumber: "", street: "Centre commercial", postcode: "", city: "" });
    expect(splitAddress("")).toEqual({ housenumber: "", street: "", postcode: "", city: "" });
  });
});

describe("ce qui part vers OSM", () => {
  it("met le téléphone au format international", () => {
    expect(phoneForOsm("01 42 72 00 00")).toBe("+33 1 42 72 00 00");
    expect(phoneForOsm("+33142720000")).toBe("+33 1 42 72 00 00");
    expect(phoneForOsm("0033 6 12 34 56 78")).toBe("+33 6 12 34 56 78");
    expect(phoneForOsm("+44 20 7946 0000")).toBe("+44 20 7946 0000");
  });

  it("donne un schéma au site", () => {
    expect(websiteForOsm("www.exemple.fr")).toBe("https://www.exemple.fr");
    expect(websiteForOsm("http://exemple.fr")).toBe("http://exemple.fr");
    expect(websiteForOsm("  ")).toBe("");
  });

  it("n'écrit que les champs remplis, catégorie en tête", () => {
    expect(
      tagsFor({
        name: " Boulangerie Test ",
        category: "bakery",
        housenumber: "12",
        street: "Rue de Rivoli",
        postcode: "",
        city: "Paris",
        phone: "01 42 72 00 00",
        website: "",
      })
    ).toEqual({
      shop: "bakery",
      name: "Boulangerie Test",
      "addr:housenumber": "12",
      "addr:street": "Rue de Rivoli",
      "addr:city": "Paris",
      phone: "+33 1 42 72 00 00",
    });
  });

  it("échappe le XML", () => {
    expect(tagsXml({ name: `Chez "Lulu" & <Co>` })).toBe('<tag k="name" v="Chez &quot;Lulu&quot; &amp; &lt;Co&gt;"/>');
  });
});

describe("lieux du même nom autour", () => {
  it("reconnaît une enseigne suivie de sa ville, pas un mot isolé", () => {
    const same = (a: string, b: string) => sameName(normalizeName(a), normalizeName(b));
    expect(same("McDonald's", "McDonald's Montussan")).toBe(true);
    expect(same("Boulangerie Dupont", "boulangerie dupont")).toBe(true);
    expect(same("Boulangerie Test", "test")).toBe(false);
    expect(same("Café", "")).toBe(false);
  });

  it("signale un nom proche, ignore les rues, place un bâtiment à son premier nœud", () => {
    const found = namedAround(
      [
        { type: "node", id: 1, lat: 48.8556, lon: 2.3599, tags: { name: "Optic 2000", shop: "optician" } },
        { type: "node", id: 2, lat: 48.8557, lon: 2.36 },
        { type: "way", id: 3, nodes: [2], tags: { name: "Boulangerie Dupont", building: "yes" } },
        { type: "way", id: 4, nodes: [2], tags: { name: "Rue de Rivoli", highway: "primary" } },
      ],
      48.8556,
      2.3599,
      "boulangerie dupont"
    );
    expect(found.map((f) => [f.type, f.id, f.similar])).toEqual([
      ["way", 3, true],
      ["node", 1, false],
    ]);
    expect(found[0].distance).toBeGreaterThan(5);
    expect(found[0].distance).toBeLessThan(20);
  });
});
