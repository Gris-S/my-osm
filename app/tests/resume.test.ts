import { describe, expect, it } from "vitest";
import { interruptedRegions } from "../src/services/offline/store";
import type { OfflineRegion } from "../src/services/offline/store";
import { anySignal, timeoutSignal } from "../src/utils/signals";

// ---------------------------------------------------------------------------
// Deux règles que l'audit du 16 septembre 2026 a trouvées cassées, et qui ne se
// voient qu'au pire moment : l'une quand l'application est tuée pendant un
// téléchargement, l'autre sur une WebView ancienne. Ni l'une ni l'autre ne se
// reproduit dans un navigateur de développement — d'où ces tests.
// ---------------------------------------------------------------------------

/** Une zone minimale : seuls `status` et `pausedBy` comptent ici. */
function region(id: string, status: OfflineRegion["status"]): OfflineRegion {
  return {
    id,
    name: id,
    bbox: [0, 0, 1, 1],
    detail: "map",
    vectorMaxZoom: 14,
    satelliteMaxZoom: null,
    reliefMaxZoom: null,
    addresses: false,
    addressDepts: [],
    createdAt: 0,
    updatedAt: 0,
    tileVersion: "",
    checkedAt: 0,
    bytes: 0,
    tilesDone: 0,
    tilesTotal: 0,
    placesCount: 0,
    addressCount: 0,
    status,
  };
}

describe("interruptedRegions — une zone tuée en plein téléchargement doit pouvoir reprendre", () => {
  it("ne retient que celles restées « en cours »", () => {
    const stuck = interruptedRegions([
      region("a", "downloading"),
      region("b", "ready"),
      region("c", "paused"),
      region("d", "error"),
      region("e", "pending"),
    ]);
    expect(stuck.map((r) => r.id)).toEqual(["a"]);
  });

  it("les repasse en pause, et en pause **demandée**", () => {
    // `pausedBy: "user"` n'est pas un détail : une pause « système » repart
    // toute seule au retour du wifi, et relancer 250 Mo sans qu'on l'ait
    // demandé serait pire que le défaut qu'on corrige.
    const [resumed] = interruptedRegions([region("a", "downloading")]);
    expect(resumed.status).toBe("paused");
    expect(resumed.pausedBy).toBe("user");
  });

  it("ne modifie pas la liste qu'on lui donne", () => {
    const original = region("a", "downloading");
    interruptedRegions([original]);
    expect(original.status).toBe("downloading");
  });
});

/** Fait tourner `run` comme sur une WebView sans `AbortSignal.any` ni `.timeout`. */
async function withoutNativeSignals(run: () => Promise<void> | void): Promise<void> {
  const holder = AbortSignal as unknown as { any?: unknown; timeout?: unknown };
  const nativeAny = holder.any;
  const nativeTimeout = holder.timeout;
  holder.any = undefined;
  holder.timeout = undefined;
  try {
    await run();
  } finally {
    holder.any = nativeAny;
    holder.timeout = nativeTimeout;
  }
}

describe("anySignal — le repli des WebView anciennes", () => {
  it("s'arrête quand l'un des signaux s'arrête", async () => {
    await withoutNativeSignals(() => {
      const a = new AbortController();
      const b = new AbortController();
      const combined = anySignal([a.signal, undefined, b.signal]);
      expect(combined.aborted).toBe(false);
      b.abort(new Error("stockage plein"));
      expect(combined.aborted).toBe(true);
      expect((combined.reason as Error).message).toBe("stockage plein");
    });
  });

  it("naît déjà arrêté si l'un des signaux l'était", async () => {
    await withoutNativeSignals(() => {
      const already = new AbortController();
      already.abort();
      expect(anySignal([already.signal, new AbortController().signal]).aborted).toBe(true);
    });
  });

  it("donne le même résultat que la version native quand elle existe", () => {
    const a = new AbortController();
    const combined = anySignal([a.signal]);
    a.abort();
    expect(combined.aborted).toBe(true);
  });
});

describe("timeoutSignal — le repli du délai", () => {
  it("s'arrête tout seul, avec l'erreur attendue", async () => {
    await withoutNativeSignals(async () => {
      const signal = timeoutSignal(5);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(signal.aborted).toBe(true);
      expect((signal.reason as DOMException).name).toBe("TimeoutError");
    });
  });
});
