import { describe, expect, it } from "vitest";
import { safeColor, safeWebLink } from "../src/utils/safe";

describe("safeColor — une couleur relue du stockage n'injecte rien", () => {
  it("garde une couleur hexadécimale, refuse le reste", () => {
    expect(safeColor("#FF9500", "#000")).toBe("#FF9500");
    expect(safeColor("#abc", "#000")).toBe("#abc");
    expect(safeColor('red"/><img src=x onerror=alert(1)>', "#000")).toBe("#000");
    expect(safeColor(undefined, "#000")).toBe("#000");
  });
});

describe("safeWebLink — seuls les liens web deviennent cliquables", () => {
  it("garde http(s) et complète une adresse sans schéma", () => {
    expect(safeWebLink("https://www.mcdonalds.fr/restaurants")).toBe("https://www.mcdonalds.fr/restaurants");
    expect(safeWebLink(" www.boulangerie-dupont.fr ")).toBe("https://www.boulangerie-dupont.fr");
    expect(safeWebLink("exemple.fr/contact")).toBe("https://exemple.fr/contact");
  });

  it("refuse javascript:, intent:, data: et le texte libre", () => {
    expect(safeWebLink("javascript:alert(1)")).toBeUndefined();
    expect(safeWebLink("intent://scan/#Intent;scheme=zxing;end")).toBeUndefined();
    expect(safeWebLink("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeWebLink("voir sur place")).toBeUndefined();
    expect(safeWebLink(undefined)).toBeUndefined();
  });
});

describe("CONTENT_SECURITY_POLICY", () => {
  it("n'autorise que les scripts de l'application : ni en ligne, ni eval, ni autre domaine", async () => {
    const { CONTENT_SECURITY_POLICY } = await import("../src/security");
    const script = CONTENT_SECURITY_POLICY.split("; ").find((d) => d.startsWith("script-src"));
    expect(script).toBe("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("base-uri 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
  });
});
