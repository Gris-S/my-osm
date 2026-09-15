// ---------------------------------------------------------------------------
// Disjoncteurs, un par fournisseur et par capacité.
//
// Une source qui échoue plusieurs fois de suite est mise au repos : on passe
// directement à la suivante au lieu d'attendre ses délais à chaque appel. Au
// terme du repos, **une seule** requête d'essai est laissée passer ; si elle
// réussit, la source revient, sinon elle repart au repos. Un 429 ouvre le
// disjoncteur pour la durée demandée par la source (`Retry-After`).
// ---------------------------------------------------------------------------

interface BreakerState {
  failures: number;
  openUntil: number;
  /** Une requête d'essai est en cours après un repos. */
  probing: boolean;
}

export interface BreakerSettings {
  failures: number;
  openMs: number;
}

export class CircuitBreakers {
  private readonly states = new Map<string, BreakerState>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private state(key: string): BreakerState {
    let state = this.states.get(key);
    if (!state) {
      state = { failures: 0, openUntil: 0, probing: false };
      this.states.set(key, state);
    }
    return state;
  }

  /** Vrai si un appel peut partir. Au sortir du repos, réserve l'unique essai. */
  allow(key: string): boolean {
    const state = this.state(key);
    if (state.openUntil === 0) return true;
    if (this.now() < state.openUntil || state.probing) return false;
    state.probing = true;
    return true;
  }

  success(key: string): void {
    this.states.set(key, { failures: 0, openUntil: 0, probing: false });
  }

  failure(key: string, settings: BreakerSettings): void {
    const state = this.state(key);
    state.failures += 1;
    if (state.probing || state.failures >= settings.failures) {
      state.openUntil = this.now() + settings.openMs;
      state.failures = 0;
      state.probing = false;
    }
  }

  /** Repos imposé par la source elle-même (429 et `Retry-After`). */
  openFor(key: string, ms: number): void {
    const state = this.state(key);
    state.openUntil = Math.max(state.openUntil, this.now() + ms);
    state.failures = 0;
    state.probing = false;
  }

  isOpen(key: string): boolean {
    const state = this.states.get(key);
    return !!state && state.openUntil !== 0 && this.now() < state.openUntil;
  }
}
