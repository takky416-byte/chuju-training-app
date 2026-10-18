"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ClipboardCheck, Layers, RotateCcw, Search, Shuffle, Star, X } from "lucide-react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import rawData from "./data/bio-cards.json";
import { db, LEARNER_RECORD_ID } from "./firebase";
import type { SoundEffect } from "./audio-engine";

/* ---------- data types ---------- */
type FlowerRow = { label?: string; v: Array<number | string> };
type Flower = { rows: FlowerRow[] };
type BioCard = {
  no: number;
  name: string;
  alias?: string;
  kind: "plant" | "animal" | "plankton" | "fossil";
  cat: string[];
  star?: boolean;
  points: string[];
  quiz: string[];
  flower?: Flower;
  backImage?: string;
  backCaption?: string;
};
type BioFamily = { id: number; mark: string; title: string; lines: string[]; flower: Flower; flowerCaption?: string; quiz: string[] };
type BioRound = { id: number; title: string; items: Array<{ no: number; qs: string[] }> };
type BioData = { cards: BioCard[]; families: BioFamily[]; rounds: BioRound[] };

const DATA = rawData as unknown as BioData;
const CARDS = DATA.cards;
const FAMILIES = DATA.families;
const ROUNDS = DATA.rounds;
const CARD_BY_NO = new Map(CARDS.map((card) => [card.no, card]));

/* ---------- markup: [[answer]] / [[answer|alt;alt]] / [[answer#choice,choice]] ---------- */
type Blank = { answer: string; alts: string[]; choices?: string[] };
type Seg = string | Blank;
type QuizItem = { id: string; segs: Seg[]; plain: string };

function parseMarkup(src: string): Seg[] {
  const out: Seg[] = [];
  const re = /\[\[(.+?)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    let body = m[1];
    let choices: string[] | undefined;
    const hash = body.indexOf("#");
    if (hash >= 0) {
      choices = body.slice(hash + 1).split(",");
      body = body.slice(0, hash);
    }
    const [answer, altText] = body.split("|");
    out.push({ answer, alts: altText ? altText.split(";") : [], choices });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

function toItem(id: string, src: string): QuizItem {
  const segs = parseMarkup(src);
  return { id, segs, plain: segs.map((s) => (typeof s === "string" ? s : s.answer)).join("") };
}

const KANJI_DIGIT: Record<string, string> = { "〇": "0", 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };

function normalizeAnswer(value: string) {
  let t = value.normalize("NFKC").toLowerCase();
  t = t.replace(/[\s、。，,．.・「」『』()（）[\]]/g, "");
  t = t.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  t = t.replace(/[〇一二三四五六七八九]/g, (c) => KANJI_DIGIT[c]);
  t = t.replace(/(\d)?十(\d)?/g, (_, a, b) => String((a ? Number(a) : 1) * 10 + (b ? Number(b) : 0)));
  return t;
}

function isBlankCorrect(blank: Blank, input: string) {
  const n = normalizeAnswer(input);
  if (!n) return false;
  const candidates = [blank.answer, ...blank.alts].map(normalizeAnswer);
  if (candidates.includes(n)) return true;
  return candidates.includes(n.replace(/(枚|本|個|回|日|対|月|度|℃|cm)$/, ""));
}

function nameBlank(card: BioCard): Blank {
  const alts = new Set<string>();
  const m = card.name.match(/^(.+?)[(（](.+)[)）]$/);
  if (m) {
    alts.add(m[1]);
    alts.add(m[2]);
  }
  if (card.alias) alts.add(card.alias);
  alts.delete(card.name);
  return { answer: card.name, alts: [...alts] };
}

/* ---------- derived questions (family, flower counts, classification) ---------- */
const PLANT_GROUPS = "双子葉植物,単子葉植物,裸子植物,シダ植物";
const VERTEBRATES = "魚類,両生類,は虫類,鳥類,ほ乳類";
const INVERTEBRATES = "昆虫類,甲殻類,クモ形類,多足類";

function flowerValueBlank(value: number | string): Blank {
  if (typeof value === "number") return { answer: String(value), alts: [] };
  return { answer: "多数", alts: ["多い", "多", "たくさん"] };
}

function derivedItems(card: BioCard): QuizItem[] {
  const list: QuizItem[] = [];
  const add = (key: string, src: string) => list.push(toItem(`${card.no}-d-${key}`, src));
  const family = card.cat.find((c) => c.endsWith("科"));
  if (card.kind === "plant") {
    if (family) add("family", `[[${family.slice(0, -1)}]]科の植物`);
    if (card.cat[0] && PLANT_GROUPS.split(",").includes(card.cat[0])) add("group", `[[${card.cat[0]}#${PLANT_GROUPS}]]である`);
    if (card.cat[0] === "双子葉植物") add("cotyledon", "子葉の枚数は[[2]]枚");
    if (card.cat[0] === "単子葉植物") add("cotyledon", "子葉の枚数は[[1]]枚");
  }
  if (card.kind === "animal") {
    const sub = card.cat.find((c) => VERTEBRATES.split(",").includes(c));
    if (sub) add("class", `[[${sub}#${VERTEBRATES}]]に分類される`);
    const inv = card.cat.find((c) => INVERTEBRATES.split(",").includes(c));
    if (inv) add("class", `[[${inv}#${INVERTEBRATES}]]のなかまである`);
  }
  if (card.flower) {
    const defs: Array<[string, number, string, string]> = [
      ["がく", 0, "がくの枚数は", "枚"],
      ["花びら", 1, "花びらの枚数は", "枚"],
      ["おしべ", 2, "おしべの本数は", "本"],
      ["めしべ", 3, "めしべの本数は", "本"],
    ];
    card.flower.rows.forEach((row, ri) => {
      defs.forEach(([key, idx, label, unit]) => {
        const value = row.v[idx];
        const blank = flowerValueBlank(value);
        const seg: Seg[] = [`${row.label ? `${row.label}の` : ""}${label}`, blank, typeof value === "number" ? unit : ""];
        list.push({ id: `${card.no}-d-flower-${ri}-${key}`, segs: seg, plain: seg.map((s) => (typeof s === "string" ? s : s.answer)).join("") });
      });
    });
  }
  return list;
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uniqueByPlain(items: QuizItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.plain)) return false;
    seen.add(item.plain);
    return true;
  });
}

function pickItems(card: BioCard, count = 3): QuizItem[] {
  const hand = shuffle(card.quiz.map((q, i) => toItem(`${card.no}-q-${i}`, q)));
  const derived = shuffle(derivedItems(card));
  const chosen: QuizItem[] = hand.slice(0, 2);
  const pool = shuffle([...hand.slice(2), ...derived]);
  for (const item of pool) {
    if (chosen.length >= count) break;
    chosen.push(item);
  }
  // never show two sentences that give each other away
  const unique = uniqueByPlain(chosen);
  for (const item of pool) {
    if (unique.length >= count) break;
    if (!unique.some((u) => u.plain === item.plain)) unique.push(item);
  }
  return unique.slice(0, count);
}

/* ---------- test sheet model ---------- */
type SheetEntry = {
  key: string;
  title: string;
  imageSrc?: string;
  famMark?: string;
  items: QuizItem[];
};

function cardEntry(card: BioCard, items: QuizItem[]): SheetEntry {
  const nameItem: QuizItem = { id: `${card.no}-name`, segs: ["生物名 ", nameBlank(card)], plain: card.name };
  return { key: `c${card.no}`, title: `カード${card.no}`, imageSrc: cardImage(card.no), items: [nameItem, ...items] };
}

function familyEntry(fam: BioFamily): SheetEntry {
  const items = shuffle(fam.quiz.map((q, i) => toItem(`f${fam.id}-q-${i}`, q))).slice(0, 3);
  return { key: `f${fam.id}`, title: `${fam.mark} ${fam.title}`, famMark: `${fam.mark}\n★${fam.title}`, items };
}

function roundSheet(round: BioRound): SheetEntry[] {
  return round.items.flatMap((entry) => {
    const card = CARD_BY_NO.get(entry.no);
    if (!card) return [];
    return [cardEntry(card, entry.qs.map((q, i) => toItem(`r${round.id}-${entry.no}-${i}`, q)))];
  });
}

const cardImage = (no: number) => `/checktest-biocard/card-${String(no).padStart(2, "0")}.jpg`;
const cardKey = (card: BioCard) => `c${card.no}`;
const famKey = (fam: BioFamily) => `f${fam.id}`;

/* ---------- progress (known flags, missed counts) ---------- */
type Progress = { known: string[]; missed: Record<string, number>; best: Record<string, number> };
const STORAGE_KEY = "aichi_training_biocard_v1";
const EMPTY_PROGRESS: Progress = { known: [], missed: {}, best: {} };

function loadProgress(): Progress {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (parsed && Array.isArray(parsed.known)) return { known: parsed.known, missed: parsed.missed ?? {}, best: parsed.best ?? {} };
  } catch {
    /* ignore */
  }
  return EMPTY_PROGRESS;
}

function mergeProgress(a: Progress, b: Progress): Progress {
  const missed: Record<string, number> = { ...a.missed };
  Object.entries(b.missed ?? {}).forEach(([k, v]) => { missed[k] = Math.max(missed[k] ?? 0, v); });
  const best: Record<string, number> = { ...a.best };
  Object.entries(b.best ?? {}).forEach(([k, v]) => { best[k] = Math.max(best[k] ?? 0, v); });
  return { known: [...new Set([...a.known, ...(b.known ?? [])])], missed, best };
}

/* ---------- small presentational pieces ---------- */
function FlowerTable({ flower, caption }: { flower: Flower; caption?: string }) {
  const hasLabel = flower.rows.some((r) => r.label);
  return (
    <div className="bio-flower">
      <small>〈{caption ?? "主な花"}〉</small>
      <table>
        <thead><tr>{hasLabel && <th />}<th>がく</th><th>花びら</th><th>おしべ</th><th>めしべ</th></tr></thead>
        <tbody>
          {flower.rows.map((row, i) => <tr key={i}>{hasLabel && <th>{row.label}</th>}{row.v.map((v, j) => <td key={j}>{v}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function CardBack({ card }: { card: BioCard }) {
  return (
    <div className="bio-face bio-back">
      <span className="bio-no">{card.star && <Star size={12} fill="currentColor" />}{card.no}</span>
      <h4>{card.name}</h4>
      {card.cat.length > 0 && <p className="bio-cat">({card.cat.join("、")})</p>}
      <ul>{card.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
      {card.backImage && <figure><img src={card.backImage} alt={card.backCaption ?? ""} loading="lazy" />{card.backCaption && <figcaption>{card.backCaption}</figcaption>}</figure>}
      {card.flower && <FlowerTable flower={card.flower} />}
    </div>
  );
}

function FamilyFront({ fam }: { fam: BioFamily }) {
  return (
    <div className="bio-face bio-front bio-family-front">
      <strong>＜{fam.mark}＞</strong>
      <span>★{fam.title}</span>
    </div>
  );
}

function FamilyBack({ fam }: { fam: BioFamily }) {
  return (
    <div className="bio-face bio-back">
      <span className="bio-no">{fam.mark}</span>
      <h4>{fam.title}</h4>
      <ul>{fam.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <FlowerTable flower={fam.flower} caption={fam.flowerCaption} />
    </div>
  );
}

/* ---------- study deck ---------- */
type DeckEntry = { key: string; card?: BioCard; fam?: BioFamily };
const ALL_DECK: DeckEntry[] = [
  ...CARDS.map((card) => ({ key: cardKey(card), card })),
  ...FAMILIES.map((fam) => ({ key: famKey(fam), fam })),
];

const FILTERS = [
  { id: "all", label: "すべて" },
  { id: "plant", label: "植物" },
  { id: "animal", label: "動物" },
  { id: "plankton", label: "プランクトン・化石" },
  { id: "family", label: "付録(科)" },
  { id: "star", label: "★" },
  { id: "todo", label: "まだ覚えていない" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

function matchesFilter(entry: DeckEntry, filter: FilterId, known: Set<string>) {
  const { card, fam } = entry;
  switch (filter) {
    case "plant": return card?.kind === "plant";
    case "animal": return card?.kind === "animal";
    case "plankton": return card?.kind === "plankton" || card?.kind === "fossil";
    case "family": return Boolean(fam);
    case "star": return Boolean(card?.star);
    case "todo": return !known.has(entry.key);
    default: return true;
  }
}

/* ---------- main component ---------- */
type Props = {
  enabled: boolean;
  onComplete: (correct: number, total: number) => Promise<number> | number;
  onSound: (effect: SoundEffect) => void;
};

export function BioCards({ enabled, onComplete, onSound }: Props) {
  const [tab, setTab] = useState<"study" | "test">("study");
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS);
  const progressLoaded = useRef(false);

  // study state
  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");
  const [deck, setDeck] = useState<DeckEntry[]>([]);
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // test state
  const [sheet, setSheet] = useState<SheetEntry[]>([]);
  const [sheetTitle, setSheetTitle] = useState("");
  const [sheetRound, setSheetRound] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [bonus, setBonus] = useState<number | null>(null);
  const [testFilter, setTestFilter] = useState<"all" | "plant" | "animal" | "plankton" | "weak" | "family">("all");
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const local = loadProgress();
    setProgress(local);
    progressLoaded.current = true;
  }, []);

  // merge with the copy stored in Firestore (same gameProgress collection the app already syncs)
  useEffect(() => {
    if (!enabled || !db) return;
    let cancelled = false;
    getDoc(doc(db, "learners", LEARNER_RECORD_ID, "gameProgress", "bioCards"))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const remote = snap.data() as Partial<Progress>;
        setProgress((current) => mergeProgress(current, { known: remote.known ?? [], missed: remote.missed ?? {}, best: remote.best ?? {} }));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [enabled]);

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!progressLoaded.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      /* ignore */
    }
    if (!enabled || !db) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void setDoc(doc(db!, "learners", LEARNER_RECORD_ID, "gameProgress", "bioCards"), { ...progress, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => undefined);
    }, 800);
    return () => { if (persistTimer.current) clearTimeout(persistTimer.current); };
  }, [progress, enabled]);

  const known = useMemo(() => new Set(progress.known), [progress.known]);

  const listed = useMemo(() => {
    const q = normalizeAnswer(query);
    return ALL_DECK.filter((entry) => matchesFilter(entry, filter, known) && (!q || normalizeAnswer(`${entry.card?.name ?? entry.fam?.title ?? ""}${entry.card?.alias ?? ""}`).includes(q)));
  }, [filter, query, known]);

  const knownCount = ALL_DECK.filter((e) => known.has(e.key)).length;

  const startDeck = useCallback((entries: DeckEntry[], startAt = 0) => {
    if (!entries.length) return;
    setDeck(entries);
    setPos(startAt);
    setFlipped(false);
  }, []);

  const mark = useCallback((key: string, isKnown: boolean) => {
    setProgress((current) => {
      const set = new Set(current.known);
      if (isKnown) set.add(key); else set.delete(key);
      return { ...current, known: [...set] };
    });
  }, []);

  const current = deck[pos];
  const goNext = useCallback(() => {
    setFlipped(false);
    setPos((p) => Math.min(deck.length, p + 1));
  }, [deck.length]);
  const goPrev = useCallback(() => {
    setFlipped(false);
    setPos((p) => Math.max(0, p - 1));
  }, []);

  /* ----- test ----- */
  function startSheet(entries: SheetEntry[], title: string, round: number | null) {
    setSheet(entries);
    setSheetTitle(title);
    setSheetRound(round);
    setAnswers({});
    setChecked(false);
    setBonus(null);
    setTimeout(() => sheetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  function startRandom() {
    if (testFilter === "family") {
      startSheet(shuffle(FAMILIES).slice(0, 5).map(familyEntry), "付録(科)の確認テスト", null);
      return;
    }
    let pool = CARDS.filter((card) => {
      if (testFilter === "plant") return card.kind === "plant";
      if (testFilter === "animal") return card.kind === "animal";
      if (testFilter === "plankton") return card.kind === "plankton" || card.kind === "fossil";
      return true;
    });
    if (testFilter === "weak") {
      const weak = CARDS.filter((card) => (progress.missed[cardKey(card)] ?? 0) > 0 || !known.has(cardKey(card)));
      pool = weak.length >= 5 ? weak : CARDS;
    }
    const chosen = shuffle(pool).slice(0, 5);
    const label = { all: "ランダム", plant: "植物", animal: "動物", plankton: "プランクトン・化石", weak: "苦手・未習得から", family: "" }[testFilter];
    startSheet(chosen.map((card) => cardEntry(card, pickItems(card))), `生物カード 確認テスト(${label})`, null);
  }

  const totalBlanks = sheet.reduce((sum, entry) => sum + entry.items.length, 0);

  function blankOf(item: QuizItem): Blank | undefined {
    return item.segs.find((s): s is Blank => typeof s !== "string");
  }

  const results = useMemo(() => {
    const map: Record<string, boolean> = {};
    sheet.forEach((entry) => entry.items.forEach((item) => {
      const blank = item.segs.find((s): s is Blank => typeof s !== "string");
      if (blank) map[item.id] = isBlankCorrect(blank, answers[item.id] ?? "");
    }));
    return map;
  }, [sheet, answers]);

  const correctCount = sheet.reduce((sum, entry) => sum + entry.items.filter((item) => results[item.id]).length, 0);

  async function finishSheet() {
    if (checked || !sheet.length) return;
    setChecked(true);
    onSound(correctCount === totalBlanks ? "combo" : "finish");
    setProgress((current) => {
      const missed = { ...current.missed };
      const knownSet = new Set(current.known);
      sheet.forEach((entry) => {
        const wrong = entry.items.some((item) => !results[item.id]);
        if (wrong) { missed[entry.key] = (missed[entry.key] ?? 0) + 1; knownSet.delete(entry.key); }
        else if (missed[entry.key]) missed[entry.key] = Math.max(0, missed[entry.key] - 1);
      });
      const best = { ...current.best };
      if (sheetRound !== null) best[`round${sheetRound}`] = Math.max(best[`round${sheetRound}`] ?? 0, correctCount);
      return { known: [...knownSet], missed, best };
    });
    try {
      const earned = await onComplete(correctCount, totalBlanks);
      setBonus(earned);
    } catch {
      setBonus(null);
    }
    setTimeout(() => sheetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  const wrongEntries = checked ? sheet.filter((entry) => entry.items.some((item) => !results[item.id])) : [];

  function renderItem(item: QuizItem) {
    const blank = blankOf(item);
    const result = results[item.id];
    const value = answers[item.id] ?? "";
    return (
      <li key={item.id} className={checked ? (result ? "ok" : "ng") : ""}>
        {item.segs.map((seg, i) => {
          if (typeof seg === "string") return <span key={i}>{seg}</span>;
          if (seg.choices) {
            return (
              <span key={i} className="bio-choices">
                {seg.choices.map((choice) => (
                  <button key={choice} type="button" disabled={checked} className={value === choice ? "picked" : ""} onClick={() => setAnswers((a) => ({ ...a, [item.id]: choice }))}>{choice}</button>
                ))}
              </span>
            );
          }
          return (
            <input
              key={i}
              className="bio-blank"
              type="text"
              value={value}
              disabled={checked}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="こたえ"
              style={{ width: `${Math.min(14, Math.max(5, seg.answer.length * 1.15 + 2))}em` }}
              onChange={(e) => setAnswers((a) => ({ ...a, [item.id]: e.target.value }))}
            />
          );
        })}
        {checked && <em className="bio-mark">{result ? <Check size={16} /> : <X size={16} />}</em>}
        {checked && !result && blank && <small className="bio-correct">正解：{blank.answer}{blank.alts.length ? `(${blank.alts.join("・")}も可)` : ""}</small>}
      </li>
    );
  }

  const roundTitle = ROUNDS[0];

  return (
    <section id="bio-card-training" className="basic-training section-shell bio-section">
      <div className="section-title-row basic-title-row">
        <div><span className="section-kicker">BIOLOGY CARD</span><h2>生物カード</h2></div>
        <p>塾の生物カードを画面で。表(イラスト)から名前を思い出して、うらで答え合わせ。確認テストは本番と同じ形式です。</p>
      </div>

      <div className="bio-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "study"} className={tab === "study" ? "active" : ""} onClick={() => setTab("study")}><Layers size={16} /> カードで覚える</button>
        <button type="button" role="tab" aria-selected={tab === "test"} className={tab === "test" ? "active" : ""} onClick={() => setTab("test")}><ClipboardCheck size={16} /> 確認テスト</button>
        <span className="bio-count">覚えた {knownCount}/{ALL_DECK.length}</span>
      </div>

      {tab === "study" && deck.length === 0 && (
        <div className="bio-panel">
          <div className="bio-toolbar">
            <div className="bio-filters">
              {FILTERS.map((f) => <button key={f.id} type="button" className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>{f.label}</button>)}
            </div>
            <label className="bio-search"><Search size={15} /><input type="search" value={query} placeholder="名前でさがす" onChange={(e) => setQuery(e.target.value)} /></label>
          </div>
          <div className="bio-start">
            <button type="button" className="primary-button" disabled={!listed.length} onClick={() => startDeck(listed)}>この{listed.length}枚を順番に</button>
            <button type="button" className="secondary-button" disabled={!listed.length} onClick={() => startDeck(shuffle(listed))}><Shuffle size={16} /> シャッフル</button>
          </div>
          <div className="bio-grid">
            {listed.map((entry, i) => (
              <button key={entry.key} type="button" className={`bio-tile${known.has(entry.key) ? " known" : ""}${(progress.missed[entry.key] ?? 0) > 0 ? " missed" : ""}`} onClick={() => startDeck(listed, i)}>
                <b>{entry.card ? entry.card.no : entry.fam!.mark}</b>
                <span>{entry.card ? entry.card.name : entry.fam!.title}</span>
                {entry.card?.star && <Star size={11} fill="currentColor" />}
                {known.has(entry.key) && <Check size={13} />}
              </button>
            ))}
            {!listed.length && <p className="bio-empty">条件に合うカードがありません。</p>}
          </div>
        </div>
      )}

      {tab === "study" && current && (
        <div className="bio-panel bio-viewer">
          {(
            <>
              <div className="bio-viewer-head">
                <span>{pos + 1} / {deck.length}</span>
                <div className="basic-progress"><span style={{ width: `${((pos + 1) / deck.length) * 100}%` }} /></div>
                <button type="button" className="secondary-button" onClick={() => { setDeck([]); setPos(0); setFlipped(false); }}>一覧へ</button>
              </div>
              <button type="button" className="bio-card-stage" onClick={() => setFlipped((f) => !f)} aria-label={flipped ? "表を見る" : "うらを見る"}>
                {current.card && !flipped && (
                  <div className="bio-face bio-front">
                    <span className="bio-no">{current.card.no}</span>
                    <img src={cardImage(current.card.no)} alt="生物のイラスト" />
                  </div>
                )}
                {current.card && flipped && <CardBack card={current.card} />}
                {current.fam && !flipped && <FamilyFront fam={current.fam} />}
                {current.fam && flipped && <FamilyBack fam={current.fam} />}
                <small className="bio-hint">{flipped ? "タップで表にもどる" : "タップでうらを見る"}</small>
              </button>
              <div className="bio-viewer-actions">
                <button type="button" className="secondary-button" disabled={pos === 0} onClick={goPrev}><ChevronLeft size={18} /> まえ</button>
                {!flipped ? (
                  <button type="button" className="primary-button" onClick={() => setFlipped(true)}>めくる</button>
                ) : (
                  <>
                    <button type="button" className="bio-not-yet" onClick={() => { mark(current.key, false); goNext(); }}><RotateCcw size={16} /> まだ</button>
                    <button type="button" className="bio-got-it" onClick={() => { mark(current.key, true); onSound("correct"); goNext(); }}><Check size={16} /> 覚えた</button>
                  </>
                )}
                <button type="button" className="secondary-button" onClick={goNext}>つぎ <ChevronRight size={18} /></button>
              </div>
            </>
          )}
        </div>
      )}
      {tab === "study" && deck.length > 0 && pos >= deck.length && (
        <div className="bio-panel bio-done">
          <Check size={34} />
          <h3>ひととおり終わりました</h3>
          <p>覚えたカード {knownCount} / {ALL_DECK.length} 枚</p>
          <div className="bio-start">
            <button type="button" className="primary-button" onClick={() => { setDeck([]); setPos(0); }}>一覧にもどる</button>
            <button type="button" className="secondary-button" onClick={() => startDeck(shuffle(ALL_DECK.filter((e) => !known.has(e.key))))}>まだのカードだけ</button>
          </div>
        </div>
      )}

      {tab === "test" && !sheet.length && (
        <div className="bio-panel bio-test-menu">
          <div className="bio-test-choice real">
            <div>
              <strong>{roundTitle.title}</strong>
              <p>塾で実際に出された確認テスト(タンポポ・ジャガイモ・ヒガンバナ・アブラナ・イネ／20点満点)をそのまま再現しています。{progress.best.round7 !== undefined && <em>ベスト {progress.best.round7}/20</em>}</p>
            </div>
            <button type="button" className="primary-button" onClick={() => startSheet(roundSheet(roundTitle), roundTitle.title, roundTitle.id)}>第{roundTitle.id}回に挑戦</button>
          </div>
          <div className="bio-test-choice">
            <div>
              <strong>ランダムで5枚</strong>
              <p>カードから5枚えらんで、生物名と説明のかっこをうめる形式で出題します。毎回ちがう問題になります。</p>
              <div className="bio-filters">
                {([["all", "すべて"], ["plant", "植物"], ["animal", "動物"], ["plankton", "プランクトン・化石"], ["weak", "苦手・未習得"], ["family", "付録(科)"]] as const).map(([id, label]) => (
                  <button key={id} type="button" className={testFilter === id ? "active" : ""} onClick={() => setTestFilter(id)}>{label}</button>
                ))}
              </div>
            </div>
            <button type="button" className="primary-button" onClick={startRandom}><Shuffle size={16} /> 5枚で挑戦</button>
          </div>
        </div>
      )}

      {tab === "test" && sheet.length > 0 && (
        <div className="bio-panel" ref={sheetRef}>
          <div className="bio-sheet-head">
            <div><strong>{sheetTitle}</strong><small>各かっこ1点・{totalBlanks}点満点。ひらがなでもOK。</small></div>
            {checked && <div className="bio-score"><b>{correctCount}</b> / {totalBlanks}点{bonus !== null && bonus > 0 && <span>+{bonus} COIN</span>}</div>}
          </div>
          <div className="bio-sheet">
            {sheet.map((entry, ei) => (
              <article key={entry.key} className="bio-entry">
                <div className="bio-entry-pic">
                  <span className="bio-circled">{ei + 1}</span>
                  {entry.imageSrc ? <img src={entry.imageSrc} alt={`${ei + 1}の生物`} /> : <div className="bio-fam-title">{entry.famMark?.split("\n").map((l, i) => <p key={i}>{l}</p>)}</div>}
                </div>
                <ul className={`bio-entry-items${entry.imageSrc ? "" : " all-bullets"}`}>{entry.items.map(renderItem)}</ul>
              </article>
            ))}
          </div>
          <div className="bio-sheet-actions">
            {!checked ? (
              <>
                <button type="button" className="primary-button" onClick={() => void finishSheet()}>答え合わせ</button>
                <button type="button" className="secondary-button" onClick={() => setSheet([])}>やめる</button>
              </>
            ) : (
              <>
                {wrongEntries.length > 0 && <button type="button" className="primary-button" onClick={() => {
                  const entries = wrongEntries.map((e) => ALL_DECK.find((d) => d.key === e.key)).filter((d): d is DeckEntry => Boolean(d));
                  setTab("study"); setSheet([]); startDeck(entries);
                }}>まちがえたカードを見直す({wrongEntries.length}枚)</button>}
                <button type="button" className="secondary-button" onClick={() => { setSheet([]); }}>メニューへ</button>
                {sheetRound === null && <button type="button" className="secondary-button" onClick={startRandom}><Shuffle size={16} /> つぎの問題</button>}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
