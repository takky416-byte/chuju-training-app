import kanjiCollection from "./data/kanji-basic-001-005.json";
import kanjiCollection2 from "./data/kanji-basic-006-010.json";
import geographyCollection from "./data/geography-basic-001-005.json";
import geographyCollection2 from "./data/geography-basic-006-010.json";

export const BASIC_SUBJECT_IDS = ["kanji", "vocabulary", "kanjiReading", "geography", "history", "biology", "earthScience", "physics", "chemistry"] as const;
export type BasicSubject = (typeof BASIC_SUBJECT_IDS)[number];
export type ChoiceBasicSubject = Exclude<BasicSubject, "kanji">;

export const BASIC_SUBJECT_CONFIG: Record<BasicSubject, { label: string; collectionType: string; setType: string }> = {
  kanji: { label: "漢字の書き", collectionType: "kanji-writing-collection", setType: "kanji-writing" },
  vocabulary: { label: "語句", collectionType: "vocabulary-collection", setType: "vocabulary" },
  kanjiReading: { label: "漢字の読み", collectionType: "kanji-reading-collection", setType: "kanji-reading" },
  geography: { label: "地理", collectionType: "geography-collection", setType: "geography" },
  history: { label: "歴史", collectionType: "history-collection", setType: "history" },
  biology: { label: "生物", collectionType: "biology-collection", setType: "biology" },
  earthScience: { label: "地学", collectionType: "earth-science-collection", setType: "earth-science" },
  physics: { label: "物理", collectionType: "physics-collection", setType: "physics" },
  chemistry: { label: "化学", collectionType: "chemistry-collection", setType: "chemistry" },
};

export type KanjiQuestion = {
  id: string;
  title: string;
  sentence: string;
  reading: string;
  answer: string;
  acceptedAnswers: string[];
  explanation: string;
  targetKanji: string[];
  targetWord: string;
  grade: number;
  category: string;
  tags: string[];
  difficulty: number;
  timeLimitSeconds: number;
  knowledgeKey: string;
  source: "custom";
  references: string[];
};

export type GeographyQuestion = {
  id: string;
  title: string;
  context: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  topic: string;
  subtopic: string;
  questionType: string;
  region: string[];
  difficulty: number;
  timeLimitSeconds: number;
  materials: unknown[];
  statisticsYear: number | null;
  source: "custom";
  references: string[];
  knowledgeKey: string;
};

export type BasicQuestionSet<T> = {
  schemaVersion: number;
  setId: string;
  setTitle: string;
  type: string;
  questions: T[];
};

export type BasicQuestionEntry =
  | { subject: "kanji"; setId: string; question: KanjiQuestion }
  | { subject: ChoiceBasicSubject; setId: string; question: GeographyQuestion };

export const KANJI_SETS = [
  ...(kanjiCollection.sets as BasicQuestionSet<KanjiQuestion>[]),
  ...(kanjiCollection2.sets as BasicQuestionSet<KanjiQuestion>[]),
];
export const GEOGRAPHY_SETS = [
  ...(geographyCollection.sets as BasicQuestionSet<GeographyQuestion>[]),
  ...(geographyCollection2.sets as BasicQuestionSet<GeographyQuestion>[]),
];
export const KANJI_QUESTIONS = KANJI_SETS.flatMap((set) => set.questions);
export const GEOGRAPHY_QUESTIONS = GEOGRAPHY_SETS.flatMap((set) => set.questions);
export const BASIC_QUESTION_POOL: BasicQuestionEntry[] = [
  ...KANJI_SETS.flatMap((set) => set.questions.map((question) => ({ subject: "kanji" as const, setId: set.setId, question }))),
  ...GEOGRAPHY_SETS.flatMap((set) => set.questions.map((question) => ({ subject: "geography" as const, setId: set.setId, question }))),
];

export function normalizeStoredBasicQuestion(value: unknown): BasicQuestionEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const subject = row.subject;
  const setId = typeof row.setId === "string" ? row.setId : "";
  if (!setId || typeof subject !== "string" || !BASIC_SUBJECT_IDS.includes(subject as BasicSubject)) return null;
  const { subject: _subject, setId: _setId, ...question } = row;
  if (typeof question.id !== "string" || typeof question.title !== "string" || typeof question.explanation !== "string") return null;
  if (subject === "kanji") {
    if (typeof question.sentence !== "string" || typeof question.answer !== "string" || typeof question.reading !== "string") return null;
    return { subject, setId, question: question as KanjiQuestion };
  }
  if (!Array.isArray(question.options) || question.options.length !== 4 || !Number.isInteger(question.correctIndex)) return null;
  return { subject: subject as ChoiceBasicSubject, setId, question: question as GeographyQuestion };
}

export const GEOGRAPHY_TOPIC_LABELS: Record<string, string> = {
  climate: "気候",
  data: "資料・統計",
  industry: "産業",
  integrated: "総合地理",
  landform: "地形・河川",
  map: "地図",
  population: "人口・都市",
  prefecture: "都道府県",
  transport: "交通・物流",
};
