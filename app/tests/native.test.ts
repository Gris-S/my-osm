import { describe, expect, it } from "vitest";
import { rescuedBody } from "../src/services/native";

// Les quatre formes que le greffon natif rend (`HttpRequestHandler.readData`,
// avec `responseType: "arraybuffer"`). Tous les services OSM de l'APK passent
// par cette conversion : une forme mal lue, et un service entier se tait.
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const read = (body: BodyInit) => new Response(body).text();

describe("rescuedBody — la réponse native rendue lisible", () => {
  it("réécrit un JSON déjà lu par le greffon", async () => {
    const body = rescuedBody({ status: 200, data: { code: "Ok" }, headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(await read(body))).toEqual({ code: "Ok" });
  });

  it("décode une tuile en base64", async () => {
    const body = rescuedBody({ status: 200, data: b64("tuile"), headers: { "content-type": "application/x-protobuf" } });
    expect(await read(body)).toBe("tuile");
  });

  it("décode le GeoJSON de BRouter, que le greffon ne tient pas pour du JSON", async () => {
    const body = rescuedBody({
      status: 200,
      data: b64('{"features":[]}'),
      headers: { "Content-Type": "application/vnd.geo+json; charset=utf-8" },
    });
    expect(JSON.parse(await read(body))).toEqual({ features: [] });
  });

  it("décode le texte de la page d'état d'Overpass", async () => {
    const body = rescuedBody({
      status: 200,
      data: b64("2 slots available now."),
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
    expect(await read(body)).toBe("2 slots available now.");
  });

  it("laisse tel quel le texte d'une erreur", async () => {
    const body = rescuedBody({ status: 429, data: "Too Many Requests", headers: { "Content-Type": "text/html" } });
    expect(await read(body)).toBe("Too Many Requests");
  });
});
