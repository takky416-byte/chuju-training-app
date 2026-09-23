"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Check,
  ChevronRight,
  CircleAlert,
  Cloud,
  CloudOff,
  Coins,
  Download,
  FileJson,
  Flame,
  Gamepad2,
  Gift,
  LockKeyhole,
  Music,
  RotateCcw,
  Sparkles,
  Target,
  Timer,
  Trophy,
  Upload,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, where, writeBatch } from "firebase/firestore";
import { DOMAINS, type Domain, type Question } from "./questions";
import { StudyAudioEngine, type AudioVolume, type BgmStyle, type SoundEffect } from "./audio-engine";
import { BasicTraining, type BasicAttempt, type BasicAward, type BasicStartRequest } from "./basic-training";
import {
  BASIC_QUESTION_POOL,
  BASIC_SUBJECT_CONFIG,
  BASIC_SUBJECT_IDS,
  type BasicQuestionEntry,
  type BasicSubject,
  type ChoiceBasicSubject,
  type GeographyQuestion,
  type KanjiQuestion,
} from "./basic-questions";
import {
  auth,
  db,
  firebaseConfigured,
  googleProvider,
  hashEmail,
  LEARNER_ACCOUNT_HASH,
  LEARNER_RECORD_ID,
  PARENT_ACCOUNT_HASHES,
} from "./firebase";

type Attempt = {
  clientAttemptId: string;
  questionId: string;
  domain: Domain;
  isCorrect: boolean;
  selectedIndex: number;
  durationSeconds: number;
  timedOut?: boolean;
  createdAt: string;
};

type SyncState = "loading" | "synced" | "local";
type SessionMode = "weak" | "balanced";
type TrainingTrack = "aptitude" | "basic";
type MasteryState = "unattempted" | "practicing" | "done" | "mastered";
type ResetPreset = "today" | "7days" | "30days" | "custom" | "all";
type ResetWindow = { start: string; end: string; createdAt: string };
type ImportMode = "skip" | "overwrite";
type AptitudeImportPreview = {
  kind: "aptitude";
  fileName: string;
  setTitle: string;
  questions: Question[];
  errors: string[];
  duplicates: string[];
};
type BasicImportPreview = {
  kind: "basic";
  fileName: string;
  setTitle: string;
  subject: BasicSubject;
  questions: BasicQuestionEntry[];
  errors: string[];
  duplicates: string[];
};
type InvalidImportPreview = {
  kind: "invalid";
  fileName: string;
  setTitle: string;
  errors: string[];
};
type ImportPreview = AptitudeImportPreview | BasicImportPreview | InvalidImportPreview;
type GameProgress = {
  totalXp: number;
  bestScore: number;
  bestAccuracy: number;
  bestCombo: number;
  coins: number;
  inventory: string[];
  collectionCounts: Record<string, number>;
  gachaDraws: number;
  gachaDrawsByType: Record<GachaType, number>;
  updatedAt: string;
};
type AnswerAward = {
  points: number;
  xp: number;
  coins: number;
  label: string;
};
type QuestionProgress = {
  questionId: string;
  domain: Domain;
  attemptCount: number;
  correctCount: number;
  latestResults: boolean[];
  updatedAt: string;
};
type QuestionProgressMap = Record<string, QuestionProgress>;
type CollectibleRarity = "common" | "rare" | "superRare";
type CollectibleCategory = "名物・文化" | "名所・自然" | "ものづくり・交通" | "愛知の偉人";
type GachaType = "local" | "industry" | "people";
type Collectible = {
  id: string;
  name: string;
  icon: string;
  rarity: CollectibleRarity;
  category: CollectibleCategory;
  gachaType: GachaType;
  description: string;
};

const ATTEMPTS_KEY = "aichi_training_attempts_v1";
const QUESTIONS_KEY = "aichi_training_custom_questions_v1";
const RESET_WINDOWS_KEY = "aichi_training_reset_windows_v1";
const AUDIO_SETTINGS_KEY = "aichi_training_audio_settings_v1";
const GAME_PROGRESS_KEY = "aichi_training_game_progress_v1";
const GACHA_SETTINGS_KEY = "aichi_training_gacha_settings_v1";
const QUESTION_PROGRESS_KEY = "aichi_training_question_progress_v1";
const MASTERY_ORDER: MasteryState[] = ["practicing", "unattempted", "done", "mastered"];
const EMPTY_GACHA_DRAWS: Record<GachaType, number> = { local: 0, industry: 0, people: 0 };
const EMPTY_GAME_PROGRESS: GameProgress = { totalXp: 0, bestScore: 0, bestAccuracy: 0, bestCombo: 0, coins: 0, inventory: [], collectionCounts: {}, gachaDraws: 0, gachaDrawsByType: EMPTY_GACHA_DRAWS, updatedAt: "" };
const XP_PER_LEVEL = 300;
const GACHA_COST = 20;
const BASIC_SUBJECT_LABELS = Object.fromEntries(BASIC_SUBJECT_IDS.map((id) => [id, BASIC_SUBJECT_CONFIG[id].label])) as Record<BasicSubject, string>;

const COLLECTIBLES: Collectible[] = [
  { id: "uiro", name: "ういろう", icon: "🍡", rarity: "common", category: "名物・文化", gachaType: "local", description: "名古屋のやさしい甘味" },
  { id: "ebisen", name: "えびせんべい", icon: "🦐", rarity: "common", category: "名物・文化", gachaType: "local", description: "海の香りが広がる一枚" },
  { id: "morning", name: "モーニング", icon: "☕", rarity: "common", category: "名物・文化", gachaType: "local", description: "一日のスタートセット" },
  { id: "miso-oden", name: "みそおでん", icon: "🍢", rarity: "common", category: "名物・文化", gachaType: "local", description: "赤みそ仕立ての定番" },
  { id: "seto-cup", name: "瀬戸焼", icon: "🏺", rarity: "rare", category: "名物・文化", gachaType: "local", description: "瀬戸の土から生まれた焼きもの" },
  { id: "kochinchick", name: "名古屋コーチン", icon: "🐓", rarity: "rare", category: "名物・文化", gachaType: "local", description: "堂々とした愛知の名鳥" },
  { id: "manekineko", name: "瀬戸の招き猫", icon: "🐈", rarity: "rare", category: "名物・文化", gachaType: "local", description: "幸運を招く焼きもの" },
  { id: "arimatsu", name: "有松絞り", icon: "👘", rarity: "superRare", category: "名物・文化", gachaType: "local", description: "受け継がれてきた美しい絞り染め" },
  { id: "inuyama", name: "犬山城", icon: "🏯", rarity: "rare", category: "名所・自然", gachaType: "local", description: "木曽川を見守る国宝" },
  { id: "nagoya-castle", name: "名古屋城", icon: "🏰", rarity: "rare", category: "名所・自然", gachaType: "local", description: "金のしゃちほこが輝く城" },
  { id: "atsuta", name: "熱田神宮", icon: "⛩️", rarity: "common", category: "名所・自然", gachaType: "local", description: "緑に包まれた歴史ある場所" },
  { id: "korankei", name: "香嵐渓", icon: "🍁", rarity: "common", category: "名所・自然", gachaType: "local", description: "紅葉で知られる渓谷" },
  { id: "irago", name: "伊良湖岬", icon: "🌊", rarity: "common", category: "名所・自然", gachaType: "local", description: "渥美半島の先端に広がる海" },
  { id: "kinshachi", name: "金のしゃちほこ", icon: "✨", rarity: "superRare", category: "名所・自然", gachaType: "local", description: "名古屋を代表する金色の守り神" },
  { id: "aichi-sky", name: "あいちの星空", icon: "🌟", rarity: "superRare", category: "名所・自然", gachaType: "local", description: "挑戦を照らす特別な星" },
  { id: "hitsumabushi", name: "ひつまぶし", icon: "🍚", rarity: "rare", category: "名物・文化", gachaType: "local", description: "三つの食べ方で楽しむ名古屋めし" },
  { id: "kishimen", name: "きしめん", icon: "🍜", rarity: "common", category: "名物・文化", gachaType: "local", description: "平たくつるりとした尾張の麺" },
  { id: "toyokawa-inari", name: "豊川稲荷", icon: "🦊", rarity: "rare", category: "名所・自然", gachaType: "local", description: "豊川にある全国的に知られた名所" },

  { id: "linimo", name: "リニモ", icon: "🚝", rarity: "rare", category: "ものづくり・交通", gachaType: "industry", description: "磁力で走る未来の電車" },
  { id: "centrair", name: "セントレア", icon: "✈️", rarity: "common", category: "ものづくり・交通", gachaType: "industry", description: "世界へつながる空の玄関" },
  { id: "aichi-car", name: "あいちの自動車", icon: "🚗", rarity: "common", category: "ものづくり・交通", gachaType: "industry", description: "愛知のものづくりを支える一台" },
  { id: "aerospace", name: "航空宇宙産業", icon: "🚀", rarity: "superRare", category: "ものづくり・交通", gachaType: "industry", description: "空と宇宙へ挑む技術" },
  { id: "robot", name: "ものづくりロボ", icon: "🤖", rarity: "rare", category: "ものづくり・交通", gachaType: "industry", description: "工場で活躍する頼れる相棒" },
  { id: "ceramic-tech", name: "ファインセラミックス", icon: "⚙️", rarity: "common", category: "ものづくり・交通", gachaType: "industry", description: "くらしを支える丈夫な素材" },
  { id: "pencil", name: "しゃちほこ鉛筆", icon: "✏️", rarity: "common", category: "ものづくり・交通", gachaType: "industry", description: "勉強が進む金色の鉛筆" },
  { id: "loom", name: "自動織機", icon: "🧵", rarity: "rare", category: "ものづくり・交通", gachaType: "industry", description: "愛知の産業発展を支えた織る技術" },
  { id: "shinkansen", name: "東海道新幹線", icon: "🚄", rarity: "rare", category: "ものづくり・交通", gachaType: "industry", description: "愛知と大都市を高速で結ぶ鉄道" },
  { id: "port-nagoya", name: "名古屋港", icon: "🚢", rarity: "rare", category: "ものづくり・交通", gachaType: "industry", description: "自動車などを世界へ運ぶ貿易港" },
  { id: "toyota-factory", name: "自動車工場", icon: "🏭", rarity: "common", category: "ものづくり・交通", gachaType: "industry", description: "多くの部品を組み立てる生産拠点" },
  { id: "mikan-greenhouse", name: "渥美の温室", icon: "🌱", rarity: "common", category: "ものづくり・交通", gachaType: "industry", description: "温暖な気候を生かした施設園芸" },
  { id: "tokoname-pottery", name: "常滑焼", icon: "🫖", rarity: "rare", category: "ものづくり・交通", gachaType: "industry", description: "急須でも知られる知多半島の焼きもの" },
  { id: "shippoyaki", name: "尾張七宝", icon: "💠", rarity: "superRare", category: "ものづくり・交通", gachaType: "industry", description: "金属とガラス質の釉薬が生む伝統工芸" },
  { id: "qr-code", name: "QRコード", icon: "🔳", rarity: "superRare", category: "ものづくり・交通", gachaType: "industry", description: "愛知の企業から世界へ広がった二次元コード" },
  { id: "ks-steel", name: "KS鋼", icon: "🧲", rarity: "superRare", category: "ものづくり・交通", gachaType: "industry", description: "強い磁石づくりにつながった合金" },
  { id: "chubu-aircraft", name: "航空機の翼", icon: "🛩️", rarity: "common", category: "ものづくり・交通", gachaType: "industry", description: "中部地方に集まる航空機産業の技術" },
  { id: "ceramic-tile", name: "三州瓦", icon: "🏠", rarity: "common", category: "ものづくり・交通", gachaType: "industry", description: "西三河でつくられる丈夫な瓦" },

  { id: "nobunaga", name: "織田信長", icon: "🦅", rarity: "superRare", category: "愛知の偉人", gachaType: "people", description: "尾張から天下を目指した武将" },
  { id: "hideyoshi", name: "豊臣秀吉", icon: "🌞", rarity: "superRare", category: "愛知の偉人", gachaType: "people", description: "尾張に生まれ天下統一を進めた武将" },
  { id: "ieyasu", name: "徳川家康", icon: "🐢", rarity: "superRare", category: "愛知の偉人", gachaType: "people", description: "三河に生まれ江戸幕府を開いた武将" },
  { id: "toshiie", name: "前田利家", icon: "🗡️", rarity: "rare", category: "愛知の偉人", gachaType: "people", description: "尾張に生まれ加賀藩の基礎を築いた武将" },
  { id: "kiyomasa", name: "加藤清正", icon: "🐯", rarity: "rare", category: "愛知の偉人", gachaType: "people", description: "尾張に生まれた築城の名手" },
  { id: "katsuie", name: "柴田勝家", icon: "🛡️", rarity: "common", category: "愛知の偉人", gachaType: "people", description: "織田信長を支えた尾張の武将" },
  { id: "de-rijke", name: "ヨハネス・デ・レイケ", icon: "🌊", rarity: "superRare", category: "愛知の偉人", gachaType: "people", description: "木曽三川の分流計画に力を尽くしたオランダ人技師" },
  { id: "tsuzuki-yako", name: "都築弥厚", icon: "💧", rarity: "rare", category: "愛知の偉人", gachaType: "people", description: "碧海台地へ水を引く明治用水を構想した人物" },
  { id: "niimi-nankichi", name: "新美南吉", icon: "🦊", rarity: "rare", category: "愛知の偉人", gachaType: "people", description: "半田出身で『ごんぎつね』を書いた児童文学者" },
  { id: "honda-kotaro", name: "本多光太郎", icon: "🧲", rarity: "superRare", category: "愛知の偉人", gachaType: "people", description: "強力な磁石鋼・KS鋼を発明した科学者" },
  { id: "toyoda-sakichi", name: "豊田佐吉", icon: "🧵", rarity: "superRare", category: "愛知の偉人", gachaType: "people", description: "自動織機を発明し地域産業の礎を築いた発明家" },
  { id: "toyoda-kiichiro", name: "豊田喜一郎", icon: "🚙", rarity: "superRare", category: "愛知の偉人", gachaType: "people", description: "国産自動車の量産をめざし自動車会社を設立した人物" },
  { id: "morita-akio", name: "盛田昭夫", icon: "📻", rarity: "rare", category: "愛知の偉人", gachaType: "people", description: "常滑にゆかりを持ち、世界へ電機製品を広げた実業家" },
  { id: "tokugawa-muneharu", name: "徳川宗春", icon: "🎭", rarity: "common", category: "愛知の偉人", gachaType: "people", description: "尾張藩の文化とにぎわいを育てた藩主" },
  { id: "sugimoto-kyota", name: "杉本京太", icon: "⌨️", rarity: "rare", category: "愛知の偉人", gachaType: "people", description: "邦文タイプライターを発明した人物" },
  { id: "ichikawa-fusae", name: "市川房枝", icon: "🗳️", rarity: "rare", category: "愛知の偉人", gachaType: "people", description: "一宮出身で女性参政権運動に尽くした人物" },
  { id: "honda-tadakatsu", name: "本多忠勝", icon: "🦌", rarity: "common", category: "愛知の偉人", gachaType: "people", description: "三河に生まれ、徳川家康を支えた武将" },
  { id: "kawai-gyokudo", name: "川合玉堂", icon: "🖌️", rarity: "common", category: "愛知の偉人", gachaType: "people", description: "一宮に生まれ、日本の自然を描いた日本画家" },
];

const GACHA_TYPES: Array<{ id: GachaType; label: string; description: string }> = [
  { id: "local", label: "ご当地ガチャ", description: "名物・文化・名所" },
  { id: "industry", label: "ものづくりガチャ", description: "産業・技術・交通" },
  { id: "people", label: "人物ガチャ", description: "愛知にゆかりの人物" },
];

const HERO_MESSAGES = [
  { lead: "今日の一問が、", accent: "本番の一歩。" },
  { lead: "迷ったら、", accent: "条件をもう一度。" },
  { lead: "短く集中。", accent: "5問に挑戦。" },
  { lead: "速く、正確に。", accent: "今日も一歩。" },
  { lead: "まずは5問。", accent: "リズムをつくろう。" },
  { lead: "選ぶ前に、", accent: "根拠を一つ。" },
  { lead: "焦らず読んで、", accent: "すばやく選ぶ。" },
  { lead: "今日の弱点を、", accent: "今日の得意へ。" },
  { lead: "ひらめきより、", accent: "条件整理。" },
  { lead: "さあ開始。", accent: "集中モード。" },
] as const;

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function mergeAttempts(a: Attempt[], b: Attempt[]) {
  const map = new Map<string, Attempt>();
  [...a, ...b].forEach((item) => map.set(item.clientAttemptId, item));
  return [...map.values()].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

function getTimeLimit(question?: Question) {
  return Math.min(30, Math.max(10, Math.round(question?.timeLimitSeconds ?? 20)));
}

function normalizeGameProgress(value: unknown): GameProgress {
  if (!value || typeof value !== "object") return EMPTY_GAME_PROGRESS;
  const row = value as Partial<GameProgress>;
  const inventory = Array.isArray(row.inventory) ? [...new Set(row.inventory.filter((item): item is string => typeof item === "string"))] : [];
  const rawCounts = row.collectionCounts && typeof row.collectionCounts === "object" ? row.collectionCounts : {};
  const collectionCounts = Object.fromEntries(Object.entries(rawCounts).filter(([key, count]) => typeof key === "string" && Number(count) > 0).map(([key, count]) => [key, Math.max(1, Math.round(Number(count)))]));
  inventory.forEach((id) => { if (!collectionCounts[id]) collectionCounts[id] = 1; });
  const legacyDraws = Math.max(0, Math.round(Number(row.gachaDraws) || 0));
  const rawDraws: Partial<Record<GachaType, number>> = row.gachaDrawsByType && typeof row.gachaDrawsByType === "object" ? row.gachaDrawsByType : {};
  const gachaDrawsByType: Record<GachaType, number> = {
    local: Math.max(0, Math.round(Number(rawDraws.local) || legacyDraws)),
    industry: Math.max(0, Math.round(Number(rawDraws.industry) || 0)),
    people: Math.max(0, Math.round(Number(rawDraws.people) || 0)),
  };
  return {
    totalXp: Math.max(0, Math.round(Number(row.totalXp) || 0)),
    bestScore: Math.max(0, Math.round(Number(row.bestScore) || 0)),
    bestAccuracy: Math.min(100, Math.max(0, Math.round(Number(row.bestAccuracy) || 0))),
    bestCombo: Math.max(0, Math.round(Number(row.bestCombo) || 0)),
    coins: Math.max(0, Math.round(Number(row.coins) || 0)),
    inventory,
    collectionCounts,
    gachaDraws: legacyDraws,
    gachaDrawsByType,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
  };
}

function mergeGameProgress(a: GameProgress, b: GameProgress): GameProgress {
  const newer = a.updatedAt > b.updatedAt ? a : b;
  const collectionIds = new Set([...Object.keys(a.collectionCounts), ...Object.keys(b.collectionCounts), ...a.inventory, ...b.inventory]);
  const collectionCounts = Object.fromEntries([...collectionIds].map((id) => [id, Math.max(a.collectionCounts[id] ?? 0, b.collectionCounts[id] ?? 0, 1)]));
  return {
    totalXp: Math.max(a.totalXp, b.totalXp),
    bestScore: Math.max(a.bestScore, b.bestScore),
    bestAccuracy: Math.max(a.bestAccuracy, b.bestAccuracy),
    bestCombo: Math.max(a.bestCombo, b.bestCombo),
    coins: newer.coins,
    inventory: [...collectionIds],
    collectionCounts,
    gachaDraws: Math.max(a.gachaDraws, b.gachaDraws),
    gachaDrawsByType: {
      local: Math.max(a.gachaDrawsByType.local, b.gachaDrawsByType.local),
      industry: Math.max(a.gachaDrawsByType.industry, b.gachaDrawsByType.industry),
      people: Math.max(a.gachaDrawsByType.people, b.gachaDrawsByType.people),
    },
    updatedAt: newer.updatedAt,
  };
}

function getCompletionCoinBonus(rank: string) {
  return 5 + (rank === "S" ? 10 : rank === "A" ? 5 : rank === "B" ? 2 : 0);
}

function drawCollectible(drawNumber: number, gachaType: GachaType) {
  const guaranteedRare = drawNumber % 10 === 0;
  const roll = Math.random() * 100;
  const rarity: CollectibleRarity = guaranteedRare
    ? (roll < 16.7 ? "superRare" : "rare")
    : (roll < 5 ? "superRare" : roll < 30 ? "rare" : "common");
  const pool = COLLECTIBLES.filter((item) => item.gachaType === gachaType && item.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

function getSessionRank(correct: number, total: number) {
  const accuracy = total ? correct / total : 0;
  if (accuracy === 1) return "S";
  if (accuracy >= 0.8) return "A";
  if (accuracy >= 0.6) return "B";
  return "C";
}

function formatEnumeratedText(text: string) {
  const circledNumbers = text.match(/[①-⑳]/g) ?? [];
  const kanaLabels = text.match(/【[アイウエオカキクケコ]】/g) ?? [];
  let formatted = text;
  if (circledNumbers.length >= 2) formatted = formatted.replace(/\s*(?=[①-⑳])/g, "\n");
  if (kanaLabels.length >= 2) formatted = formatted.replace(/\s*(?=【[アイウエオカキクケコ]】)/g, "\n");
  return formatted.trim();
}

function mergeResetWindows(windows: ResetWindow[]) {
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  const merged: ResetWindow[] = [];
  sorted.forEach((window) => {
    const previous = merged[merged.length - 1];
    if (previous && window.start <= previous.end) {
      previous.end = previous.end > window.end ? previous.end : window.end;
      previous.createdAt = previous.createdAt > window.createdAt ? previous.createdAt : window.createdAt;
    } else {
      merged.push({ ...window });
    }
  });
  return merged;
}

function isResetAttempt(attempt: Attempt, windows: ResetWindow[]) {
  return windows.some((window) => (
    attempt.createdAt >= window.start
    && attempt.createdAt < window.end
    && attempt.createdAt <= window.createdAt
  ));
}

function localDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getMasteryState(rows: Array<{ isCorrect: boolean; createdAt: string }>): MasteryState {
  const latest = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!latest.length) return "unattempted";
  if (latest[0].isCorrect && latest[1]?.isCorrect) return "mastered";
  if (latest[0].isCorrect) return "done";
  return "practicing";
}

function getProgressMasteryState(progress?: QuestionProgress): MasteryState {
  if (!progress?.attemptCount) return "unattempted";
  if (progress.latestResults[0] && progress.latestResults[1]) return "mastered";
  if (progress.latestResults[0]) return "done";
  return "practicing";
}

function buildQuestionProgress(attempts: Attempt[]): QuestionProgressMap {
  const grouped = new Map<string, Attempt[]>();
  attempts.forEach((attempt) => grouped.set(attempt.questionId, [...(grouped.get(attempt.questionId) ?? []), attempt]));
  return Object.fromEntries([...grouped.entries()].map(([questionId, rows]) => {
    const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = sorted[0];
    const progress: QuestionProgress = {
      questionId,
      domain: latest.domain,
      attemptCount: sorted.length,
      correctCount: sorted.filter((row) => row.isCorrect).length,
      latestResults: sorted.slice(0, 2).map((row) => row.isCorrect),
      updatedAt: latest.createdAt,
    };
    return [questionId, progress];
  }));
}

function normalizeQuestionProgressMap(value: unknown): QuestionProgressMap {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(source).flatMap(([questionId, raw]) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Partial<QuestionProgress>;
    if (!DOMAINS.includes(row.domain as Domain)) return [];
    const attemptCount = Math.max(0, Math.round(Number(row.attemptCount) || 0));
    const correctCount = Math.min(attemptCount, Math.max(0, Math.round(Number(row.correctCount) || 0)));
    return [[questionId, {
      questionId,
      domain: row.domain as Domain,
      attemptCount,
      correctCount,
      latestResults: Array.isArray(row.latestResults) ? row.latestResults.filter((item): item is boolean => typeof item === "boolean").slice(0, 2) : [],
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
    } satisfies QuestionProgress]];
  }));
}

function mergeQuestionProgress(a: QuestionProgressMap, b: QuestionProgressMap): QuestionProgressMap {
  const merged = { ...a };
  Object.entries(b).forEach(([questionId, progress]) => {
    const current = merged[questionId];
    if (!current || progress.updatedAt >= current.updatedAt) merged[questionId] = progress;
  });
  return merged;
}

function getBestCorrectStreak(rows: Array<{ isCorrect: boolean; createdAt: string }>) {
  let current = 0;
  let best = 0;
  [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach((attempt) => {
    current = attempt.isCorrect ? current + 1 : 0;
    best = Math.max(best, current);
  });
  return best;
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DOMAIN_ALIASES: Record<string, Domain> = {
  "数量・図形": "数量・図形",
  "文章・会話": "文章・ことば",
  "文章・ことば": "文章・ことば",
  "資料・グラフ": "表・グラフ",
  "表・グラフ": "表・グラフ",
  "理科・観察": "理科・観察",
  "社会・生活": "社会・生活",
  "論理・情報": "論理・ルール",
  "論理・ルール": "論理・ルール",
};

function normalizeDomain(value: unknown) {
  return typeof value === "string" ? DOMAIN_ALIASES[value] ?? null : null;
}

function normalizeStoredAttempt(value: unknown): Attempt | null {
  if (!isRecord(value)) return null;
  const domain = normalizeDomain(value.domain);
  if (!domain) return null;
  return { ...value, domain } as Attempt;
}

function normalizeStoredQuestion(value: unknown): Question | null {
  if (!isRecord(value)) return null;
  const domain = normalizeDomain(value.domain);
  if (!domain) return null;
  return { ...value, domain, source: "custom" } as Question;
}

function validateImportedQuestion(value: unknown, position: number) {
  const errors: string[] = [];
  const label = `${position + 1}問目`;
  if (!isRecord(value)) return { errors: [`${label}: 問題データがオブジェクトではありません`] };

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const domain = typeof value.domain === "string" ? value.domain : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const context = typeof value.context === "string" ? value.context.trim() : "";
  const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  const options = Array.isArray(value.options) ? value.options.map((option) => typeof option === "string" ? option.trim() : "") : [];
  const correctIndex = value.correctIndex;
  const timeLimitSeconds = value.timeLimitSeconds;
  const explanation = typeof value.explanation === "string" ? value.explanation.trim() : "";
  const skill = typeof value.skill === "string" ? value.skill.trim() : "";

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(id)) errors.push(`${label}: idは3～80文字の半角英数字・ハイフン・アンダースコアで指定してください`);
  if (!DOMAINS.includes(domain as Domain)) errors.push(`${label}（${id || "IDなし"}）: domainが6分野のいずれでもありません`);
  if (!title) errors.push(`${label}（${id || "IDなし"}）: titleが空です`);
  if (!prompt) errors.push(`${label}（${id || "IDなし"}）: promptが空です`);
  if (options.length !== 4 || options.some((option) => !option)) errors.push(`${label}（${id || "IDなし"}）: optionsは空欄のない4項目にしてください`);
  if (!Number.isInteger(correctIndex) || Number(correctIndex) < 0 || Number(correctIndex) > 3) errors.push(`${label}（${id || "IDなし"}）: correctIndexは0～3の整数にしてください`);
  if (!Number.isInteger(timeLimitSeconds) || Number(timeLimitSeconds) < 10 || Number(timeLimitSeconds) > 30) errors.push(`${label}（${id || "IDなし"}）: timeLimitSecondsは10～30の整数にしてください`);
  if (!explanation) errors.push(`${label}（${id || "IDなし"}）: explanationが空です`);
  if (!skill) errors.push(`${label}（${id || "IDなし"}）: skillが空です`);
  if (value.source !== "custom") errors.push(`${label}（${id || "IDなし"}）: sourceはcustomにしてください`);

  if (errors.length) return { errors };
  const question: Question = {
    id,
    domain: domain as Domain,
    title,
    context,
    prompt,
    options,
    correctIndex: Number(correctIndex),
    timeLimitSeconds: Number(timeLimitSeconds),
    explanation,
    skill,
    source: "custom",
  };
  return { question, errors };
}

function validateImportedBasicQuestion(value: unknown, position: number, subject: BasicSubject, setId: string) {
  const errors: string[] = [];
  const label = `${position + 1}問目`;
  if (!isRecord(value)) return { errors: [`${label}: 問題データがオブジェクトではありません`] };
  const text = (key: string) => typeof value[key] === "string" ? value[key].trim() : "";
  const strings = (key: string) => Array.isArray(value[key]) ? value[key].map((item) => typeof item === "string" ? item.trim() : "") : [];
  const id = text("id");
  const title = text("title");
  const explanation = text("explanation");
  const difficulty = value.difficulty;
  const timeLimitSeconds = value.timeLimitSeconds;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(id)) errors.push(`${label}: idは3～80文字の半角英数字・ハイフン・アンダースコアで指定してください`);
  if (!title) errors.push(`${label}（${id || "IDなし"}）: titleが空です`);
  if (!explanation) errors.push(`${label}（${id || "IDなし"}）: explanationが空です`);
  if (!Number.isInteger(difficulty) || Number(difficulty) < 1 || Number(difficulty) > 3) errors.push(`${label}（${id || "IDなし"}）: difficultyは1～3の整数にしてください`);
  if (!Number.isInteger(timeLimitSeconds) || Number(timeLimitSeconds) < 10 || Number(timeLimitSeconds) > 45) errors.push(`${label}（${id || "IDなし"}）: timeLimitSecondsは10～45の整数にしてください`);
  if (value.source !== "custom") errors.push(`${label}（${id || "IDなし"}）: sourceはcustomにしてください`);

  if (subject === "kanji") {
    const required = ["sentence", "reading", "answer", "category", "knowledgeKey"] as const;
    required.forEach((key) => { if (!text(key)) errors.push(`${label}（${id || "IDなし"}）: ${key}が空です`); });
    if (!Array.isArray(value.acceptedAnswers) || strings("acceptedAnswers").some((item) => !item)) errors.push(`${label}（${id || "IDなし"}）: acceptedAnswersは文字列配列にしてください`);
    if (errors.length) return { errors };
    return { question: { subject, setId, question: { ...value, id, title, explanation, source: "custom" } as KanjiQuestion } satisfies BasicQuestionEntry, errors };
  }

  const required = ["prompt", "topic", "subtopic", "knowledgeKey"] as const;
  required.forEach((key) => { if (!text(key)) errors.push(`${label}（${id || "IDなし"}）: ${key}が空です`); });
  const options = strings("options");
  if (options.length !== 4 || options.some((item) => !item)) errors.push(`${label}（${id || "IDなし"}）: optionsは空欄のない4項目にしてください`);
  if (!Number.isInteger(value.correctIndex) || Number(value.correctIndex) < 0 || Number(value.correctIndex) > 3) errors.push(`${label}（${id || "IDなし"}）: correctIndexは0～3の整数にしてください`);
  if (errors.length) return { errors };
  return { question: { subject: subject as ChoiceBasicSubject, setId, question: { ...value, id, title, explanation, options, source: "custom" } as GeographyQuestion } satisfies BasicQuestionEntry, errors };
}

function fileDomainCounts(file: ImportPreview) {
  if (file.kind === "aptitude") {
    return DOMAINS.map((domain) => ({ label: domain, count: file.questions.filter((question) => question.domain === domain).length })).filter((row) => row.count > 0);
  }
  if (file.kind === "basic") {
    return file.questions.length ? [{ label: BASIC_SUBJECT_LABELS[file.subject], count: file.questions.length }] : [];
  }
  return [];
}

function fileNewCount(file: ImportPreview) {
  return file.kind === "invalid" ? 0 : file.questions.length - file.duplicates.length;
}

function annotateCrossFileDuplicates(files: ImportPreview[]): ImportPreview[] {
  const idFiles = { aptitude: new Map<string, number[]>(), basic: new Map<string, number[]>() };
  files.forEach((file, index) => {
    if (file.kind === "invalid") return;
    const map = idFiles[file.kind];
    const ids = file.kind === "aptitude" ? file.questions.map((question) => question.id) : file.questions.map((entry) => entry.question.id);
    ids.forEach((id) => map.set(id, [...(map.get(id) ?? []), index]));
  });
  const conflictsByFile = new Map<number, Set<string>>();
  [idFiles.aptitude, idFiles.basic].forEach((map) => {
    map.forEach((indices, id) => {
      if (indices.length < 2) return;
      indices.forEach((index) => conflictsByFile.set(index, (conflictsByFile.get(index) ?? new Set()).add(id)));
    });
  });
  return files.map((file, index) => {
    const conflicts = conflictsByFile.get(index);
    if (!conflicts?.size) return file;
    return { ...file, errors: [...file.errors, ...[...conflicts].map((id) => `他の選択ファイルとID「${id}」が重複しています`)] };
  });
}

export default function TrainingApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [accountHash, setAccountHash] = useState("");
  const [authError, setAuthError] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [questionProgress, setQuestionProgress] = useState<QuestionProgressMap>({});
  const [customQuestions, setCustomQuestions] = useState<Question[]>([]);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [session, setSession] = useState<Question[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(20);
  const [sessionAnswers, setSessionAnswers] = useState<boolean[]>([]);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [sessionPoints, setSessionPoints] = useState(0);
  const [sessionXp, setSessionXp] = useState(0);
  const [sessionCoins, setSessionCoins] = useState(0);
  const [combo, setCombo] = useState(0);
  const [sessionBestCombo, setSessionBestCombo] = useState(0);
  const [answerAward, setAnswerAward] = useState<AnswerAward | null>(null);
  const [gameProgress, setGameProgress] = useState<GameProgress>(EMPTY_GAME_PROGRESS);
  const [sessionNewBest, setSessionNewBest] = useState(false);
  const [gachaEnabled, setGachaEnabled] = useState(true);
  const [gachaResult, setGachaResult] = useState<{ item: Collectible; count: number; isNew: boolean } | null>(null);
  const [gachaStatus, setGachaStatus] = useState("");
  const [isDrawingGacha, setIsDrawingGacha] = useState(false);
  const [gachaRevealOpen, setGachaRevealOpen] = useState(false);
  const [gachaType, setGachaType] = useState<GachaType>("local");
  const [collectionGachaType, setCollectionGachaType] = useState<GachaType>("local");
  const [basicTrainingActive, setBasicTrainingActive] = useState(false);
  const [basicAttempts, setBasicAttempts] = useState<BasicAttempt[]>([]);
  const [basicQuestionCatalog, setBasicQuestionCatalog] = useState<BasicQuestionEntry[]>(BASIC_QUESTION_POOL);
  const [basicQuestionRefreshToken, setBasicQuestionRefreshToken] = useState(0);
  const [basicStartRequest, setBasicStartRequest] = useState<BasicStartRequest | null>(null);
  const [heroTrack, setHeroTrack] = useState<TrainingTrack>("aptitude");
  const [importFiles, setImportFiles] = useState<ImportPreview[]>([]);
  const [importMode, setImportMode] = useState<ImportMode>("skip");
  const [importStatus, setImportStatus] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [heroMessage, setHeroMessage] = useState<(typeof HERO_MESSAGES)[number]>(HERO_MESSAGES[0]);
  const [resetWindows, setResetWindows] = useState<ResetWindow[]>([]);
  const [resetPreset, setResetPreset] = useState<ResetPreset>("7days");
  const [resetStart, setResetStart] = useState("");
  const [resetEnd, setResetEnd] = useState("");
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetStatus, setResetStatus] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [bgmEnabled, setBgmEnabled] = useState(true);
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const [bgmStyle, setBgmStyle] = useState<BgmStyle>("focus");
  const [bgmVolume, setBgmVolume] = useState<AudioVolume>("medium");
  const [effectVolume, setEffectVolume] = useState<AudioVolume>("medium");
  const [audioSettingsReady, setAudioSettingsReady] = useState(false);
  const questionStartedAt = useRef(Date.now());
  const audioEngine = useRef<StudyAudioEngine | null>(null);
  const effectsEnabledRef = useRef(true);

  const questions = customQuestions;
  const activeQuestion = session[questionIndex];
  const activeTimeLimit = getTimeLimit(activeQuestion);
  const isExerciseActive = session.length > 0 && !sessionFinished;
  const isAnyExerciseActive = isExerciseActive || basicTrainingActive;
  const gameLevel = Math.floor(gameProgress.totalXp / XP_PER_LEVEL) + 1;
  const levelXp = gameProgress.totalXp % XP_PER_LEVEL;
  const ownedCollectibles = COLLECTIBLES.filter((item) => gameProgress.inventory.includes(item.id));
  const visibleCollectibles = COLLECTIBLES.filter((item) => item.gachaType === collectionGachaType);
  const basicQuestionCount = basicQuestionCatalog.length;
  const basicSubjects = useMemo(() => BASIC_SUBJECT_IDS.map((id) => ({
    id,
    label: BASIC_SUBJECT_LABELS[id],
    questionIds: basicQuestionCatalog.filter((entry) => entry.subject === id).map((entry) => entry.question.id),
  })), [basicQuestionCatalog]);
  const basicQuestionTitles = useMemo(() => new Map(basicQuestionCatalog.map((entry) => [entry.question.id, entry.question.title])), [basicQuestionCatalog]);

  const isAdmin = PARENT_ACCOUNT_HASHES.includes(accountHash);
  const isAllowed = isAdmin || accountHash === LEARNER_ACCOUNT_HASH;

  useEffect(() => {
    const saved = readLocal<{
      bgmEnabled?: boolean;
      effectsEnabled?: boolean;
      bgmStyle?: BgmStyle;
      bgmVolume?: AudioVolume;
      effectVolume?: AudioVolume;
    }>(AUDIO_SETTINGS_KEY, {});
    const savedBgmVolume = saved.bgmVolume && ["low", "medium", "high"].includes(saved.bgmVolume) ? saved.bgmVolume : "medium";
    const savedEffectVolume = saved.effectVolume && ["low", "medium", "high"].includes(saved.effectVolume) ? saved.effectVolume : "medium";
    setBgmEnabled(saved.bgmEnabled ?? true);
    setEffectsEnabled(saved.effectsEnabled ?? true);
    setBgmStyle(saved.bgmStyle && ["focus", "playful", "challenge"].includes(saved.bgmStyle) ? saved.bgmStyle : "focus");
    setBgmVolume(savedBgmVolume);
    setEffectVolume(savedEffectVolume);
    effectsEnabledRef.current = saved.effectsEnabled ?? true;
    audioEngine.current = new StudyAudioEngine();
    audioEngine.current.setBgmVolume(savedBgmVolume);
    audioEngine.current.setEffectVolume(savedEffectVolume);
    setAudioSettingsReady(true);
    return () => audioEngine.current?.dispose();
  }, []);

  useEffect(() => {
    if (!audioSettingsReady) return;
    effectsEnabledRef.current = effectsEnabled;
    localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ bgmEnabled, effectsEnabled, bgmStyle, bgmVolume, effectVolume }));
  }, [audioSettingsReady, bgmEnabled, bgmStyle, bgmVolume, effectVolume, effectsEnabled]);

  useEffect(() => {
    if (!isAnyExerciseActive || !bgmEnabled) {
      audioEngine.current?.stopBgm();
      return;
    }
    void audioEngine.current?.startBgm(bgmStyle);
  }, [bgmEnabled, bgmStyle, isAnyExerciseActive]);

  useEffect(() => {
    if (!user || !isAllowed) return;
    setHeroMessage(HERO_MESSAGES[Math.floor(Math.random() * HERO_MESSAGES.length)]);
  }, [isAllowed, user]);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      setAuthError("");
      if (!nextUser?.email) {
        setAccountHash("");
        return;
      }
      hashEmail(nextUser.email).then(setAccountHash);
    });
  }, []);

  useEffect(() => {
    if (!user || !isAllowed) return;
    const localResetWindows = mergeResetWindows(readLocal<ResetWindow[]>(RESET_WINDOWS_KEY, []));
    const localAttempts = readLocal<unknown[]>(ATTEMPTS_KEY, [])
      .map(normalizeStoredAttempt)
      .filter((attempt): attempt is Attempt => attempt !== null)
      .filter((attempt) => !isResetAttempt(attempt, localResetWindows));
    const localQuestions = readLocal<unknown[]>(QUESTIONS_KEY, [])
      .map(normalizeStoredQuestion)
      .filter((question): question is Question => question !== null);
    const localGameProgress = normalizeGameProgress(readLocal<unknown>(GAME_PROGRESS_KEY, EMPTY_GAME_PROGRESS));
    const localQuestionProgress = normalizeQuestionProgressMap(readLocal<unknown>(QUESTION_PROGRESS_KEY, {}));
    const localGachaSettings = readLocal<{ enabled?: boolean }>(GACHA_SETTINGS_KEY, { enabled: true });
    setAttempts(localAttempts);
    setQuestionProgress(localQuestionProgress);
    setCustomQuestions(localQuestions);
    setResetWindows(localResetWindows);
    setGameProgress(localGameProgress);
    setGachaEnabled(localGachaSettings.enabled ?? true);
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(localAttempts));

    Promise.all([
      getDocs(query(collection(db!, "learners", LEARNER_RECORD_ID, "attempts"), orderBy("createdAt", "desc"), limit(500))),
      getDocs(collection(db!, "questionBank")),
      getDoc(doc(db!, "historyControls", LEARNER_RECORD_ID)).catch(() => null),
      getDoc(doc(db!, "learners", LEARNER_RECORD_ID, "gameProgress", "summary")).catch(() => null),
      getDoc(doc(db!, "gameSettings", LEARNER_RECORD_ID)).catch(() => null),
      getDoc(doc(db!, "learners", LEARNER_RECORD_ID, "questionProgress", "summary")).catch(() => null),
    ])
      .then(async ([attemptSnapshot, questionSnapshot, historyControlSnapshot, gameProgressSnapshot, gameSettingsSnapshot, progressSnapshot]) => {
        let remoteAttempts = attemptSnapshot.docs
          .map((item) => normalizeStoredAttempt(item.data()))
          .filter((attempt): attempt is Attempt => attempt !== null);
        const remoteQuestions = questionSnapshot.docs
          .map((item) => normalizeStoredQuestion({ ...item.data(), id: item.id }))
          .filter((question): question is Question => question !== null);
        const remoteResetWindows = mergeResetWindows((historyControlSnapshot?.data()?.resetWindows ?? []) as ResetWindow[]);
        const effectiveResetWindows = mergeResetWindows([...localResetWindows, ...remoteResetWindows]);
        const remoteQuestionProgress = normalizeQuestionProgressMap(progressSnapshot?.data()?.items);
        let effectiveQuestionProgress = mergeQuestionProgress(localQuestionProgress, remoteQuestionProgress);
        if (!Object.keys(remoteQuestionProgress).length) {
          const allAttemptSnapshot = await getDocs(collection(db!, "learners", LEARNER_RECORD_ID, "attempts"));
          remoteAttempts = allAttemptSnapshot.docs
            .map((item) => normalizeStoredAttempt(item.data()))
            .filter((attempt): attempt is Attempt => attempt !== null);
          const migrationAttempts = mergeAttempts(localAttempts, remoteAttempts).filter((attempt) => !isResetAttempt(attempt, effectiveResetWindows));
          effectiveQuestionProgress = buildQuestionProgress(migrationAttempts);
          await setDoc(doc(db!, "learners", LEARNER_RECORD_ID, "questionProgress", "summary"), {
            items: effectiveQuestionProgress,
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
          });
        }
        const mergedAttempts = mergeAttempts(localAttempts, remoteAttempts).filter((attempt) => !isResetAttempt(attempt, effectiveResetWindows));
        const mergedQuestions = [...new Map([...localQuestions, ...remoteQuestions].map((q) => [q.id, q])).values()];
        const mergedGameProgress = mergeGameProgress(localGameProgress, normalizeGameProgress(gameProgressSnapshot?.data()));
        const remoteGachaEnabled = gameSettingsSnapshot?.data()?.gachaEnabled;
        const effectiveGachaEnabled = typeof remoteGachaEnabled === "boolean" ? remoteGachaEnabled : (localGachaSettings.enabled ?? true);
        setAttempts(mergedAttempts);
        setQuestionProgress(effectiveQuestionProgress);
        setCustomQuestions(mergedQuestions);
        setResetWindows(effectiveResetWindows);
        setGameProgress(mergedGameProgress);
        setGachaEnabled(effectiveGachaEnabled);
        localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(mergedAttempts));
        localStorage.setItem(QUESTION_PROGRESS_KEY, JSON.stringify(effectiveQuestionProgress));
        localStorage.setItem(QUESTIONS_KEY, JSON.stringify(mergedQuestions));
        localStorage.setItem(RESET_WINDOWS_KEY, JSON.stringify(effectiveResetWindows));
        localStorage.setItem(GAME_PROGRESS_KEY, JSON.stringify(mergedGameProgress));
        localStorage.setItem(GACHA_SETTINGS_KEY, JSON.stringify({ enabled: effectiveGachaEnabled }));
        setSyncState("synced");
      })
      .catch(() => setSyncState("local"));
  }, [isAllowed, user]);

  useEffect(() => {
    if (!activeQuestion || selectedIndex !== null || sessionFinished) return;

    const startedAt = Date.now();
    const deadline = startedAt + activeTimeLimit * 1000;
    questionStartedAt.current = startedAt;
    setSecondsRemaining(activeTimeLimit);

    const timerId = window.setInterval(() => {
      const nextValue = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsRemaining(nextValue);
      if (nextValue === 0) {
        window.clearInterval(timerId);
        void answerQuestion(-1, true);
      }
    }, 200);

    return () => window.clearInterval(timerId);
  }, [activeQuestion?.id, activeTimeLimit, questionIndex, selectedIndex, sessionFinished]);

  async function login() {
    setAuthError("");
    try {
      await signInWithPopup(auth!, googleProvider);
    } catch {
      setAuthError("Googleログインを完了できませんでした。もう一度お試しください。");
    }
  }

  const stats = useMemo(() => {
    const allAttempts = [...attempts, ...basicAttempts];
    const correct = allAttempts.filter((a) => a.isCorrect).length;
    const accuracy = allAttempts.length ? Math.round((correct / allAttempts.length) * 100) : 0;
    return { correct, accuracy };
  }, [attempts, basicAttempts]);

  const attemptsByQuestion = useMemo(() => {
    const rows = new Map<string, Attempt[]>();
    attempts.forEach((attempt) => rows.set(attempt.questionId, [...(rows.get(attempt.questionId) ?? []), attempt]));
    return rows;
  }, [attempts]);

  const basicAttemptsByQuestion = useMemo(() => {
    const rows = new Map<string, BasicAttempt[]>();
    basicAttempts.forEach((attempt) => rows.set(attempt.questionId, [...(rows.get(attempt.questionId) ?? []), attempt]));
    return rows;
  }, [basicAttempts]);

  const basicQuestionStates = useMemo(() => new Map(
    basicQuestionCatalog.map((entry) => [entry.question.id, getMasteryState(basicAttemptsByQuestion.get(entry.question.id) ?? [])]),
  ), [basicAttemptsByQuestion, basicQuestionCatalog]);

  const questionStates = useMemo(() => new Map(questions.map((question) => [
    question.id,
    questionProgress[question.id]
      ? getProgressMasteryState(questionProgress[question.id])
      : getMasteryState(attemptsByQuestion.get(question.id) ?? []),
  ])), [attemptsByQuestion, questionProgress, questions]);

  const domainStats = useMemo(() => DOMAINS.map((domain) => {
    const domainQuestions = questions.filter((question) => question.domain === domain);
    const progressRows = Object.values(questionProgress).filter((progress) => progress.domain === domain);
    const states = domainQuestions.map((question) => questionStates.get(question.id) ?? "unattempted");
    const attempted = states.filter((state) => state !== "unattempted").length;
    const practicing = states.filter((state) => state === "practicing").length;
    const done = states.filter((state) => state === "done").length;
    const mastered = states.filter((state) => state === "mastered").length;
    const totalAttempts = progressRows.reduce((sum, progress) => sum + progress.attemptCount, 0);
    const correct = progressRows.reduce((sum, progress) => sum + progress.correctCount, 0);
    const accuracy = totalAttempts ? Math.round((correct / totalAttempts) * 100) : 0;
    const masteryScore = domainQuestions.length
      ? Math.round(((practicing * 0.2 + done * 0.65 + mastered) / domainQuestions.length) * 100)
      : 100;
    return {
      domain,
      registered: domainQuestions.length,
      attempted,
      practicing,
      done,
      mastered,
      attempts: totalAttempts,
      correct,
      accuracy,
      masteryScore,
    };
  }), [questionProgress, questionStates, questions]);

  const basicSubjectStats = useMemo(() => basicSubjects.map((subject) => {
    const rows = basicAttempts.filter((attempt) => attempt.subject === subject.id);
    const states = subject.questionIds.map((questionId) => basicQuestionStates.get(questionId) ?? "unattempted");
    const attempted = states.filter((state) => state !== "unattempted").length;
    const practicing = states.filter((state) => state === "practicing").length;
    const done = states.filter((state) => state === "done").length;
    const mastered = states.filter((state) => state === "mastered").length;
    const correct = rows.filter((attempt) => attempt.isCorrect).length;
    const masteryScore = subject.questionIds.length
      ? Math.round(((practicing * 0.2 + done * 0.65 + mastered) / subject.questionIds.length) * 100)
      : 100;
    return {
      subject: subject.id,
      label: subject.label,
      registered: subject.questionIds.length,
      attempted,
      practicing,
      done,
      mastered,
      attempts: rows.length,
      correct,
      accuracy: rows.length ? Math.round(correct / rows.length * 100) : 0,
      masteryScore,
    };
  }), [basicAttempts, basicQuestionStates, basicSubjects]);

  const overallWeakest = useMemo(() => [
    ...domainStats.map((row) => ({ label: row.domain, attempts: row.attempts, accuracy: row.accuracy, masteryScore: row.masteryScore, attempted: row.attempted })),
    ...basicSubjectStats.map((row) => ({ label: row.label, attempts: row.attempts, accuracy: row.accuracy, masteryScore: row.masteryScore, attempted: row.attempted })),
  ].sort((a, b) => a.masteryScore - b.masteryScore || a.attempted - b.attempted)[0], [basicSubjectStats, domainStats]);

  const todayStats = useMemo(() => {
    const todayStart = localDay().toISOString();
    const todayAttempts = attempts.filter((attempt) => attempt.createdAt >= todayStart);
    const todayBasicAttempts = basicAttempts.filter((attempt) => attempt.createdAt >= todayStart);
    const todayAllAttempts = [...todayAttempts, ...todayBasicAttempts];
    const correct = todayAllAttempts.filter((attempt) => attempt.isCorrect).length;
    const beforeToday = attempts.filter((attempt) => attempt.createdAt < todayStart);
    const beforeTodayBasic = basicAttempts.filter((attempt) => attempt.createdAt < todayStart);
    const beforeByQuestion = new Map<string, Attempt[]>();
    const beforeBasicByQuestion = new Map<string, BasicAttempt[]>();
    beforeToday.forEach((attempt) => beforeByQuestion.set(attempt.questionId, [...(beforeByQuestion.get(attempt.questionId) ?? []), attempt]));
    beforeTodayBasic.forEach((attempt) => beforeBasicByQuestion.set(attempt.questionId, [...(beforeBasicByQuestion.get(attempt.questionId) ?? []), attempt]));
    let newlyDone = 0;
    let newlyMastered = 0;
    questions.forEach((question) => {
      const before = getMasteryState(beforeByQuestion.get(question.id) ?? []);
      const current = questionStates.get(question.id) ?? "unattempted";
      if (current === "done" && before !== "done" && before !== "mastered") newlyDone += 1;
      if (current === "mastered" && before !== "mastered") newlyMastered += 1;
    });
    basicQuestionCatalog.forEach((entry) => {
      const before = getMasteryState(beforeBasicByQuestion.get(entry.question.id) ?? []);
      const current = basicQuestionStates.get(entry.question.id) ?? "unattempted";
      if (current === "done" && before !== "done" && before !== "mastered") newlyDone += 1;
      if (current === "mastered" && before !== "mastered") newlyMastered += 1;
    });
    return {
      attempts: todayAllAttempts.length,
      correct,
      bestStreak: getBestCorrectStreak(todayAllAttempts),
      newlyDone,
      newlyMastered,
    };
  }, [attempts, basicAttempts, basicQuestionCatalog, basicQuestionStates, questionStates, questions]);

  const resetRange = useMemo(() => {
    const today = localDay();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    let start = new Date(today);
    let end = tomorrow;
    let label = "過去7日";

    if (resetPreset === "today") {
      label = "今日";
    } else if (resetPreset === "7days") {
      start.setDate(start.getDate() - 6);
    } else if (resetPreset === "30days") {
      start.setDate(start.getDate() - 29);
      label = "過去30日";
    } else if (resetPreset === "all") {
      start = new Date(0);
      end = new Date();
      label = "すべての期間";
    } else {
      const customStart = parseLocalDate(resetStart);
      const customEnd = parseLocalDate(resetEnd);
      if (!customStart || !customEnd || customStart > customEnd) return null;
      start = customStart;
      end = new Date(customEnd);
      end.setDate(end.getDate() + 1);
      label = `${resetStart}〜${resetEnd}`;
    }

    return { start: start.toISOString(), end: end.toISOString(), label };
  }, [resetEnd, resetPreset, resetStart]);

  const resetTargetCount = useMemo(() => resetRange
    ? attempts.filter((attempt) => attempt.createdAt >= resetRange.start && attempt.createdAt < resetRange.end).length
      + basicAttempts.filter((attempt) => attempt.createdAt >= resetRange.start && attempt.createdAt < resetRange.end).length
    : 0, [attempts, basicAttempts, resetRange]);

  const importTotals = useMemo(() => {
    const validFiles = importFiles.filter((file): file is AptitudeImportPreview | BasicImportPreview => file.kind !== "invalid");
    const totalQuestions = validFiles.reduce((sum, file) => sum + file.questions.length, 0);
    const totalDuplicates = validFiles.reduce((sum, file) => sum + file.duplicates.length, 0);
    const totalErrors = importFiles.reduce((sum, file) => sum + file.errors.length, 0);
    return { totalQuestions, totalDuplicates, totalErrors, totalNew: totalQuestions - totalDuplicates };
  }, [importFiles]);
  const domainQuestionCounts = useMemo(() => new Map(DOMAINS.map((domain) => [domain, questions.filter((question) => question.domain === domain).length])), [questions]);

  function beginSession(picked: Question[]) {
    if (!picked.length) return;
    void audioEngine.current?.resume();
    setSession(picked);
    setQuestionIndex(0);
    setSelectedIndex(null);
    setSessionAnswers([]);
    setSessionFinished(false);
    setSessionPoints(0);
    setSessionXp(0);
    setSessionCoins(0);
    setCombo(0);
    setSessionBestCombo(0);
    setAnswerAward(null);
    setSessionNewBest(false);
    setSecondsRemaining(getTimeLimit(picked[0]));
    questionStartedAt.current = Date.now();
    setTimeout(() => document.getElementById("practice")?.scrollIntoView({ behavior: "smooth" }), 20);
  }

  function startSession(mode: SessionMode) {
    let picked: Question[];
    if (mode === "weak") {
      const rankedDomains = [...domainStats]
        .filter((row) => row.registered > 0)
        .sort((a, b) => a.masteryScore - b.masteryScore || a.attempted - b.attempted)
        .map((row) => row.domain);
      picked = MASTERY_ORDER.flatMap((state) => rankedDomains.flatMap((domain) => shuffle(questions.filter((question) => (
        question.domain === domain && (questionStates.get(question.id) ?? "unattempted") === state
      ))))).slice(0, 5);
    } else {
      const oneEach = DOMAINS.flatMap((domain) => shuffle(questions.filter((q) => q.domain === domain)).slice(0, 1));
      const rest = shuffle(questions.filter((q) => !oneEach.some((pickedQuestion) => pickedQuestion.id === q.id)));
      picked = shuffle([...oneEach, ...rest.slice(0, Math.max(0, 10 - oneEach.length))]).slice(0, 10);
    }
    beginSession(picked);
  }

  function startDomainSession(domain: Domain) {
    const domainQuestions = questions.filter((question) => question.domain === domain);
    const picked = MASTERY_ORDER.flatMap((state) => shuffle(domainQuestions.filter((question) => (
      (questionStates.get(question.id) ?? "unattempted") === state
    )))).slice(0, 5);
    beginSession(picked);
  }

  function openDomainPicker() {
    document.getElementById("domain-picker")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function requestBasicSession(mode: BasicStartRequest["mode"], subject?: BasicSubject) {
    setBasicStartRequest({ id: crypto.randomUUID(), mode, subject });
    setTimeout(() => document.getElementById("basic-training")?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
  }

  function openBasicSubjectPicker() {
    document.getElementById("basic-subject-picker")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function answerQuestion(index: number, timedOut = false) {
    if (!activeQuestion || selectedIndex !== null) return;
    setSelectedIndex(index);
    if (window.matchMedia("(max-width: 900px) and (orientation: landscape)").matches) {
      setTimeout(() => document.querySelector(".feedback")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    }
    const isCorrect = index === activeQuestion.correctIndex;
    const durationSeconds = timedOut ? activeTimeLimit : Math.min(activeTimeLimit, Math.max(1, Math.round((Date.now() - questionStartedAt.current) / 1000)));
    const nextCombo = isCorrect ? combo + 1 : 0;
    const timeBonus = isCorrect ? Math.max(0, Math.round((1 - durationSeconds / activeTimeLimit) * 30)) : 0;
    const comboBonus = isCorrect ? Math.min(Math.max(0, nextCombo - 1) * 10, 50) : 0;
    const points = isCorrect ? 100 + timeBonus + comboBonus : 0;
    const earnedXp = isCorrect ? 20 + Math.round(timeBonus / 3) + Math.min(Math.max(0, nextCombo - 1), 5) * 2 : timedOut ? 2 : 5;
    const earnedCoins = 1 + (isCorrect ? 2 : 0) + (isCorrect && nextCombo >= 3 ? 1 : 0);
    setCombo(nextCombo);
    setSessionBestCombo((current) => Math.max(current, nextCombo));
    setSessionPoints((current) => current + points);
    setSessionXp((current) => current + earnedXp);
    setSessionCoins((current) => current + earnedCoins);
    setAnswerAward({
      points,
      xp: earnedXp,
      coins: earnedCoins,
      label: timedOut ? "TIME UP" : isCorrect ? (nextCombo >= 3 ? `${nextCombo} COMBO!` : "NICE!") : "TRY AGAIN",
    });
    if (effectsEnabledRef.current) {
      void audioEngine.current?.playEffect(timedOut ? "timeout" : isCorrect ? (nextCombo >= 3 ? "combo" : "correct") : "wrong");
    }
    const attempt: Attempt = {
      clientAttemptId: crypto.randomUUID(),
      questionId: activeQuestion.id,
      domain: activeQuestion.domain,
      isCorrect,
      selectedIndex: index,
      durationSeconds,
      timedOut,
      createdAt: new Date().toISOString(),
    };
    const nextAttempts = mergeAttempts([attempt], attempts);
    const previousQuestionProgress = questionProgress[activeQuestion.id];
    const nextQuestionProgressRow: QuestionProgress = {
      questionId: activeQuestion.id,
      domain: activeQuestion.domain,
      attemptCount: (previousQuestionProgress?.attemptCount ?? 0) + 1,
      correctCount: (previousQuestionProgress?.correctCount ?? 0) + (isCorrect ? 1 : 0),
      latestResults: [isCorrect, ...(previousQuestionProgress?.latestResults ?? [])].slice(0, 2),
      updatedAt: attempt.createdAt,
    };
    const nextQuestionProgress = { ...questionProgress, [activeQuestion.id]: nextQuestionProgressRow };
    const nextCoinProgress: GameProgress = {
      ...gameProgress,
      coins: gameProgress.coins + earnedCoins,
      updatedAt: new Date().toISOString(),
    };
    setAttempts(nextAttempts);
    setQuestionProgress(nextQuestionProgress);
    setGameProgress(nextCoinProgress);
    setSessionAnswers((current) => [...current, isCorrect]);
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(nextAttempts));
    localStorage.setItem(QUESTION_PROGRESS_KEY, JSON.stringify(nextQuestionProgress));
    localStorage.setItem(GAME_PROGRESS_KEY, JSON.stringify(nextCoinProgress));

    try {
      await Promise.all([
        setDoc(doc(db!, "learners", LEARNER_RECORD_ID, "attempts", attempt.clientAttemptId), attempt),
        setDoc(doc(db!, "learners", LEARNER_RECORD_ID, "gameProgress", "summary"), nextCoinProgress, { merge: true }),
        setDoc(doc(db!, "learners", LEARNER_RECORD_ID, "questionProgress", "summary"), {
          items: nextQuestionProgress,
          schemaVersion: 1,
          updatedAt: attempt.createdAt,
        }),
      ]);
      setSyncState("synced");
    } catch {
      setSyncState("local");
    }
  }

  function goNext() {
    if (questionIndex >= session.length - 1) {
      audioEngine.current?.stopBgm();
      if (effectsEnabledRef.current) void audioEngine.current?.playEffect("finish");
      const correct = sessionAnswers.filter(Boolean).length;
      const accuracy = session.length ? Math.round((correct / session.length) * 100) : 0;
      const rank = getSessionRank(correct, session.length);
      const completionCoins = getCompletionCoinBonus(rank);
      const totalSessionCoins = sessionCoins + completionCoins;
      const nextProgress: GameProgress = {
        totalXp: gameProgress.totalXp + sessionXp,
        bestScore: Math.max(gameProgress.bestScore, sessionPoints),
        bestAccuracy: Math.max(gameProgress.bestAccuracy, accuracy),
        bestCombo: Math.max(gameProgress.bestCombo, sessionBestCombo),
        coins: gameProgress.coins + completionCoins,
        inventory: gameProgress.inventory,
        collectionCounts: gameProgress.collectionCounts,
        gachaDraws: gameProgress.gachaDraws,
        gachaDrawsByType: gameProgress.gachaDrawsByType,
        updatedAt: new Date().toISOString(),
      };
      setSessionCoins(totalSessionCoins);
      setSessionNewBest(sessionPoints > gameProgress.bestScore);
      setGameProgress(nextProgress);
      localStorage.setItem(GAME_PROGRESS_KEY, JSON.stringify(nextProgress));
      void setDoc(doc(db!, "learners", LEARNER_RECORD_ID, "gameProgress", "summary"), nextProgress, { merge: true })
        .then(() => setSyncState("synced"))
        .catch(() => setSyncState("local"));
      setSessionFinished(true);
      return;
    }
    if (effectsEnabledRef.current) void audioEngine.current?.playEffect("next");
    setQuestionIndex((value) => value + 1);
    setSelectedIndex(null);
    setAnswerAward(null);
    setSecondsRemaining(getTimeLimit(session[questionIndex + 1]));
    questionStartedAt.current = Date.now();
  }

  function stopSession() {
    audioEngine.current?.stopBgm();
    setSession([]);
    setQuestionIndex(0);
    setSelectedIndex(null);
    setSecondsRemaining(20);
    setSessionAnswers([]);
    setSessionFinished(false);
    setSessionPoints(0);
    setSessionXp(0);
    setSessionCoins(0);
    setCombo(0);
    setSessionBestCombo(0);
    setAnswerAward(null);
    setSessionNewBest(false);
    setTimeout(() => document.getElementById("top")?.scrollIntoView({ behavior: "smooth" }), 20);
  }

  async function parseImportFile(file: File): Promise<ImportPreview> {
    if (file.size > 5 * 1024 * 1024) {
      return { kind: "invalid", fileName: file.name, setTitle: file.name, errors: ["ファイルが大きすぎます。5MB以下にしてください"] };
    }

    try {
      const parsed: unknown = JSON.parse(await file.text());
      const rootErrors: string[] = [];
      let setTitle = file.name;

      const detectedSubject = isRecord(parsed)
        ? BASIC_SUBJECT_IDS.find((subject) => BASIC_SUBJECT_CONFIG[subject].collectionType === parsed.type)
        : undefined;
      if (isRecord(parsed) && Array.isArray(parsed.sets) && detectedSubject) {
        if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) rootErrors.push("schemaVersionは1にしてください");
        const subject: BasicSubject = detectedSubject;
        const expectedSetType = BASIC_SUBJECT_CONFIG[subject].setType;
        if (typeof parsed.collectionTitle === "string" && parsed.collectionTitle.trim()) setTitle = parsed.collectionTitle.trim();
        const validated: Array<ReturnType<typeof validateImportedBasicQuestion>> = [];
        parsed.sets.forEach((rawSet, setIndex) => {
          if (!isRecord(rawSet)) {
            rootErrors.push(`${setIndex + 1}番目のsetがオブジェクトではありません`);
            return;
          }
          const setId = typeof rawSet.setId === "string" ? rawSet.setId.trim() : "";
          if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(setId)) rootErrors.push(`${setIndex + 1}番目のsetIdが正しくありません`);
          if (rawSet.schemaVersion !== 1) rootErrors.push(`${setId || `${setIndex + 1}番目のset`}: schemaVersionは1にしてください`);
          if (rawSet.type !== expectedSetType) rootErrors.push(`${setId || `${setIndex + 1}番目のset`}: typeは${expectedSetType}にしてください`);
          if (!Array.isArray(rawSet.questions)) {
            rootErrors.push(`${setId || `${setIndex + 1}番目のset`}: questions配列がありません`);
            return;
          }
          rawSet.questions.forEach((question) => validated.push(validateImportedBasicQuestion(question, validated.length, subject, setId)));
        });
        const importedQuestions = validated.flatMap((result) => result.question ? [result.question] : []);
        const errors = [...rootErrors, ...validated.flatMap((result) => result.errors)];
        if (!importedQuestions.length) errors.push("登録できる問題がありません");
        const seenIds = new Set<string>();
        importedQuestions.forEach((entry) => {
          if (seenIds.has(entry.question.id)) errors.push(`ファイル内でid「${entry.question.id}」が重複しています`);
          seenIds.add(entry.question.id);
        });
        const existingIds = new Set(basicQuestionCatalog.map((entry) => entry.question.id));
        const duplicates = importedQuestions.filter((entry) => existingIds.has(entry.question.id)).map((entry) => entry.question.id);
        return { kind: "basic", fileName: file.name, setTitle, subject, questions: importedQuestions, errors, duplicates };
      }

      let rawQuestions: unknown[] = [];

      if (Array.isArray(parsed)) {
        rawQuestions = parsed;
      } else if (isRecord(parsed)) {
        if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) rootErrors.push("schemaVersionは1にしてください");
        if (typeof parsed.setTitle === "string" && parsed.setTitle.trim()) setTitle = parsed.setTitle.trim();
        if (Array.isArray(parsed.questions)) rawQuestions = parsed.questions;
        else rootErrors.push("questions配列がありません");
      } else {
        rootErrors.push("JSONの最上位はオブジェクトまたは配列にしてください");
      }

      if (!rawQuestions.length) rootErrors.push("登録できる問題がありません");
      const validated = rawQuestions.map(validateImportedQuestion);
      const importedQuestions = validated.flatMap((result) => result.question ? [result.question] : []);
      const errors = [...rootErrors, ...validated.flatMap((result) => result.errors)];
      const seenIds = new Set<string>();
      importedQuestions.forEach((question) => {
        if (seenIds.has(question.id)) errors.push(`ファイル内でid「${question.id}」が重複しています`);
        seenIds.add(question.id);
      });
      const existingIds = new Set(customQuestions.map((question) => question.id));
      const duplicates = importedQuestions.filter((question) => existingIds.has(question.id)).map((question) => question.id);
      return { kind: "aptitude", fileName: file.name, setTitle, questions: importedQuestions, errors, duplicates };
    } catch {
      return { kind: "invalid", fileName: file.name, setTitle: file.name, errors: ["JSONを読み込めませんでした。ファイル形式を確認してください"] };
    }
  }

  async function readImportFiles(files: File[]) {
    if (!files.length) return;
    setImportStatus("");
    setImportFiles([]);
    const results = await Promise.all(files.map(parseImportFile));
    setImportFiles(annotateCrossFileDuplicates(results));
    setImportMode("skip");
  }

  function removeImportFile(index: number) {
    setImportFiles((files) => files.filter((_, fileIndex) => fileIndex !== index));
  }

  async function importQuestions() {
    const validFiles = importFiles.filter((file): file is AptitudeImportPreview | BasicImportPreview => file.kind !== "invalid");
    if (!isAdmin || !db || !validFiles.length || importFiles.some((file) => file.errors.length)) return;
    const firestore = db;
    const duplicateIds = new Set(validFiles.flatMap((file) => file.duplicates));
    const aptitudeTargets = validFiles
      .filter((file): file is AptitudeImportPreview => file.kind === "aptitude")
      .flatMap((file) => importMode === "skip" ? file.questions.filter((item) => !duplicateIds.has(item.id)) : file.questions);
    const basicTargets = validFiles
      .filter((file): file is BasicImportPreview => file.kind === "basic")
      .flatMap((file) => importMode === "skip" ? file.questions.filter((item) => !duplicateIds.has(item.question.id)) : file.questions);
    if (!aptitudeTargets.length && !basicTargets.length) {
      setImportStatus("追加対象の新しい問題がありません");
      return;
    }

    setIsImporting(true);
    setImportStatus("");
    try {
      if (aptitudeTargets.length) {
        for (let offset = 0; offset < aptitudeTargets.length; offset += 450) {
          const batch = writeBatch(firestore);
          aptitudeTargets.slice(offset, offset + 450).forEach((question) => batch.set(doc(firestore, "questionBank", question.id), question));
          await batch.commit();
        }
        const nextMap = new Map(customQuestions.map((question) => [question.id, question]));
        aptitudeTargets.forEach((question) => nextMap.set(question.id, question));
        const nextQuestions = [...nextMap.values()];
        setCustomQuestions(nextQuestions);
        localStorage.setItem(QUESTIONS_KEY, JSON.stringify(nextQuestions));
      }
      if (basicTargets.length) {
        for (let offset = 0; offset < basicTargets.length; offset += 450) {
          const batch = writeBatch(firestore);
          basicTargets.slice(offset, offset + 450).forEach((entry) => batch.set(doc(firestore, "basicQuestionBank", entry.question.id), {
            ...entry.question,
            subject: entry.subject,
            setId: entry.setId,
          }));
          await batch.commit();
        }
        const nextMap = new Map(basicQuestionCatalog.map((entry) => [entry.question.id, entry]));
        basicTargets.forEach((entry) => nextMap.set(entry.question.id, entry));
        setBasicQuestionCatalog([...nextMap.values()]);
        setBasicQuestionRefreshToken((value) => value + 1);
      }
      setImportFiles([]);
      const total = aptitudeTargets.length + basicTargets.length;
      setImportStatus(aptitudeTargets.length && basicTargets.length
        ? `${total}問を追加しました（適性検査${aptitudeTargets.length}問・基礎トレ${basicTargets.length}問）`
        : `${basicTargets.length ? "基礎トレ" : "適性検査"}に${total}問を追加しました`);
      setSyncState("synced");
    } catch {
      setImportStatus("一括追加に失敗しました。通信状態を確認して、もう一度お試しください");
      setSyncState("local");
    } finally {
      setIsImporting(false);
    }
  }

  function downloadImportTemplate() {
    const template = {
      schemaVersion: 1,
      setId: "aichi-practice-001",
      setTitle: "練習問題セット1",
      questions: [{
        id: "aichi-practice-001-q001",
        domain: "文章・ことば",
        title: "話し合いの順序",
        context: "【ア】最初の発言です。\n【イ】次の発言です。",
        prompt: "最も適切なものを選びましょう。",
        options: ["選択肢A", "選択肢B", "選択肢C", "選択肢D"],
        correctIndex: 0,
        timeLimitSeconds: 20,
        explanation: "正解の理由を説明します。",
        skill: "会話文の整理",
        source: "custom",
      }],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "question-import-template.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadBasicImportTemplate(subject: BasicSubject) {
    const isKanji = subject === "kanji";
    const config = BASIC_SUBJECT_CONFIG[subject];
    const slug = config.setType;
    const template = isKanji ? {
      schemaVersion: 1,
      collectionId: `${slug}-basic-001-005`,
      collectionTitle: `${config.label} 基礎トレ 1〜5`,
      type: config.collectionType,
      sets: [{
        schemaVersion: 1,
        setId: `${slug}-basic-001`,
        setTitle: `${config.label} 基礎トレ1`,
        type: config.setType,
        questions: [{
          id: `${slug}-basic-001-q001`, title: "熟語", sentence: "文中の【ことば】を漢字で書きましょう。", reading: "ことば", answer: "言葉",
          acceptedAnswers: [], explanation: "正答の理由や注意点を書きます。", targetKanji: ["言", "葉"], targetWord: "言葉", grade: 4,
          category: "熟語", tags: ["熟語"], difficulty: 1, timeLimitSeconds: 20, knowledgeKey: "ことば-言葉", source: "custom", references: [],
        }],
      }],
    } : {
      schemaVersion: 1,
      collectionId: `${slug}-basic-001-005`,
      collectionTitle: `${config.label} 基礎トレ 1〜5`,
      type: config.collectionType,
      sets: [{
        schemaVersion: 1,
        setId: `${slug}-basic-001`,
        setTitle: `${config.label} 基礎トレ1`,
        type: config.setType,
        questions: [{
          id: `${slug}-basic-001-q001`, title: `${config.label}の例題`, context: "資料や前提を書きます。", prompt: "正しいものを選びましょう。",
          options: ["選択肢A", "選択肢B", "選択肢C", "選択肢D"], correctIndex: 0, explanation: "正答の理由を説明します。",
          topic: slug, subtopic: config.label, questionType: "knowledge", region: [], difficulty: 1, timeLimitSeconds: 20,
          materials: [], statisticsYear: null, source: "custom", references: [], knowledgeKey: `${slug}-例題`,
        }],
      }],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slug}-basic-import-template.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadQuestionBank() {
    if (syncState !== "synced" || !questions.length) return;
    const now = new Date();
    const dateParts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => dateParts.find((item) => item.type === type)?.value ?? "00";
    const date = `${part("year")}${part("month")}${part("day")}`;
    const time = `${part("hour")}${part("minute")}${part("second")}`;
    const exportedQuestions = [...questions].sort((a, b) => a.id.localeCompare(b.id, "ja"));
    const questionBank = {
      schemaVersion: 1,
      setId: `aichi-jh-training-export-${date}`,
      setTitle: `登録済み問題一覧（${exportedQuestions.length}問）`,
      questions: exportedQuestions,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(questionBank, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aichi-jh-training-questions-${date}-${time}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadBasicQuestionBank() {
    if (!basicQuestionCatalog.length) return;
    const now = new Date();
    const dateParts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => dateParts.find((item) => item.type === type)?.value ?? "00";
    const date = `${part("year")}${part("month")}${part("day")}`;
    const time = `${part("hour")}${part("minute")}${part("second")}`;
    const collections = BASIC_SUBJECT_IDS.flatMap((subject) => {
      const entries = basicQuestionCatalog.filter((entry) => entry.subject === subject);
      if (!entries.length) return [];
      const config = BASIC_SUBJECT_CONFIG[subject];
      const sets = [...new Set(entries.map((entry) => entry.setId))].sort((a, b) => a.localeCompare(b, "ja")).map((setId) => ({
        schemaVersion: 1,
        setId,
        setTitle: setId,
        type: config.setType,
        questions: entries.filter((entry) => entry.setId === setId).map((entry) => entry.question).sort((a, b) => a.id.localeCompare(b.id, "ja")),
      }));
      return [{
        schemaVersion: 1,
        collectionId: `${config.setType}-export-${date}`,
        collectionTitle: `${config.label} 登録済み問題一覧`,
        type: config.collectionType,
        sets,
      }];
    });
    const exportData = {
      schemaVersion: 1,
      type: "basic-training-export",
      exportedAt: now.toISOString(),
      totalQuestions: basicQuestionCatalog.length,
      collections,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aichi-jh-training-basic-questions-${date}-${time}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function resetHistory() {
    if (!isAdmin || !resetRange || !db) {
      setResetStatus("期間を正しく指定してください");
      return;
    }

    setIsResetting(true);
    setResetStatus("");
    const resetWindow: ResetWindow = { ...resetRange, createdAt: new Date().toISOString() };
    const nextResetWindows = mergeResetWindows([...resetWindows, resetWindow]);

    try {
      await setDoc(doc(db, "historyControls", LEARNER_RECORD_ID), {
        resetWindows: nextResetWindows,
        updatedAt: resetWindow.createdAt,
      });

      const nextAttempts = attempts.filter((attempt) => !isResetAttempt(attempt, nextResetWindows));
      setAttempts(nextAttempts);
      setResetWindows(nextResetWindows);
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(nextAttempts));
      localStorage.setItem(RESET_WINDOWS_KEY, JSON.stringify(nextResetWindows));

      const [targetSnapshot, basicTargetSnapshot] = await Promise.all([
        getDocs(query(
          collection(db, "learners", LEARNER_RECORD_ID, "attempts"),
          where("createdAt", ">=", resetRange.start),
          where("createdAt", "<", resetRange.end),
        )),
        getDocs(query(
          collection(db, "learners", LEARNER_RECORD_ID, "basicAttempts"),
          where("createdAt", ">=", resetRange.start),
          where("createdAt", "<", resetRange.end),
        )),
      ]);
      const documents = [...targetSnapshot.docs, ...basicTargetSnapshot.docs];
      for (let offset = 0; offset < documents.length; offset += 450) {
        const batch = writeBatch(db);
        documents.slice(offset, offset + 450).forEach((item) => batch.delete(item.ref));
        await batch.commit();
      }

      const remainingSnapshot = await getDocs(collection(db, "learners", LEARNER_RECORD_ID, "attempts"));
      const remainingAttempts = remainingSnapshot.docs
        .map((item) => normalizeStoredAttempt(item.data()))
        .filter((attempt): attempt is Attempt => attempt !== null)
        .filter((attempt) => !isResetAttempt(attempt, nextResetWindows));
      const rebuiltQuestionProgress = buildQuestionProgress(remainingAttempts);
      await setDoc(doc(db, "learners", LEARNER_RECORD_ID, "questionProgress", "summary"), {
        items: rebuiltQuestionProgress,
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
      });
      setAttempts(remainingAttempts);
      setQuestionProgress(rebuiltQuestionProgress);
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(remainingAttempts));
      localStorage.setItem(QUESTION_PROGRESS_KEY, JSON.stringify(rebuiltQuestionProgress));

      setResetStatus(`${resetRange.label}の履歴を${documents.length}件リセットしました`);
      setResetConfirm(false);
      setSyncState("synced");
    } catch {
      setResetStatus("履歴をリセットできませんでした。通信状態を確認してください");
      setSyncState("local");
    } finally {
      setIsResetting(false);
    }
  }

  const recent = useMemo(() => [
    ...attempts.map((attempt) => ({ ...attempt, trainingType: "aptitude" as const })),
    ...basicAttempts.map((attempt) => ({ ...attempt, trainingType: "basic" as const })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6), [attempts, basicAttempts]);
  const sessionScore = sessionAnswers.filter(Boolean).length;
  const sessionAccuracy = session.length ? Math.round((sessionScore / session.length) * 100) : 0;
  const sessionRank = getSessionRank(sessionScore, session.length);

  function updateBgmEnabled(enabled: boolean) {
    setBgmEnabled(enabled);
    if (enabled && isExerciseActive) {
      void audioEngine.current?.startBgm(bgmStyle);
    } else if (!enabled) {
      audioEngine.current?.stopBgm();
    }
  }

  function updateBgmStyle(style: BgmStyle) {
    setBgmStyle(style);
    if (bgmEnabled && isExerciseActive) void audioEngine.current?.startBgm(style);
  }

  function updateBgmVolume(volume: AudioVolume) {
    setBgmVolume(volume);
    audioEngine.current?.setBgmVolume(volume);
  }

  function updateEffectVolume(volume: AudioVolume) {
    setEffectVolume(volume);
    audioEngine.current?.setEffectVolume(volume);
    if (effectsEnabledRef.current) void audioEngine.current?.playEffect("next");
  }

  function playEffect(effect: SoundEffect) {
    if (effectsEnabledRef.current) void audioEngine.current?.playEffect(effect);
  }

  const handleBasicActivityChange = useCallback((active: boolean) => setBasicTrainingActive(active), []);
  const handleBasicSyncStateChange = useCallback((state: "synced" | "local") => setSyncState(state), []);
  const handleBasicAttemptsChange = useCallback((rows: BasicAttempt[]) => setBasicAttempts(rows), []);
  const handleBasicQuestionCatalogChange = useCallback((rows: BasicQuestionEntry[]) => setBasicQuestionCatalog(rows), []);

  const rewardBasicAnswer = useCallback(async (isCorrect: boolean, timedOut: boolean): Promise<BasicAward> => {
    const xp = isCorrect ? 20 : timedOut ? 2 : 5;
    const coins = isCorrect ? 3 : 1;
    const nextProgress: GameProgress = {
      ...gameProgress,
      totalXp: gameProgress.totalXp + xp,
      coins: gameProgress.coins + coins,
      updatedAt: new Date().toISOString(),
    };
    setGameProgress(nextProgress);
    localStorage.setItem(GAME_PROGRESS_KEY, JSON.stringify(nextProgress));
    try {
      await setDoc(doc(db!, "learners", LEARNER_RECORD_ID, "gameProgress", "summary"), nextProgress, { merge: true });
      setSyncState("synced");
    } catch {
      setSyncState("local");
    }
    return { xp, coins, label: timedOut ? "TIME UP" : isCorrect ? "NICE!" : "TRY AGAIN" };
  }, [gameProgress]);

  const rewardBasicCompletion = useCallback(async (correct: number, total: number) => {
    const rank = getSessionRank(correct, total);
    const bonus = getCompletionCoinBonus(rank);
    const nextProgress: GameProgress = {
      ...gameProgress,
      coins: gameProgress.coins + bonus,
      updatedAt: new Date().toISOString(),
    };
    setGameProgress(nextProgress);
    localStorage.setItem(GAME_PROGRESS_KEY, JSON.stringify(nextProgress));
    try {
      await setDoc(doc(db!, "learners", LEARNER_RECORD_ID, "gameProgress", "summary"), nextProgress, { merge: true });
      setSyncState("synced");
    } catch {
      setSyncState("local");
    }
    return bonus;
  }, [gameProgress]);

  async function updateGachaEnabled(enabled: boolean) {
    if (!isAdmin || !db) return;
    setGachaEnabled(enabled);
    setGachaStatus(enabled ? "ガチャを利用できるようにしました" : "ガチャを停止しました");
    localStorage.setItem(GACHA_SETTINGS_KEY, JSON.stringify({ enabled }));
    try {
      await setDoc(doc(db, "gameSettings", LEARNER_RECORD_ID), { gachaEnabled: enabled, updatedAt: new Date().toISOString() }, { merge: true });
      setSyncState("synced");
    } catch {
      setGachaStatus("設定を保存できませんでした。通信状態を確認してください");
      setSyncState("local");
    }
  }

  async function drawGacha() {
    if (!gachaEnabled || gameProgress.coins < GACHA_COST || isDrawingGacha || !db) return;
    setIsDrawingGacha(true);
    setGachaResult(null);
    setGachaRevealOpen(true);
    setGachaStatus("");
    await new Promise((resolve) => window.setTimeout(resolve, 1250));
    const drawNumber = gameProgress.gachaDrawsByType[gachaType] + 1;
    const item = drawCollectible(drawNumber, gachaType);
    const previousCount = gameProgress.collectionCounts[item.id] ?? (gameProgress.inventory.includes(item.id) ? 1 : 0);
    const nextCount = previousCount + 1;
    const nextProgress: GameProgress = {
      ...gameProgress,
      coins: Math.max(0, gameProgress.coins - GACHA_COST),
      inventory: previousCount ? gameProgress.inventory : [...gameProgress.inventory, item.id],
      collectionCounts: { ...gameProgress.collectionCounts, [item.id]: nextCount },
      gachaDraws: gameProgress.gachaDraws + 1,
      gachaDrawsByType: { ...gameProgress.gachaDrawsByType, [gachaType]: drawNumber },
      updatedAt: new Date().toISOString(),
    };
    setGameProgress(nextProgress);
    setGachaResult({ item, count: nextCount, isNew: previousCount === 0 });
    setIsDrawingGacha(false);
    localStorage.setItem(GAME_PROGRESS_KEY, JSON.stringify(nextProgress));
    if (effectsEnabledRef.current) void audioEngine.current?.playEffect(item.rarity === "superRare" ? "finish" : item.rarity === "rare" ? "combo" : "correct");
    try {
      await setDoc(doc(db, "learners", LEARNER_RECORD_ID, "gameProgress", "summary"), nextProgress, { merge: true });
      setSyncState("synced");
    } catch {
      setGachaStatus("この端末には保存しました。通信が戻ったらもう一度開いてください");
      setSyncState("local");
    }
  }

  function audioSettings(compact = false) {
    return (
      <details className={`audio-settings ${compact ? "compact" : ""}`}>
        <summary><Volume2 size={17} />音設定</summary>
        <div className="audio-settings-panel">
          <label className="audio-toggle">
            <span><Music size={16} />BGM</span>
            <input type="checkbox" checked={bgmEnabled} onChange={(event) => updateBgmEnabled(event.target.checked)} />
          </label>
          <label className="audio-select">
            <span>BGMの種類</span>
            <select value={bgmStyle} disabled={!bgmEnabled} onChange={(event) => updateBgmStyle(event.target.value as BgmStyle)}>
              <option value="focus">集中</option>
              <option value="playful">たのしい</option>
              <option value="challenge">チャレンジ</option>
            </select>
          </label>
          <label className="audio-select">
            <span>BGM音量</span>
            <select value={bgmVolume} disabled={!bgmEnabled} onChange={(event) => updateBgmVolume(event.target.value as AudioVolume)}>
              <option value="low">小</option>
              <option value="medium">中</option>
              <option value="high">大</option>
            </select>
          </label>
          <label className="audio-toggle">
            <span>{effectsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}効果音</span>
            <input type="checkbox" checked={effectsEnabled} onChange={(event) => {
              setEffectsEnabled(event.target.checked);
              effectsEnabledRef.current = event.target.checked;
              if (event.target.checked) void audioEngine.current?.playEffect("next");
            }} />
          </label>
          <label className="audio-select">
            <span>効果音量</span>
            <select value={effectVolume} disabled={!effectsEnabled} onChange={(event) => updateEffectVolume(event.target.value as AudioVolume)}>
              <option value="low">小</option>
              <option value="medium">中</option>
              <option value="high">大</option>
            </select>
          </label>
          {!compact && <button type="button" className="audio-preview" onClick={() => playEffect("correct")} disabled={!effectsEnabled}>効果音を試す</button>}
        </div>
      </details>
    );
  }

  if (!firebaseConfigured) {
    return <main className="login-shell"><section className="login-card"><CircleAlert size={34} /><h1>初期設定中です</h1><p>Googleログインの設定が完了すると利用できます。</p></section></main>;
  }

  if (!authReady) {
    return <main className="login-shell"><section className="login-card"><Cloud size={34} /><h1>読み込み中</h1><p>ログイン状態を確認しています。</p></section></main>;
  }

  if (!user) {
    return <main className="login-shell"><section className="login-card"><div className="login-mark"><BookOpenCheck size={28} /></div><span className="section-kicker">PRIVATE LEARNING</span><h1>適性検査<br />トレーニング</h1><p>許可されたGoogleアカウントでログインしてください。</p><button className="google-button" onClick={login}>Googleでログイン</button>{authError && <small className="auth-error">{authError}</small>}</section></main>;
  }

  if (!isAllowed) {
    return <main className="login-shell"><section className="login-card"><LockKeyhole size={34} /><h1>このアカウントでは<br />利用できません</h1><p>許可されたGoogleアカウントへ切り替えてください。</p><button className="secondary-button" onClick={() => signOut(auth!)}>別のアカウントを選ぶ</button></section></main>;
  }

  return (
    <main className={isExerciseActive ? "session-active" : basicTrainingActive ? "basic-active" : ""}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ページ上部へ">
          <span className="brand-mark"><BookOpenCheck size={20} /></span>
          <span><strong>適性検査トレーニング</strong><small>愛知県立附属中 対策</small></span>
        </a>
        <nav aria-label="ページ内メニュー">
          <a href="#practice">適性検査</a>
          <a href="#basic-training">基礎トレ</a>
          <a href="#progress">進捗</a>
        </nav>
        <div className={`sync ${syncState}`} title="保存状態">
          {syncState === "synced" ? <Cloud size={16} /> : syncState === "local" ? <CloudOff size={16} /> : <Cloud size={16} />}
          <span>{syncState === "synced" ? "端末間で同期" : syncState === "local" ? "この端末に保存" : "同期を確認中"}</span>
        </div>
        <button className="account-button" onClick={() => signOut(auth!)}>{isAdmin ? "保護者" : "学習者"}・ログアウト</button>
      </header>

      <section id="top" className="hero section-shell">
        <div className="hero-copy">
          <div className="eyebrow"><LockKeyhole size={15} /> 非公開・自分専用</div>
          <h1>{heroMessage.lead}<br /><em>{heroMessage.accent}</em></h1>
          <p>マーク式の解答に慣れながら、結果を自動で記録。苦手分野が次の問題選びにつながります。</p>
          <div className="hero-training-selector" role="tablist" aria-label="トレーニングを選ぶ">
            <button type="button" role="tab" aria-selected={heroTrack === "aptitude"} className={heroTrack === "aptitude" ? "active" : ""} onClick={() => setHeroTrack("aptitude")}>適性検査</button>
            <button type="button" role="tab" aria-selected={heroTrack === "basic"} className={heroTrack === "basic" ? "active" : ""} onClick={() => setHeroTrack("basic")}>中学受験 基礎トレ</button>
          </div>
          <div className="hero-actions">
            {heroTrack === "aptitude" ? <>
              <button className="primary-button" disabled={!questions.length} onClick={() => startSession("weak")}>
                <Sparkles size={18} /> 弱点から5問 <ArrowRight size={18} />
              </button>
              <button className="secondary-button" disabled={!questions.length} onClick={() => startSession("balanced")}>全分野から10問</button>
              <button className="secondary-button" disabled={!questions.length} onClick={openDomainPicker}>分野を選ぶ</button>
            </> : <>
              <button className="primary-button" onClick={() => requestBasicSession("weak")}><Sparkles size={18} /> 弱点から5問 <ArrowRight size={18} /></button>
              <button className="secondary-button" onClick={() => requestBasicSession("balanced")}>全科目から10問</button>
              <button className="secondary-button" onClick={openBasicSubjectPicker}>科目を選ぶ</button>
            </>}
          </div>
          <div className="hero-audio-settings">{audioSettings()}</div>
        </div>
        <div className="dashboard-panel" aria-label="学習サマリー">
          <div className="panel-heading">
            <span>学習サマリー</span>
            <span className="date-label">{isAdmin ? "これまでの記録" : "今日の成果"}</span>
          </div>
          {isAdmin ? (
            <>
              <div className="metric-grid">
                <div className="metric"><Target size={20} /><strong>{stats.accuracy}<small>%</small></strong><span>正答率</span></div>
                <div className="metric"><BookOpenCheck size={20} /><strong>{attempts.length + basicAttempts.length}<small>問</small></strong><span>演習数</span></div>
                <div className="metric"><Trophy size={20} /><strong>{stats.correct}<small>問</small></strong><span>正解</span></div>
              </div>
              <div className="focus-card">
                <div><span className="focus-label">いま優先したい分野・科目</span><strong>{overallWeakest?.label ?? "問題を登録してください"}</strong></div>
                <div className="focus-score">{overallWeakest?.attempts ? `${overallWeakest.accuracy}%` : "未挑戦"}</div>
              </div>
            </>
          ) : (
            <>
              <div className="metric-grid">
                <div className="metric"><BookOpenCheck size={20} /><strong>{todayStats.attempts}<small>問</small></strong><span>今日の挑戦</span></div>
                <div className="metric"><Target size={20} /><strong>{todayStats.correct}<small>問</small></strong><span>今日の正解</span></div>
                <div className="metric"><Trophy size={20} /><strong>{todayStats.bestStreak}<small>問</small></strong><span>最高連続正解</span></div>
              </div>
              <div className="focus-card achievement-focus">
                <div><span className="focus-label">今日の新しい成果</span><strong>{todayStats.newlyMastered ? `${todayStats.newlyMastered}問 身についた！` : todayStats.newlyDone ? `${todayStats.newlyDone}問 できた！` : "まずは1問、挑戦しよう"}</strong></div>
                <div className="focus-score">{todayStats.newlyMastered ? `★ +${todayStats.newlyMastered}` : todayStats.newlyDone ? `✓ +${todayStats.newlyDone}` : "GO"}</div>
              </div>
              <div className="player-level-card" aria-label={`レベル${gameLevel}、次のレベルまで${XP_PER_LEVEL - levelXp}XP`}>
                <div className="player-level-number"><Gamepad2 size={18} /><span>LEVEL</span><strong>{gameLevel}</strong></div>
                <div className="player-level-progress"><div><span>合計 {gameProgress.totalXp} XP</span><strong>次まで {XP_PER_LEVEL - levelXp}</strong></div><div className="xp-track"><span style={{ width: `${(levelXp / XP_PER_LEVEL) * 100}%` }} /></div></div>
                <div className="player-best"><span>BEST</span><strong>{gameProgress.bestScore}</strong></div>
              </div>
            </>
          )}
          <button className="player-wallet-card" type="button" onClick={() => document.getElementById("gacha")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <span className="wallet-icon"><Coins size={20} /></span>
            <span><small>COIN</small><strong>{gameProgress.coins}</strong></span>
            <span className="wallet-collection">コレクション {ownedCollectibles.length}/{COLLECTIBLES.length}<ChevronRight size={16} /></span>
          </button>
          <p className="sample-note">問題バンク：全{customQuestions.length + basicQuestionCount}問（適性検査 {customQuestions.length}問＋基礎トレ {basicQuestionCount}問）</p>
        </div>
      </section>

      <section id="practice" className="practice section-shell">
        <div className="section-title-row practice-title-row">
          <div><span className="section-kicker">APTITUDE TEST PRACTICE</span><h2>適性検査 問題演習</h2></div>
          {isExerciseActive && <div className="exercise-controls">{audioSettings(true)}<button className="quit-button" onClick={stopSession}>中断する</button></div>}
        </div>

        {isExerciseActive && (
          <div className="mission-hud" aria-label={`ステージ${questionIndex + 1}/${session.length}、${combo}コンボ、スコア${sessionPoints}`}>
            <span><Gamepad2 size={15} /> STAGE <strong>{questionIndex + 1}/{session.length}</strong></span>
            <span className={combo >= 2 ? "combo-hot" : ""}><Flame size={15} /> COMBO <strong>{combo}</strong></span>
            <span><Zap size={15} /> SCORE <strong>{sessionPoints}</strong></span>
            <span><Coins size={15} /> COIN <strong>{sessionCoins}</strong></span>
            <span>+{sessionXp} XP</span>
          </div>
        )}
        {isExerciseActive && <div className="session-progress" aria-label={`全${session.length}問中${questionIndex + 1}問目`}><span style={{ width: `${((questionIndex + 1) / session.length) * 100}%` }} /></div>}

        {session.length === 0 ? (
          <div className="practice-empty">
            <div className="empty-icon"><BookOpenCheck size={30} /></div>
            {questions.length ? (
              <>
                <h3>演習メニューを選んで始めましょう</h3>
                <p>弱点優先、全分野、分野別の3つから選べます。</p>
                <div className="empty-actions">
                  <button className="primary-button" onClick={() => startSession("weak")}><Sparkles size={18} /> 弱点から5問</button>
                  <button className="secondary-button" onClick={() => startSession("balanced")}>全分野から10問</button>
                </div>
                <div id="domain-picker" className="domain-picker">
                  <div><strong>分野を選んで5問</strong><small>直近の誤答と未挑戦を優先します</small></div>
                  <div className="domain-picker-grid">
                    {DOMAINS.map((domain) => {
                      const count = domainQuestionCounts.get(domain) ?? 0;
                      return <button key={domain} type="button" disabled={!count} onClick={() => startDomainSession(domain)}><span>{domain}</span><small>{count}問登録</small></button>;
                    })}
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3>問題バンクはまだ空です</h3>
                <p>{isAdmin ? "保護者画面の「問題を一括追加」からJSONを登録してください。" : "保護者が問題を登録すると、ここから演習を始められます。"}</p>
              </>
            )}
          </div>
        ) : sessionFinished ? (
          <div className="result-panel">
            <div className={`rank-badge rank-${sessionRank.toLowerCase()}`} aria-label={`今回のランクは${sessionRank}`}>{sessionRank}</div>
            <span className="section-kicker">MISSION COMPLETE</span>
            <h3>{session.length}問中 {sessionScore}問正解</h3>
            <p>{sessionRank === "S" ? "パーフェクト！正確さとテンポの両方が光りました。" : sessionScore / session.length >= 0.6 ? "目標の6割をクリア！次はもう一段上のランクを狙おう。" : "挑戦した分だけ前進です。弱点からもう一度取り組もう。"}</p>
            {sessionNewBest && <div className="new-best"><Trophy size={16} /> NEW BEST!</div>}
            <div className="result-game-stats">
              <div><span>SCORE</span><strong>{sessionPoints}</strong></div>
              <div><span>GET</span><strong>+{sessionXp}<small> XP</small></strong></div>
              <div><span>COINS</span><strong>+{sessionCoins}<small> 枚</small></strong></div>
              <div><span>MAX COMBO</span><strong>{sessionBestCombo}</strong></div>
              <div><span>正答率</span><strong>{sessionAccuracy}<small>%</small></strong></div>
            </div>
            <div className="result-level"><div><span>LEVEL {gameLevel}</span><strong>{levelXp} / {XP_PER_LEVEL} XP</strong></div><div className="xp-track"><span style={{ width: `${(levelXp / XP_PER_LEVEL) * 100}%` }} /></div></div>
            <div className="result-rate"><span style={{ width: `${Math.round(sessionScore / session.length * 100)}%` }} /></div>
            <div className="empty-actions">
              <button className="primary-button" onClick={() => startSession("weak")}><RotateCcw size={18} /> 弱点からもう5問</button>
              <a className="secondary-button as-link" href="#progress">進捗を見る</a>
            </div>
            <div className="domain-picker result-domain-picker">
              <div><strong>次は分野を選んで5問</strong><small>練習中と未挑戦の問題を優先します</small></div>
              <div className="domain-picker-grid">
                {DOMAINS.map((domain) => {
                  const count = domainQuestionCounts.get(domain) ?? 0;
                  return <button key={domain} type="button" disabled={!count} onClick={() => startDomainSession(domain)}><span>{domain}</span><small>{count}問登録</small></button>;
                })}
              </div>
            </div>
          </div>
        ) : activeQuestion ? (
          <div className="question-layout">
            <article className="question-card">
              {answerAward && selectedIndex !== null && (
                <div className={`answer-award ${answerAward.points ? "earned" : "missed"}`} role="status">
                  <strong>{answerAward.points ? `+${answerAward.points}` : answerAward.label}</strong>
                  <span>{answerAward.points ? `${answerAward.label}  +${answerAward.xp} XP・+${answerAward.coins} COIN` : `+${answerAward.xp} XP・+${answerAward.coins} COIN`}</span>
                </div>
              )}
              <div className="question-heading-row">
                <div className="question-ident">
                  <h3 className="question-title">{activeQuestion.title}</h3>
                  <div className="question-meta"><span>{activeQuestion.domain}</span><span>{activeQuestion.skill}</span></div>
                </div>
                <div className="question-status">
                  <div className="remaining-count" aria-label={`この問題を含めて残り${session.length - questionIndex}問`}><span>残り</span><strong>{session.length - questionIndex}</strong><span>問</span></div>
                  <div className={`question-timer ${secondsRemaining <= 5 ? "danger" : secondsRemaining <= 10 ? "warning" : ""}`} aria-label={`残り${secondsRemaining}秒`}>
                    <Timer size={18} /><strong>{secondsRemaining}</strong><span>秒</span>
                  </div>
                </div>
              </div>
              <div className={`question-time-track ${secondsRemaining <= 5 ? "danger" : secondsRemaining <= 10 ? "warning" : ""}`} aria-hidden="true"><span style={{ width: `${(secondsRemaining / activeTimeLimit) * 100}%` }} /></div>
              {activeQuestion.context && <div className="question-context">{formatEnumeratedText(activeQuestion.context)}</div>}
              <p className="question-prompt">{formatEnumeratedText(activeQuestion.prompt)}</p>
              <div className="options" role="group" aria-label="選択肢">
                {activeQuestion.options.map((option, index) => {
                  const answered = selectedIndex !== null;
                  const correct = answered && index === activeQuestion.correctIndex;
                  const wrong = answered && index === selectedIndex && !correct;
                  return (
                    <button key={option} className={`option ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`} onClick={() => answerQuestion(index)} disabled={answered}>
                      <span className="option-letter">{String.fromCharCode(65 + index)}</span>
                      <span>{option}</span>
                      {correct && <Check size={20} />}{wrong && <X size={20} />}
                    </button>
                  );
                })}
              </div>
            </article>
            <aside className={`feedback ${selectedIndex === null ? "waiting" : selectedIndex === activeQuestion.correctIndex ? "good" : "retry"}`}>
              {selectedIndex === null ? (
                <><Timer size={22} /><h4>{activeTimeLimit}秒で答えよう</h4><p>迷ったら、条件に最も合う選択肢を決めましょう。解説を読む時間には制限がありません。</p></>
              ) : (
                <>
                  {selectedIndex === activeQuestion.correctIndex ? <Check size={24} /> : <CircleAlert size={24} />}
                  <h4>{selectedIndex === -1 ? "時間切れ" : selectedIndex === activeQuestion.correctIndex ? "正解！" : "ここを見直そう"}</h4>
                  <p>{activeQuestion.explanation}</p>
                  <button className="next-button" onClick={goNext}>{questionIndex === session.length - 1 ? "結果を見る" : "次の問題"}<ChevronRight size={18} /></button>
                </>
              )}
            </aside>
          </div>
        ) : null}
      </section>

      <BasicTraining
        enabled={Boolean(user && isAllowed)}
        startRequest={basicStartRequest}
        questionRefreshToken={basicQuestionRefreshToken}
        resetWindows={resetWindows}
        onActivityChange={handleBasicActivityChange}
        onAttemptsChange={handleBasicAttemptsChange}
        onQuestionCatalogChange={handleBasicQuestionCatalogChange}
        onReward={rewardBasicAnswer}
        onComplete={rewardBasicCompletion}
        onSound={playEffect}
        onSyncStateChange={handleBasicSyncStateChange}
      />

      <section id="progress" className="progress-section section-shell">
        <div className="section-title-row">
          <div><span className="section-kicker">ACHIEVEMENTS</span><h2>分野・科目別の成果</h2></div>
          <p className="progress-rule">同じ問題に2回続けて正解すると「身についた」になります</p>
        </div>
        <div className="progress-layout">
          <div className="achievement-groups">
            <div className="achievement-group">
              <div className="achievement-group-title"><strong>適性検査</strong><span>6分野</span></div>
              <div className="domain-achievement-grid">
                {domainStats.map((row) => {
                  const unattempted = Math.max(0, row.registered - row.attempted);
                  return (
                    <article className="achievement-card" key={row.domain}>
                      <div className="achievement-heading"><strong>{row.domain}</strong><span>{row.attempted} / {row.registered}問に挑戦</span></div>
                      <div className="achievement-bar" aria-label={`${row.domain}：未挑戦${unattempted}問、練習中${row.practicing}問、できた${row.done}問、身についた${row.mastered}問`}>
                        {row.registered > 0 && <>
                          <span className="practicing" style={{ width: `${row.practicing / row.registered * 100}%` }} />
                          <span className="done" style={{ width: `${row.done / row.registered * 100}%` }} />
                          <span className="mastered" style={{ width: `${row.mastered / row.registered * 100}%` }} />
                        </>}
                      </div>
                      <div className="achievement-counts">
                        <span className="practicing"><small>練習中</small><strong>{row.practicing}</strong></span>
                        <span className="done"><small>できた</small><strong>{row.done}</strong></span>
                        <span className="mastered"><small>身についた</small><strong>{row.mastered}</strong></span>
                      </div>
                      {isAdmin && <p className="parent-detail">全{row.attempts}回答・正答率 {row.attempts ? `${row.accuracy}%` : "—"}</p>}
                    </article>
                  );
                })}
              </div>
            </div>
            <div className="achievement-group basic-achievement-group">
              <div className="achievement-group-title"><strong>中学受験 基礎トレ</strong><span>{basicSubjectStats.length}科目</span></div>
              <div className="domain-achievement-grid basic-achievement-grid">
                {basicSubjectStats.map((row) => {
                  const unattempted = Math.max(0, row.registered - row.attempted);
                  return (
                    <article className="achievement-card" key={row.subject}>
                      <div className="achievement-heading"><strong>{row.label}</strong><span>{row.attempted} / {row.registered}問に挑戦</span></div>
                      <div className="achievement-bar" aria-label={`${row.label}：未挑戦${unattempted}問、練習中${row.practicing}問、できた${row.done}問、身についた${row.mastered}問`}>
                        <span className="practicing" style={{ width: `${row.practicing / row.registered * 100}%` }} />
                        <span className="done" style={{ width: `${row.done / row.registered * 100}%` }} />
                        <span className="mastered" style={{ width: `${row.mastered / row.registered * 100}%` }} />
                      </div>
                      <div className="achievement-counts">
                        <span className="practicing"><small>練習中</small><strong>{row.practicing}</strong></span>
                        <span className="done"><small>できた</small><strong>{row.done}</strong></span>
                        <span className="mastered"><small>身についた</small><strong>{row.mastered}</strong></span>
                      </div>
                      {isAdmin && <p className="parent-detail">全{row.attempts}回答・正答率 {row.attempts ? `${row.accuracy}%` : "—"}</p>}
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="recent-panel">
            <div className="recent-title"><BarChart3 size={18} /><strong>最近の記録</strong></div>
            {recent.length ? recent.map((attempt) => {
              const title = attempt.trainingType === "aptitude"
                ? questions.find((question) => question.id === attempt.questionId)?.title ?? attempt.domain
                : basicQuestionTitles.get(attempt.questionId) ?? "基礎トレ";
              const category = attempt.trainingType === "aptitude"
                ? `適性検査・${attempt.domain}`
                : `基礎トレ・${basicSubjects.find((subject) => subject.id === attempt.subject)?.label ?? attempt.subject}`;
              return <div className="recent-row" key={`${attempt.trainingType}-${attempt.clientAttemptId}`}><span className={attempt.isCorrect ? "recent-ok" : "recent-ng"}>{attempt.isCorrect ? <Check size={14} /> : <X size={14} />}</span><div><strong>{title}</strong><small>{category}・{new Date(attempt.createdAt).toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</small></div></div>;
            }) : <p className="recent-empty">演習すると、ここに記録が並びます。</p>}
          </div>
        </div>

        <section id="gacha" className="gacha-section" aria-labelledby="gacha-title">
          <div className="gacha-heading">
            <div><span className="section-kicker">AICHI COLLECTION</span><h3 id="gacha-title">コインガチャ</h3><p>3つのガチャで、愛知のコレクション全54種を集めよう。</p></div>
            <div className="gacha-wallet"><Coins size={20} /><span>所持コイン</span><strong>{gameProgress.coins}</strong></div>
          </div>
          {isAdmin && (
            <div className="gacha-parent-control">
              <div><strong>保護者設定</strong><span>お子さんのガチャ利用を切り替えます</span></div>
              <label><input type="checkbox" checked={gachaEnabled} onChange={(event) => void updateGachaEnabled(event.target.checked)} /><span>{gachaEnabled ? "利用中" : "停止中"}</span></label>
            </div>
          )}
          <div className="gacha-type-tabs" aria-label="ガチャを選ぶ">
            {GACHA_TYPES.map((type) => {
              const owned = COLLECTIBLES.filter((item) => item.gachaType === type.id && gameProgress.inventory.includes(item.id)).length;
              return <button key={type.id} type="button" className={gachaType === type.id ? "active" : ""} onClick={() => { setGachaType(type.id); setCollectionGachaType(type.id); setGachaResult(null); }}><strong>{type.label}</strong><span>{type.description}</span><small>{owned} / 18</small></button>;
            })}
          </div>
          <div className="gacha-layout">
            <div className={`gacha-machine ${isDrawingGacha ? "drawing" : ""} ${!gachaEnabled ? "disabled" : ""}`}>
              <div className="gacha-window" aria-live="polite">
                {isDrawingGacha ? (
                  <><Gift size={42} /><strong>抽選中…</strong><span>どのコレクションが出るかな？</span></>
                ) : gachaResult ? (
                  <><span className="gacha-result-icon">{gachaResult.item.icon}</span><small className={`rarity-${gachaResult.item.rarity}`}>{gachaResult.item.rarity === "superRare" ? "SUPER RARE" : gachaResult.item.rarity === "rare" ? "RARE" : "COMMON"}</small><strong>{gachaResult.item.name}</strong><span>{gachaResult.isNew ? gachaResult.item.description : `また会えた！ 所持数 ×${gachaResult.count}`}</span></>
                ) : (
                  <><Gift size={42} /><strong>{GACHA_TYPES.find((type) => type.id === gachaType)?.label}</strong><span>1回 {GACHA_COST}コイン</span></>
                )}
              </div>
              <button className="gacha-button" type="button" disabled={!gachaEnabled || gameProgress.coins < GACHA_COST || isDrawingGacha} onClick={() => void drawGacha()}>
                <Coins size={18} /> {isDrawingGacha ? "抽選中…" : !gachaEnabled ? "保護者が停止中" : gameProgress.coins < GACHA_COST ? `あと${GACHA_COST - gameProgress.coins}コイン` : `${GACHA_COST}コインで引く`}
              </button>
              <div className="gacha-rates"><span>通常 70%</span><span>レア 25%</span><span>スーパーレア 5%</span></div>
              <p>このガチャは、あと<strong>{10 - (gameProgress.gachaDrawsByType[gachaType] % 10)}</strong>回以内にレア以上確定・同じ景品は所持数が増えるよ</p>
              {gachaStatus && <small className="gacha-status">{gachaStatus}</small>}
            </div>
            <div className="collection-panel">
              <div className="collection-title"><strong>コレクション図鑑</strong><span>{ownedCollectibles.length} / {COLLECTIBLES.length}</span></div>
              <div className="collection-filters" aria-label="コレクションの種類">
                {GACHA_TYPES.map((type) => <button key={type.id} type="button" className={collectionGachaType === type.id ? "active" : ""} onClick={() => setCollectionGachaType(type.id)}>{type.label.replace("ガチャ", "")}</button>)}
              </div>
              <div className="collection-grid">
                {visibleCollectibles.map((item) => {
                  const count = gameProgress.collectionCounts[item.id] ?? (gameProgress.inventory.includes(item.id) ? 1 : 0);
                  const owned = count > 0;
                  return <article key={item.id} className={`collection-item ${owned ? "owned" : "locked"} rarity-border-${item.rarity}`} aria-label={owned ? `${item.name}を${count}個所持` : "未入手のアイテム"}><span>{owned ? item.icon : "?"}</span><strong>{owned ? item.name : "？？？"}</strong><small>{owned ? (item.rarity === "superRare" ? "SR" : item.rarity === "rare" ? "R" : "N") : "LOCK"}</small>{owned && <b className="collection-count">×{count}</b>}</article>;
                })}
              </div>
            </div>
          </div>
        </section>

        {gachaRevealOpen && (
          <div className={`gacha-reveal rarity-bg-${gachaResult?.item.rarity ?? "common"}`} role="dialog" aria-modal="true" aria-label={isDrawingGacha ? "ガチャ抽選中" : "ガチャ結果"}>
            <div className="gacha-rays" aria-hidden="true" />
            {Array.from({ length: 22 }, (_, index) => <i key={index} className={`gacha-confetti confetti-${index % 6}`} style={{ "--i": index } as CSSProperties} aria-hidden="true" />)}
            {isDrawingGacha ? (
              <div className="gacha-capsule-stage">
                <span className="gacha-capsule"><span /></span>
                <strong>ガチャガチャ…</strong>
                <small>タップせずに待ってね</small>
              </div>
            ) : gachaResult && (
              <div className={`gacha-reveal-card rarity-card-${gachaResult.item.rarity}`}>
                <span className="gacha-new-label">{gachaResult.isNew ? "NEW!" : `所持数 ×${gachaResult.count}`}</span>
                <span className="gacha-reveal-icon">{gachaResult.item.icon}</span>
                <small>{gachaResult.item.category}</small>
                <strong>{gachaResult.item.name}</strong>
                <p>{gachaResult.item.description}</p>
                <b>{gachaResult.item.rarity === "superRare" ? "SUPER RARE" : gachaResult.item.rarity === "rare" ? "RARE" : "NORMAL"}</b>
                <button type="button" onClick={() => setGachaRevealOpen(false)}>図鑑にしまう</button>
              </div>
            )}
          </div>
        )}

        {isAdmin && (
          <section className="history-reset-panel" aria-labelledby="history-reset-title">
            <div className="history-reset-copy">
              <span className="section-kicker">HISTORY CONTROL</span>
              <h3 id="history-reset-title">履歴をリセット</h3>
              <p>選んだ期間の解答履歴を、家族のすべての端末から削除します。</p>
            </div>
            <div className="history-reset-form">
              <label>
                対象期間
                <select
                  value={resetPreset}
                  onChange={(event) => {
                    setResetPreset(event.target.value as ResetPreset);
                    setResetConfirm(false);
                    setResetStatus("");
                  }}
                >
                  <option value="today">今日</option>
                  <option value="7days">過去7日</option>
                  <option value="30days">過去30日</option>
                  <option value="custom">日付を指定</option>
                  <option value="all">すべての期間</option>
                </select>
              </label>
              {resetPreset === "custom" && (
                <div className="history-date-range">
                  <label>開始日<input type="date" value={resetStart} onChange={(event) => { setResetStart(event.target.value); setResetConfirm(false); setResetStatus(""); }} /></label>
                  <span aria-hidden="true">〜</span>
                  <label>終了日<input type="date" value={resetEnd} onChange={(event) => { setResetEnd(event.target.value); setResetConfirm(false); setResetStatus(""); }} /></label>
                </div>
              )}
              <div className="reset-summary">
                <span>{resetRange?.label ?? "期間を指定してください"}</span>
                <strong>対象 {resetTargetCount}件</strong>
              </div>
              {!resetConfirm ? (
                <button className="danger-button" type="button" disabled={!resetRange || isResetting} onClick={() => { setResetConfirm(true); setResetStatus(""); }}>
                  <RotateCcw size={17} /> リセット内容を確認
                </button>
              ) : (
                <div className="reset-confirm" role="alert">
                  <p><strong>{resetRange?.label}</strong>の履歴を削除します。この操作は元に戻せません。</p>
                  <div>
                    <button className="secondary-button" type="button" disabled={isResetting} onClick={() => setResetConfirm(false)}>キャンセル</button>
                    <button className="danger-button" type="button" disabled={isResetting} onClick={resetHistory}>
                      <RotateCcw size={17} /> {isResetting ? "削除中…" : `${resetTargetCount}件をリセット`}
                    </button>
                  </div>
                </div>
              )}
              {resetStatus && <p className="reset-status" aria-live="polite">{resetStatus}</p>}
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="question-import" aria-labelledby="question-import-title">
            <div className="question-manager">
              <div><span className="section-kicker">QUESTION BANK</span><h3 id="question-import-title">問題を一括追加</h3><p>適性検査・基礎トレのJSONを自動判別して一括登録できます。現在の基礎トレは{basicQuestionCount}問です。</p></div>
              <div className="question-manager-actions">
                <button className="secondary-button" type="button" onClick={downloadImportTemplate}><FileJson size={17} /> 適性検査ひな形</button>
                <select aria-label="基礎トレひな形を選択" defaultValue="" onChange={(event) => { if (event.currentTarget.value) downloadBasicImportTemplate(event.currentTarget.value as BasicSubject); event.currentTarget.value = ""; }}>
                  <option value="" disabled>基礎トレひな形</option>
                  {BASIC_SUBJECT_IDS.map((subject) => <option key={subject} value={subject}>{BASIC_SUBJECT_LABELS[subject]}</option>)}
                </select>
                <button className="secondary-button" type="button" disabled={syncState !== "synced" || !questions.length} onClick={downloadQuestionBank}>
                  <Download size={17} /> 適性検査 {questions.length}問をJSON出力
                </button>
                <button className="secondary-button" type="button" disabled={!basicQuestionCatalog.length} onClick={downloadBasicQuestionBank}>
                  <Download size={17} /> 基礎トレ {basicQuestionCatalog.length}問をJSON出力
                </button>
              </div>
            </div>
            <div className="question-import-panel">
              <label className="json-file-picker">
                <FileJson size={30} />
                <strong>JSONファイルを選択（複数可）</strong>
                <span>1ファイル5MBまで・20～50問程度を推奨</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    void readImportFiles(files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>

              {importFiles.length > 0 && (
                <div className="import-preview-list">
                  {importFiles.map((file, fileIndex) => (
                    <div className="import-preview" key={`${file.fileName}-${fileIndex}`}>
                      <div className="import-file-title">
                        <FileJson size={20} />
                        <div><strong>{file.setTitle}</strong><small>{file.fileName}</small></div>
                        <button type="button" className="import-file-remove" aria-label={`${file.fileName}を取り消す`} onClick={() => removeImportFile(fileIndex)}><X size={16} /></button>
                      </div>
                      {file.kind !== "invalid" && (
                        <>
                          <div className="import-metrics">
                            <div><strong>{file.questions.length}</strong><span>読込</span></div>
                            <div><strong>{fileNewCount(file)}</strong><span>新規</span></div>
                            <div><strong>{file.duplicates.length}</strong><span>既存ID</span></div>
                            <div className={file.errors.length ? "has-error" : "is-valid"}><strong>{file.errors.length}</strong><span>エラー</span></div>
                          </div>
                          <div className="import-domains">{fileDomainCounts(file).map((row) => <span key={row.label}>{row.label} {row.count}問</span>)}</div>
                        </>
                      )}
                      {file.errors.length > 0 && (
                        <div className="import-errors" role="alert">
                          <strong><CircleAlert size={17} /> 修正が必要です</strong>
                          <ul>{file.errors.slice(0, 12).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>
                          {file.errors.length > 12 && <p>ほか{file.errors.length - 12}件のエラーがあります。</p>}
                        </div>
                      )}
                    </div>
                  ))}

                  {importTotals.totalErrors === 0 && (
                    <>
                      {importTotals.totalDuplicates > 0 && (
                        <fieldset className="duplicate-choice">
                          <legend>既存IDの扱い（選択中のすべてのファイルに適用）</legend>
                          <label><input type="radio" name="importMode" value="skip" checked={importMode === "skip"} onChange={() => setImportMode("skip")} /><span><strong>スキップ</strong><small>既存問題を残し、新規問題だけ追加</small></span></label>
                          <label><input type="radio" name="importMode" value="overwrite" checked={importMode === "overwrite"} onChange={() => setImportMode("overwrite")} /><span><strong>上書き</strong><small>同じIDの問題をJSONの内容に更新</small></span></label>
                        </fieldset>
                      )}
                      <div className="import-batch-summary">
                        <span>選択中 {importFiles.length}ファイル・合計{importTotals.totalQuestions}問読込・{importTotals.totalDuplicates}件既存ID</span>
                      </div>
                      <button className="primary-button import-button" type="button" disabled={isImporting || (importMode === "skip" ? importTotals.totalNew === 0 : importTotals.totalQuestions === 0)} onClick={importQuestions}>
                        <Upload size={18} /> {isImporting ? "登録中…" : `${importMode === "skip" ? importTotals.totalNew : importTotals.totalQuestions}問を一括追加`}
                      </button>
                    </>
                  )}
                </div>
              )}
              {importStatus && <p className="import-status" aria-live="polite">{importStatus}</p>}
            </div>
          </section>
        )}
      </section>

      <footer><span>愛知県立附属中 適性検査トレーニング</span><span>登録した問題を家族の端末間で共有します。</span></footer>
    </main>
  );
}
