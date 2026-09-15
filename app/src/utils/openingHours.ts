import { t, type TranslationKey } from "../i18n";

// ---------------------------------------------------------------------------
// Parseur simplifié de la syntaxe OSM "opening_hours".
//
// La spec complète (https://wiki.openstreetmap.org/wiki/Key:opening_hours) est
// très riche. Le principe retenu ici : lire ce qui se lit, et **mettre de côté
// le reste sans tout jeter**. Une valeur courante comme
// « Mo-Fr 09:00-18:30; Sa 09:00-12:30; PH off; 2024 May 20 off » doit donner la
// semaine complète, la mention « fermé les jours fériés », et l'oubli de
// l'exception datée de 2024 — pas un abandon qui renverrait l'utilisateur à la
// chaîne brute.
//
// Ce qui reste indéchiffrable n'est jamais deviné : un jour dont l'horaire ne
// se lit pas est signalé comme tel, jamais présenté comme fermé.
// ---------------------------------------------------------------------------

type TimeRange = [number, number]; // minutes depuis minuit

interface DayRule {
  days: number[]; // 0 = lundi ... 6 = dimanche
  ranges: TimeRange[]; // vide => fermé ce jour-là
}

export interface ParsedHours {
  rules: DayRule[];
  /** Jours dont l'horaire n'a pas pu être lu (ex: « Sa sunrise-sunset »). */
  unknownDays: number[];
  /** Mentions hors semaine : jours fériés, vacances, dates précises. */
  notes: string[];
}

const DAY_CODES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Clés des jours, dans l'ordre lundi → dimanche. */
const DAY_KEYS: TranslationKey[] = ["day.mon", "day.tue", "day.wed", "day.thu", "day.fri", "day.sat", "day.sun"];

/**
 * Le même jour tel qu'il se dit dans une phrase (« ouvre lundi à 9:00 »).
 * L'anglais y ajoute la préposition et garde sa majuscule, d'où un second jeu
 * de clés plutôt qu'une mise en minuscules qui ne vaudrait qu'en français.
 */
const DAY_WHEN_KEYS: TranslationKey[] = [
  "dayWhen.mon",
  "dayWhen.tue",
  "dayWhen.wed",
  "dayWhen.thu",
  "dayWhen.fri",
  "dayWhen.sat",
  "dayWhen.sun",
];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const FULL_DAY: TimeRange = [0, 24 * 60];

function parseTime(raw: string | undefined): number | null {
  // `undefined` arrive dès qu'un segment n'a pas la forme attendue — « PH off »
  // découpé sur le tiret ne rend qu'un morceau.
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const minutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return minutes > 24 * 60 ? null : minutes;
}

function parseDayToken(token: string): number[] | null {
  // "Mo-Fr", "Sa", "Mo,We,Fr"
  if (token.includes(",")) {
    const parts = token.split(",").flatMap((part) => parseDayToken(part.trim()) ?? []);
    return parts.length ? parts : null;
  }
  if (token.includes("-")) {
    const [a, b] = token.split("-").map((s) => s.trim());
    const ai = DAY_CODES.indexOf(a);
    const bi = DAY_CODES.indexOf(b);
    if (ai === -1 || bi === -1) return null;
    const days: number[] = [];
    let i = ai;
    while (true) {
      days.push(i);
      if (i === bi) break;
      i = (i + 1) % 7;
      if (days.length > 7) return null; // sécurité anti-boucle infinie
    }
    return days;
  }
  const idx = DAY_CODES.indexOf(token);
  return idx === -1 ? null : [idx];
}

/**
 * Plages horaires d'un segment : « 09:00-18:30 », « 09:00-12:00,14:00-19:00 »,
 * ou « off » (fermé, donc aucune plage). `null` = illisible.
 */
function parseRanges(rest: string): TimeRange[] | null {
  const value = rest.trim();
  if (!value) return null;
  if (/^(off|closed)$/i.test(value)) return [];

  const ranges: TimeRange[] = [];
  for (const part of value.split(",")) {
    const [from, to] = part.split("-").map((s) => s.trim());
    const f = parseTime(from);
    const t = parseTime(to);
    if (f === null || t === null) return null;
    ranges.push([f, t]);
  }
  return ranges.length ? ranges : null;
}

/**
 * Met en français une mention qui ne décrit pas la semaine ordinaire.
 *
 * `null` quand la mention n'apprend plus rien : une exception datée d'une année
 * révolue (« 2024 May 20 off ») encombrerait la fiche sans rien dire de l'année
 * en cours.
 */
const MONTHS: Record<string, TranslationKey> = {
  jan: "month.jan",
  feb: "month.feb",
  mar: "month.mar",
  apr: "month.apr",
  may: "month.may",
  jun: "month.jun",
  jul: "month.jul",
  aug: "month.aug",
  sep: "month.sep",
  oct: "month.oct",
  nov: "month.nov",
  dec: "month.dec",
};

const MONTH_INDEX: Record<string, number> = Object.fromEntries(
  Object.keys(MONTHS).map((name, index) => [name, index])
);

/**
 * Sépare un préfixe de saison de la règle qu'il gouverne :
 * « Apr-Sep: Mo-Su 09:00-19:00 » (sites touristiques, terrasses…).
 *
 * Le deux-points est exigé : sans lui, « May 20 off » se lirait comme une
 * saison suivie d'une règle, alors que c'est une date précise. Hors saison, la
 * règle n'est pas appliquée mais reste mentionnée sous le tableau.
 */
function splitSeason(segment: string, at: Date): { active: boolean; rest: string } | null {
  const m = /^([A-Za-z]{3})(?:\s*-\s*([A-Za-z]{3}))?\s*:\s*(.+)$/.exec(segment);
  if (!m) return null;
  const from = MONTH_INDEX[m[1].toLowerCase()];
  const to = m[2] ? MONTH_INDEX[m[2].toLowerCase()] : from;
  if (from === undefined || to === undefined) return null;

  const month = at.getMonth();
  // Une saison peut enjamber le nouvel an (« Nov-Feb »).
  const active = from <= to ? month >= from && month <= to : month >= from || month <= to;
  return { active, rest: m[3].trim() };
}

/** « Dec 25 off », « 2027 Jan 01 off » -> « Fermé le 25 décembre ». */
function describeDateOff(segment: string): string | null {
  const m = /^(?:(\d{4})\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(?:off|closed)$/i.exec(segment.trim());
  if (!m) return null;
  const monthKey = MONTHS[m[2].toLowerCase()];
  if (!monthKey) return null;
  const date = `${parseInt(m[3], 10)} ${t(monthKey)}${m[1] ? ` ${m[1]}` : ""}`;
  return t("hours.closedOn", { date });
}

function describeException(segment: string, at: Date): string | null {
  const year = /^(\d{4})\b/.exec(segment);
  if (year && Number(year[1]) < at.getFullYear()) return null;

  const lower = segment.toLowerCase();
  const isClosed = /\b(off|closed)\b/.test(lower);
  if (/^ph\b/.test(lower)) {
    return isClosed ? t("hours.publicClosed") : t("hours.public", { value: segment.slice(2).trim() });
  }
  if (/^sh\b/.test(lower)) {
    return isClosed ? t("hours.schoolClosed") : t("hours.school", { value: segment.slice(2).trim() });
  }
  const dateOff = describeDateOff(segment);
  if (dateOff) return dateOff;

  // Semaine paire, « by appointment »… : affichée telle quelle, ce qui reste
  // plus utile que rien.
  return segment;
}

function parseOpeningHours(value: string | undefined, at: Date = new Date()): ParsedHours | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  const rules: DayRule[] = [];
  const unknown = new Set<number>();
  const notes: string[] = [];

  for (const segment of raw.split(";").map((s) => s.trim()).filter(Boolean)) {
    // Retire d'éventuels commentaires entre guillemets, ex: 09:00-18:00 "sur rdv"
    let clean = segment.replace(/"[^"]*"/g, "").trim();
    if (!clean) continue;

    const season = splitSeason(clean, at);
    if (season) {
      if (!season.active) {
        notes.push(clean); // règle d'une autre saison : mentionnée, pas appliquée
        continue;
      }
      clean = season.rest;
    }

    if (clean === "24/7") {
      rules.push({ days: ALL_DAYS, ranges: [FULL_DAY] });
      continue;
    }

    const tokens = clean.split(/\s+/);
    const days = parseDayToken(tokens[0]);
    if (days) {
      const ranges = parseRanges(tokens.slice(1).join(" "));
      // Jours reconnus mais horaire illisible (« Sa sunrise-sunset ») : on le
      // signale plutôt que de faire passer ces jours pour fermés.
      if (ranges) rules.push({ days, ranges });
      else for (const day of days) unknown.add(day);
      continue;
    }

    // Pas de sélecteur de jours : soit un horaire valable toute la semaine
    // (« 09:00-18:00 » seul), soit une mention d'exception.
    const everyDay = parseRanges(clean);
    if (everyDay && everyDay.length) {
      rules.push({ days: ALL_DAYS, ranges: everyDay });
      continue;
    }

    const note = describeException(clean, at);
    if (note) notes.push(note);
  }

  if (!rules.length && unknown.size === 0) return null;
  return { rules, unknownDays: [...unknown], notes };
}

/**
 * Règle applicable à un jour donné.
 *
 * En syntaxe OSM, un segment plus tardif écrase le précédent :
 * « Mo-Fr 08:00-18:00; We 08:00-12:00 » ferme bien le mercredi à midi. On
 * retient donc la dernière règle qui mentionne le jour, pas la première.
 */
function ruleForDay(rules: DayRule[], day: number): DayRule | undefined {
  let found: DayRule | undefined;
  for (const rule of rules) {
    if (rule.days.includes(day)) found = rule;
  }
  return found;
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const m = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function formatRanges(ranges: TimeRange[]): string {
  if (ranges.length === 0) return t("hours.closed");
  return ranges
    .map(([from, to]) => (from === 0 && to >= 24 * 60 ? t("hours.allDay") : `${formatMinutes(from)} – ${formatMinutes(to)}`))
    .join(", ");
}

export interface DaySchedule {
  day: string;
  /** « 09:00 – 19:00 », « 24 h/24 », « Fermé », ou « Horaires variables ». */
  hours: string;
  isToday: boolean;
}

export interface WeeklyHours {
  days: DaySchedule[];
  /** Mentions à afficher sous le tableau (jours fériés, dates…). */
  notes: string[];
}

/**
 * Horaires de la semaine, pour le tableau de la fiche lieu.
 *
 * Les jours qu'aucune règle ne mentionne sont fermés — c'est la convention OSM.
 * Rend `null` si rien n'était lisible, auquel cas la fiche affiche la valeur
 * brute plutôt qu'un horaire faux.
 */
/**
 * Le commentaire qu'une valeur `opening_hours` porte entre guillemets.
 *
 * La syntaxe OSM autorise un commentaire libre — `open "check website
 * https://…"`, `Mo-Fr 09:00-17:00 "sur rendez-vous"` — et c'est **la seule
 * partie de la valeur écrite pour un humain**. Le parseur la retire avant de
 * lire le reste, ce qui est juste : elle n'a rien de mécanique. Mais quand le
 * reste ne se lit pas, elle devient ce qu'il y a de plus utile à montrer, et
 * il faut donc pouvoir la récupérer.
 *
 * Plusieurs commentaires sont joints : une valeur en porte rarement plus d'un,
 * et en perdre un serait perdre une consigne.
 */
export interface HoursComment {
  /** Le commentaire, débarrassé de l'adresse qu'il contenait. */
  text: string;
  /** L'adresse trouvée dedans, s'il y en a une. */
  url: string | null;
}

export function hoursComment(value: string | undefined): HoursComment | null {
  if (!value) return null;
  const found = [...value.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  if (!found.length) return null;

  const joined = found.join(" · ");
  // Une adresse dans un commentaire d'horaires est fréquente — « check website
  // https://… » — et c'est souvent l'information la plus utile. Écrite en
  // toutes lettres, elle occupe trois lignes et ne se touche pas ; on la sort
  // donc du texte pour en faire un lien.
  const url = /https?:\/\/[^\s"]+/.exec(joined)?.[0] ?? null;
  const text = url ? joined.replace(url, "").replace(/\s{2,}/g, " ").trim() : joined;
  return { text, url };
}

export function weeklyHours(value: string | undefined, at: Date = new Date()): WeeklyHours | null {
  const parsed = parseOpeningHours(value, at);
  if (!parsed) return null;

  const today = (at.getDay() + 6) % 7;
  const days = DAY_KEYS.map((key, index) => ({
    day: t(key),
    hours: parsed.unknownDays.includes(index)
      ? t("hours.variable")
      : formatRanges(ruleForDay(parsed.rules, index)?.ranges ?? []),
    isToday: index === today,
  }));

  return { days, notes: parsed.notes };
}

export interface OpenState {
  isOpen: boolean;
  /** « Ouvert » ou « Fermé » : l'essentiel, mis en couleur dans la fiche. */
  status: string;
  /** Précision qui suit : « ferme à 19:00 », « ouvre demain à 10:00 », « 24 h/24 ». */
  detail?: string;
}

export function computeOpenState(value: string | undefined, at: Date = new Date()): OpenState | null {
  const parsed = parseOpeningHours(value, at);
  if (!parsed) return null;

  // Lundi = 0 ... Dimanche = 6 (JS getDay() : Dimanche = 0)
  const day = (at.getDay() + 6) % 7;
  const minutes = at.getHours() * 60 + at.getMinutes();

  // Horaire du jour illisible : on ne tranche pas entre ouvert et fermé.
  if (parsed.unknownDays.includes(day)) return null;

  const todayRule = ruleForDay(parsed.rules, day);
  if (todayRule) {
    for (const [from, to] of todayRule.ranges) {
      if (minutes >= from && minutes < to) {
        // « ferme à 24:00 » se dirait mal d'un lieu ouvert en continu.
        const detail =
          from === 0 && to >= 24 * 60 ? t("hours.allDay") : t("hours.closesAt", { time: formatMinutes(to) });
        return { isOpen: true, status: t("hours.open"), detail };
      }
    }
  }

  // Cherche la prochaine ouverture dans les 7 jours à venir
  for (let offset = 0; offset < 7; offset++) {
    const d = (day + offset) % 7;
    // Un jour illisible interrompt la recherche : annoncer une réouverture
    // au-delà reviendrait à ignorer ce qu'on n'a pas su lire.
    if (parsed.unknownDays.includes(d)) break;
    const rule = ruleForDay(parsed.rules, d);
    if (!rule) continue;
    for (const [from] of rule.ranges) {
      if (offset === 0 && from <= minutes) continue;
      const when = offset === 0 ? t("hours.today") : offset === 1 ? t("hours.tomorrow") : t(DAY_WHEN_KEYS[d]);
      return {
        isOpen: false,
        status: t("hours.closed"),
        detail: t("hours.opensAt", { when, time: formatMinutes(from) }),
      };
    }
  }

  return { isOpen: false, status: t("hours.closed") };
}
