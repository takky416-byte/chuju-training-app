"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BookOpenCheck, Check, ChevronRight, Eraser, Map as MapIcon, PencilLine, RotateCcw, Sparkles, Timer, Trophy, Undo2, X } from "lucide-react";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  BASIC_QUESTION_POOL,
  BASIC_SUBJECT_CONFIG,
  BASIC_SUBJECT_IDS,
  GEOGRAPHY_TOPIC_LABELS,
  isShortAnswerBasicSubject,
  isWritingBasicSubject,
  normalizeStoredBasicQuestion,
  type BasicQuestionEntry,
  type BasicSubject,
  type GeographyQuestion,
  type KanjiQuestion,
  type ShortAnswerQuestion,
} from "./basic-questions";
import { db, functions, LEARNER_RECORD_ID } from "./firebase";
import type { SoundEffect } from "./audio-engine";

export type BasicAward = { xp: number; coins: number; label: string };
export type BasicStartRequest = { id: string; mode: "weak" | "balanced" | "subject"; subject?: BasicSubject; round?: number };

export type BasicAttempt = {
  clientAttemptId: string;
  questionId: string;
  questionTitle?: string;
  correctAnswer?: string;
  subject: BasicSubject;
  setId: string;
  isCorrect: boolean;
  durationSeconds: number;
  timedOut?: boolean;
  createdAt: string;
};

type ActiveQuestion = BasicQuestionEntry;
type WritingActiveQuestion = Extract<ActiveQuestion, { question: KanjiQuestion }>;
type ShortAnswerActiveQuestion = Extract<ActiveQuestion, { question: ShortAnswerQuestion }>;

function isWritingEntry(entry: ActiveQuestion): entry is WritingActiveQuestion {
  return isWritingBasicSubject(entry.subject);
}

function isShortAnswerEntry(entry: ActiveQuestion): entry is ShortAnswerActiveQuestion {
  return isShortAnswerBasicSubject(entry.subject);
}

function isSelfScoredMathEntry(entry: ActiveQuestion): boolean {
  return entry.subject === "checkTestMath";
}

function normalizeAnswerText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, "");
}

const MATH_SECTION_LABELS: Record<string, string> = {
  A: "A（四則混合計算）",
  B: "B（単位の換算）",
  C: "C（□を求める計算）",
  D: "D（文章題）",
  E: "E（図形）",
};

function getMathSection(id: string): string | null {
  const match = /^checktest-math-r\d+-([a-e])\d+/.exec(id);
  return match ? match[1].toUpperCase() : null;
}

type BasicSessionMode = "weak" | "balanced" | "subject";

type Props = {
  enabled: boolean;
  subjectIds: readonly BasicSubject[];
  sectionId: string;
  kicker: string;
  resultKicker: string;
  heading: string;
  description: string;
  menuTitle: string;
  menuDescription: string;
  attemptsCollection: string;
  storageKey: string;
  roundSubjects?: BasicSubject[];
  roundOptions?: number[];
  startRequest?: BasicStartRequest | null;
  questionRefreshToken?: number;
  resetWindows: Array<{ start: string; end: string; createdAt: string }>;
  onActivityChange: (active: boolean) => void;
  onAttemptsChange: (attempts: BasicAttempt[]) => void;
  onQuestionCatalogChange: (questions: BasicQuestionEntry[]) => void;
  onReward: (isCorrect: boolean, timedOut: boolean) => Promise<BasicAward>;
  onComplete: (correct: number, total: number) => Promise<number>;
  onSound: (effect: SoundEffect) => void;
  onSyncStateChange: (state: "synced" | "local") => void;
};

const BASIC_SUBJECT_LABELS = Object.fromEntries(BASIC_SUBJECT_IDS.map((id) => [id, BASIC_SUBJECT_CONFIG[id].label])) as Record<BasicSubject, string>;

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

function mergeAttempts(a: BasicAttempt[], b: BasicAttempt[]) {
  const merged = new Map<string, BasicAttempt>();
  [...a, ...b].forEach((attempt) => merged.set(attempt.clientAttemptId, attempt));
  return [...merged.values()].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

function readLocalAttempts(storageKey: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is BasicAttempt => Boolean(item && typeof item === "object" && "clientAttemptId" in item)) : [];
  } catch {
    return [];
  }
}

function clampTime(value: number) {
  return Math.min(45, Math.max(10, Math.round(value || 20)));
}

function renderKanjiSentence(sentence: string) {
  const parts = sentence.split(/(【[^】]+】)/g);
  return parts.map((part, index) => part.startsWith("【")
    ? <mark key={`${part}-${index}`}>{part.slice(1, -1)}</mark>
    : <span key={`${part}-${index}`}>{part}</span>);
}

export function BasicTraining({ enabled, subjectIds, sectionId, kicker, resultKicker, heading, description, menuTitle, menuDescription, attemptsCollection, storageKey, roundSubjects, roundOptions, startRequest, questionRefreshToken = 0, resetWindows, onActivityChange, onAttemptsChange, onQuestionCatalogChange, onReward, onComplete, onSound, onSyncStateChange }: Props) {
  const [attempts, setAttempts] = useState<BasicAttempt[]>([]);
  const [questionPool, setQuestionPool] = useState<ActiveQuestion[]>(() => BASIC_QUESTION_POOL.filter((entry) => subjectIds.includes(entry.subject)));
  const [session, setSession] = useState<ActiveQuestion[]>([]);
  const [roundPickerSubject, setRoundPickerSubject] = useState<BasicSubject | null>(null);
  const [roundPickerSection, setRoundPickerSection] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [seconds, setSeconds] = useState(20);
  const [answered, setAnswered] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [finished, setFinished] = useState(false);
  const [award, setAward] = useState<BasicAward | null>(null);
  const [completionCoins, setCompletionCoins] = useState(0);
  const [aiState, setAiState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [aiResult, setAiResult] = useState<{ text: string; matches: boolean } | null>(null);
  const [canUndoStroke, setCanUndoStroke] = useState(false);
  const [shortAnswerInput, setShortAnswerInput] = useState("");
  const [revealedStepCount, setRevealedStepCount] = useState(0);
  const [guidedIndex, setGuidedIndex] = useState(0);
  const [guidedInput, setGuidedInput] = useState("");
  const [guidedSubmitted, setGuidedSubmitted] = useState(false);
  const [guidedResults, setGuidedResults] = useState<boolean[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const strokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const currentStrokeRef = useRef<Array<{ x: number; y: number }>>([]);
  const startedAtRef = useRef(Date.now());

  const active = session[index];
  const activeLimit = active ? clampTime(active.question.timeLimitSeconds) : 20;
  const isActive = session.length > 0 && !finished;
  const correctCount = answers.filter(Boolean).length;

  useEffect(() => {
    if (!enabled) return;
    const isReset = (attempt: BasicAttempt) => resetWindows.some((window) => attempt.createdAt >= window.start && attempt.createdAt < window.end && attempt.createdAt <= window.createdAt);
    const local = readLocalAttempts(storageKey).filter((attempt) => !isReset(attempt));
    setAttempts(local);
    getDocs(collection(db!, "learners", LEARNER_RECORD_ID, attemptsCollection))
      .then((snapshot) => {
        const remote = snapshot.docs.map((row) => row.data() as BasicAttempt);
        const merged = mergeAttempts(local, remote).filter((attempt) => !isReset(attempt));
        setAttempts(merged);
        localStorage.setItem(storageKey, JSON.stringify(merged));
      })
      .catch(() => undefined);
  }, [enabled, resetWindows, storageKey, attemptsCollection]);

  useEffect(() => {
    if (!enabled) return;
    getDocs(collection(db!, "basicQuestionBank"))
      .then((snapshot) => {
        const remote = snapshot.docs.flatMap((row) => {
          const normalized = normalizeStoredBasicQuestion({ ...row.data(), id: row.id });
          return normalized && subjectIds.includes(normalized.subject) ? [normalized] : [];
        });
        const merged = new Map(BASIC_QUESTION_POOL.filter((entry) => subjectIds.includes(entry.subject)).map((entry) => [entry.question.id, entry]));
        remote.forEach((entry) => merged.set(entry.question.id, entry));
        setQuestionPool([...merged.values()]);
      })
      .catch(() => setQuestionPool(BASIC_QUESTION_POOL.filter((entry) => subjectIds.includes(entry.subject))));
  }, [enabled, questionRefreshToken, subjectIds]);

  useEffect(() => {
    onAttemptsChange(attempts);
  }, [attempts, onAttemptsChange]);

  useEffect(() => {
    onQuestionCatalogChange(questionPool);
  }, [onQuestionCatalogChange, questionPool]);

  useEffect(() => {
    onActivityChange(isActive);
    return () => onActivityChange(false);
  }, [isActive, onActivityChange]);

  useEffect(() => {
    if (!startRequest) return;
    if (startRequest.mode === "subject" && startRequest.subject) {
      startSubjectSession(startRequest.subject, startRequest.round);
      return;
    }
    if (startRequest.mode === "weak" || startRequest.mode === "balanced") startBasicSession(startRequest.mode);
  }, [startRequest?.id]);

  useEffect(() => {
    if (!active || answered || ((isWritingEntry(active) || isSelfScoredMathEntry(active)) && revealed)) return;
    const deadline = Date.now() + activeLimit * 1000;
    startedAtRef.current = Date.now();
    setSeconds(activeLimit);
    const timer = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(next);
      if (next === 0) {
        window.clearInterval(timer);
        setTimedOut(true);
        if (isWritingEntry(active) || isSelfScoredMathEntry(active)) {
          setRevealed(true);
          onSound("timeout");
        } else if (isShortAnswerEntry(active) && active.question.guidedSteps?.length) {
          void finishGuided(true);
        } else if (isShortAnswerEntry(active)) {
          void submitShortAnswer(true);
        } else {
          void answerChoice(-1, true);
        }
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [active?.question.id, activeLimit, answered, revealed]);

  useEffect(() => {
    if (!active || !isWritingEntry(active) || answered || revealed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    strokesRef.current = [];
    currentStrokeRef.current = [];
    setCanUndoStroke(false);
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      const context = canvas.getContext("2d");
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (context) {
        context.lineCap = "round";
        context.lineJoin = "round";
        context.lineWidth = 5;
        context.strokeStyle = "#17233b";
      }
      redrawStrokes();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [active?.question.id, answered, revealed]);

  const subjectStats = useMemo(() => subjectIds.map((subject) => {
    const rows = attempts.filter((attempt) => attempt.subject === subject);
    const total = questionPool.filter((entry) => entry.subject === subject).length;
    return {
      subject,
      total,
      attempted: new Set(rows.map((row) => row.questionId)).size,
      accuracy: rows.length ? Math.round(rows.filter((row) => row.isCorrect).length / rows.length * 100) : 0,
    };
  }), [attempts, questionPool]);

  const neglectedSubjects = useMemo(() => {
    const available = subjectStats.filter((row) => row.total > 0);
    const max = Math.max(...available.map((row) => row.attempted), 0);
    if (max === 0) return new Set<BasicSubject>();
    const average = available.reduce((sum, row) => sum + row.attempted, 0) / available.length;
    const threshold = Math.max(1, Math.round(average * 0.5));
    return new Set(available.filter((row) => row.attempted < threshold).map((row) => row.subject));
  }, [subjectStats]);

  function prioritizeQuestions(pool: ActiveQuestion[]) {
    const latest = new Map<string, BasicAttempt>();
    attempts.forEach((attempt) => {
      if (!latest.has(attempt.questionId)) latest.set(attempt.questionId, attempt);
    });
    const retry = shuffle(pool.filter((item) => latest.get(item.question.id)?.isCorrect === false));
    const unattempted = shuffle(pool.filter((item) => !latest.has(item.question.id)));
    const correct = shuffle(pool.filter((item) => latest.get(item.question.id)?.isCorrect === true));
    return [...retry, ...unattempted, ...correct];
  }

  function beginSession(nextSession: ActiveQuestion[]) {
    if (!nextSession.length) return;
    setSession(nextSession);
    setIndex(0);
    setAnswered(false);
    setRevealed(false);
    setSelectedIndex(null);
    setTimedOut(false);
    setAnswers([]);
    setAward(null);
    setFinished(false);
    setCompletionCoins(0);
    setAiState("idle");
    setAiResult(null);
    setShortAnswerInput("");
    setRevealedStepCount(0);
    setGuidedIndex(0);
    setGuidedInput("");
    setGuidedSubmitted(false);
    setGuidedResults([]);
    setSeconds(clampTime(nextSession[0].question.timeLimitSeconds));
    startedAtRef.current = Date.now();
    setRoundPickerSubject(null);
    setRoundPickerSection(null);
    setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
  }

  function startBasicSession(mode: Exclude<BasicSessionMode, "subject">) {
    if (mode === "weak") {
      beginSession(prioritizeQuestions(questionPool).slice(0, 5));
      return;
    }
    beginSession(prioritizeQuestions(questionPool).slice(0, 10));
  }

  function startSubjectSession(subject: BasicSubject, round?: number, section?: string | null) {
    if (roundSubjects?.includes(subject) && round === undefined) {
      setRoundPickerSubject(subject);
      return;
    }
    const bySubject = questionPool.filter((item) => item.subject === subject && (round === undefined || item.question.round === round) && (!section || getMathSection(item.question.id) === section));
    if (round !== undefined) {
      beginSession(shuffle(bySubject));
      return;
    }
    beginSession(prioritizeQuestions(bySubject).slice(0, 5));
  }

  function redrawStrokes() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach((stroke) => {
      if (stroke.length < 2) return;
      context.beginPath();
      context.moveTo(stroke[0].x, stroke[0].y);
      stroke.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
    });
  }

  function clearCanvas() {
    strokesRef.current = [];
    currentStrokeRef.current = [];
    setCanUndoStroke(false);
    redrawStrokes();
  }

  function undoStroke() {
    if (!strokesRef.current.length) return;
    strokesRef.current = strokesRef.current.slice(0, -1);
    setCanUndoStroke(strokesRef.current.length > 0);
    redrawStrokes();
  }

  function revealAnswer() {
    setRevealed(true);
    void runAiCheck();
  }

  async function runAiCheck() {
    if (!active || !isWritingEntry(active) || !functions) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setAiState("loading");
    setAiResult(null);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const imageBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const recognize = httpsCallable<{ imageBase64: string }, { text: string }>(functions, "recognizeKanjiWriting");
      const response = await recognize({ imageBase64 });
      const recognizedText = response.data.text || "";
      const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "");
      const normalizedRecognized = normalize(recognizedText);
      const candidates = [active.question.answer, ...active.question.acceptedAnswers].map(normalize).filter(Boolean);
      const matches = candidates.some((candidate) => candidate === normalizedRecognized);
      setAiResult({ text: recognizedText, matches });
      setAiState("done");
    } catch {
      setAiState("error");
    }
  }

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const point = canvasPoint(event);
    lastPointRef.current = point;
    currentStrokeRef.current = [point];
  }

  function draw(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !lastPointRef.current) return;
    const next = canvasPoint(event);
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    lastPointRef.current = next;
    currentStrokeRef.current.push(next);
  }

  function stopDrawing() {
    drawingRef.current = false;
    lastPointRef.current = null;
    if (currentStrokeRef.current.length > 1) {
      strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
      setCanUndoStroke(true);
    }
    currentStrokeRef.current = [];
  }

  async function saveAttempt(isCorrect: boolean, wasTimedOut: boolean) {
    if (!active) return;
    const durationSeconds = wasTimedOut ? activeLimit : Math.min(activeLimit, Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)));
    const correctAnswer = isWritingEntry(active) || isShortAnswerEntry(active) ? active.question.answer : active.question.options[active.question.correctIndex] ?? "";
    const attempt: BasicAttempt = {
      clientAttemptId: crypto.randomUUID(),
      questionId: active.question.id,
      questionTitle: active.question.title,
      correctAnswer,
      subject: active.subject,
      setId: active.setId,
      isCorrect,
      durationSeconds,
      timedOut: wasTimedOut,
      createdAt: new Date().toISOString(),
    };
    const next = mergeAttempts([attempt], attempts);
    setAttempts(next);
    setAnswers((current) => [...current, isCorrect]);
    localStorage.setItem(storageKey, JSON.stringify(next));
    const nextAward = await onReward(isCorrect, wasTimedOut);
    setAward(nextAward);
    try {
      await setDoc(doc(db!, "learners", LEARNER_RECORD_ID, attemptsCollection, attempt.clientAttemptId), attempt);
      onSyncStateChange("synced");
    } catch {
      onSyncStateChange("local");
    }
  }

  async function answerChoice(choice: number, wasTimedOut = false) {
    if (!active || isWritingEntry(active) || isShortAnswerEntry(active) || answered) return;
    const isCorrect = choice === active.question.correctIndex;
    setSelectedIndex(choice);
    setAnswered(true);
    onSound(wasTimedOut ? "timeout" : isCorrect ? "correct" : "wrong");
    await saveAttempt(isCorrect, wasTimedOut);
  }

  async function submitShortAnswer(wasTimedOut = false) {
    if (!active || !isShortAnswerEntry(active) || answered) return;
    const candidates = [active.question.answer, ...active.question.acceptedAnswers].map(normalizeAnswerText).filter(Boolean);
    const isCorrect = !wasTimedOut && candidates.includes(normalizeAnswerText(shortAnswerInput));
    setAnswered(true);
    onSound(wasTimedOut ? "timeout" : isCorrect ? "correct" : "wrong");
    await saveAttempt(isCorrect, wasTimedOut);
  }

  function submitGuidedStep() {
    if (!active || !isShortAnswerEntry(active) || answered || guidedSubmitted) return;
    const steps = active.question.guidedSteps;
    if (!steps) return;
    const step = steps[guidedIndex];
    const candidates = [step.answer, ...step.acceptedAnswers].map(normalizeAnswerText).filter(Boolean);
    const isCorrect = candidates.includes(normalizeAnswerText(guidedInput));
    setGuidedSubmitted(true);
    setGuidedResults((current) => [...current, isCorrect]);
    onSound(isCorrect ? "correct" : "wrong");
  }

  async function finishGuided(wasTimedOut = false) {
    if (!active || !isShortAnswerEntry(active) || answered) return;
    const steps = active.question.guidedSteps ?? [];
    const allCorrect = !wasTimedOut && guidedResults.length === steps.length && guidedResults.every(Boolean);
    setAnswered(true);
    onSound(wasTimedOut ? "timeout" : allCorrect ? "correct" : "wrong");
    await saveAttempt(allCorrect, wasTimedOut);
  }

  function advanceGuidedStep() {
    if (!active || !isShortAnswerEntry(active)) return;
    const steps = active.question.guidedSteps ?? [];
    if (guidedIndex + 1 < steps.length) {
      setGuidedIndex((current) => current + 1);
      setGuidedInput("");
      setGuidedSubmitted(false);
    } else {
      void finishGuided(false);
    }
  }

  async function scoreSelfGraded(isCorrect: boolean) {
    if (!active || !isSelfScoredMathEntry(active) || answered) return;
    setAnswered(true);
    onSound(isCorrect ? "correct" : "wrong");
    await saveAttempt(isCorrect, timedOut);
  }

  async function scoreKanji(isCorrect: boolean) {
    if (!active || !isWritingEntry(active) || answered) return;
    setAnswered(true);
    onSound(isCorrect ? "correct" : "wrong");
    await saveAttempt(isCorrect, timedOut);
  }

  async function nextQuestion() {
    if (index >= session.length - 1) {
      onSound("finish");
      const finalCorrect = answers.filter(Boolean).length;
      const bonus = await onComplete(finalCorrect, session.length);
      setCompletionCoins(bonus);
      setFinished(true);
      return;
    }
    onSound("next");
    setIndex((current) => current + 1);
    setAnswered(false);
    setRevealed(false);
    setSelectedIndex(null);
    setTimedOut(false);
    setAward(null);
    setAiState("idle");
    setAiResult(null);
    setShortAnswerInput("");
    setRevealedStepCount(0);
    setGuidedIndex(0);
    setGuidedInput("");
    setGuidedSubmitted(false);
    setGuidedResults([]);
    const next = session[index + 1];
    setSeconds(clampTime(next.question.timeLimitSeconds));
    startedAtRef.current = Date.now();
  }

  function stopSession() {
    setSession([]);
    setIndex(0);
    setAnswered(false);
    setRevealed(false);
    setSelectedIndex(null);
    setAnswers([]);
    setFinished(false);
    setAward(null);
    setRoundPickerSubject(null);
    setRoundPickerSection(null);
  }

  const timerClass = seconds <= 5 ? "danger" : seconds <= 10 ? "warning" : "";
  const shortAnswerCorrect = active && isShortAnswerEntry(active)
    ? [active.question.answer, ...active.question.acceptedAnswers].map(normalizeAnswerText).filter(Boolean).includes(normalizeAnswerText(shortAnswerInput))
    : false;
  const guidedAllCorrect = active && isShortAnswerEntry(active) && active.question.guidedSteps?.length
    ? guidedResults.length === active.question.guidedSteps.length && guidedResults.every(Boolean)
    : false;

  return (
    <section id={sectionId} className="basic-training section-shell">
      <div className="section-title-row basic-title-row">
        <div><span className="section-kicker">{kicker}</span><h2>{heading}</h2></div>
        <p>{description}</p>
      </div>

      {!session.length ? (
        <div className="practice-empty basic-practice-menu">
          <div className="empty-icon"><BookOpenCheck size={30} /></div>
          <h3>{menuTitle}</h3>
          <p>{menuDescription}</p>
          <div className="empty-actions">
            <button className="primary-button" type="button" onClick={() => startBasicSession("weak")}><Sparkles size={18} /> 弱点から5問</button>
            <button className="secondary-button" type="button" onClick={() => startBasicSession("balanced")}>全科目から10問</button>
          </div>
          <div id={`${sectionId}-subject-picker`} className="domain-picker basic-subject-picker">
            <div><strong>科目を選んで5問</strong><small>直近の誤答と未挑戦を優先します</small></div>
            <div className="domain-picker-grid">
              {subjectStats.map((row) => <button key={row.subject} type="button" disabled={!row.total} onClick={() => startSubjectSession(row.subject)}><span>{row.subject === "kanji" || row.subject === "checkTestKanji" ? <PencilLine size={16} /> : row.subject === "geography" ? <MapIcon size={16} /> : <BookOpenCheck size={16} />} {BASIC_SUBJECT_LABELS[row.subject]}</span><small>{row.total ? (roundSubjects?.includes(row.subject) ? "回を選んで練習" : `${row.attempted}/${row.total}問挑戦・正答率${row.accuracy}%`) : "問題準備中"}{neglectedSubjects.has(row.subject) && <em className="subject-recommend">・おすすめ</em>}</small></button>)}
            </div>
            {roundPickerSubject && roundOptions && (
              <div className="round-picker">
                <div className="round-picker-heading"><strong>{BASIC_SUBJECT_LABELS[roundPickerSubject]}：回を選ぶ</strong><button type="button" className="round-picker-back" onClick={() => setRoundPickerSubject(null)}>戻る</button></div>
                {roundPickerSubject === "checkTestMath" && (
                  <div className="section-picker">
                    <button type="button" className={!roundPickerSection ? "active" : ""} onClick={() => setRoundPickerSection(null)}>全部</button>
                    {Object.keys(MATH_SECTION_LABELS).map((section) => (
                      <button key={section} type="button" className={roundPickerSection === section ? "active" : ""} onClick={() => setRoundPickerSection(section)}>{section}</button>
                    ))}
                  </div>
                )}
                <div className="domain-picker-grid round-picker-grid">
                  {roundOptions.filter((round) => round <= Math.max(0, ...questionPool.filter((item) => item.subject === roundPickerSubject).map((item) => item.question.round ?? 0))).map((round) => {
                    const count = questionPool.filter((item) => item.subject === roundPickerSubject && item.question.round === round && (!roundPickerSection || getMathSection(item.question.id) === roundPickerSection)).length;
                    return <button key={round} type="button" disabled={!count} onClick={() => startSubjectSession(roundPickerSubject, round, roundPickerSection)}><span>第{round}回</span><small>{count ? `${count}問` : "準備中"}</small></button>;
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : finished ? (
        <div className="basic-result-panel">
          <Trophy size={42} />
          <span className="section-kicker">{resultKicker}</span>
          <h3>{new Set(session.map((item) => item.subject)).size === 1 ? `${BASIC_SUBJECT_LABELS[session[0].subject]}：` : "全科目："}{session.length}問中 {correctCount}問できた！</h3>
          <p>完了ボーナスとしてコインを{completionCoins}枚獲得しました。</p>
          <div className="empty-actions"><button className="primary-button" type="button" onClick={() => startBasicSession("weak")}><RotateCcw size={18} /> 弱点からもう5問</button><button className="secondary-button" type="button" onClick={stopSession}>メニューへ戻る</button></div>
          <div className="domain-picker result-domain-picker basic-subject-picker">
            <div><strong>次は科目を選んで5問</strong><small>直近の誤答と未挑戦を優先します</small></div>
            <div className="domain-picker-grid">
              {subjectStats.map((row) => <button key={row.subject} type="button" disabled={!row.total} onClick={() => startSubjectSession(row.subject)}><span>{BASIC_SUBJECT_LABELS[row.subject]}</span><small>{row.total ? `${row.total}問登録` : "問題準備中"}{neglectedSubjects.has(row.subject) && <em className="subject-recommend">・おすすめ</em>}</small></button>)}
            </div>
          </div>
        </div>
      ) : active ? (
        <div className="basic-session">
          <div className="basic-session-hud">
            <div><span>{BASIC_SUBJECT_LABELS[active.subject]}</span><strong>{index + 1} / {session.length}</strong></div>
            <div className="basic-progress"><span style={{ width: `${((index + 1) / session.length) * 100}%` }} /></div>
            <button type="button" onClick={stopSession}>中断する</button>
          </div>
          <article className="basic-question-card">
            <div className="basic-question-heading">
              <div><h3>{active.question.title}</h3><span>{isWritingEntry(active) || isShortAnswerEntry(active) ? active.question.category : active.subject === "geography" ? GEOGRAPHY_TOPIC_LABELS[active.question.topic] ?? active.question.subtopic : active.question.subtopic || active.question.topic}</span></div>
              <div className={`question-timer ${timerClass}`}><Timer size={18} /><strong>{seconds}</strong><span>秒</span></div>
            </div>
            <div className={`question-time-track ${timerClass}`}><span style={{ width: `${seconds / activeLimit * 100}%` }} /></div>

            {isWritingEntry(active) ? (
              <>
                <p className="kanji-instruction">【　】のひらがなを、漢字で書きましょう。</p>
                <div className="kanji-sentence">{renderKanjiSentence(active.question.sentence)}</div>
                {!revealed ? (
                  <div className="kanji-writing-row">
                    <div className="writing-board"><canvas ref={canvasRef} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} /><div className="writing-board-actions"><button type="button" onClick={undoStroke} disabled={!canUndoStroke}><Undo2 size={17} />一画前を消す</button><button type="button" onClick={clearCanvas}><Eraser size={17} />消す</button></div></div>
                    <button className="primary-button reveal-answer-button" type="button" onClick={revealAnswer}>答えを<br />見る</button>
                  </div>
                ) : (
                  <div className="kanji-answer-panel">
                    {timedOut && <small className="timeup-label">TIME UP</small>}
                    <span>答え</span><strong>{active.question.answer}</strong>
                    <div className="kanji-ai-readout">
                      {aiState === "loading" && <span className="kanji-ai-badge loading">AI判定中…</span>}
                      {aiState === "error" && <span className="kanji-ai-badge neutral">AI判定に失敗しました</span>}
                      {aiState === "done" && aiResult && (aiResult.text
                        ? <span className={`kanji-ai-badge ${aiResult.matches ? "match" : "mismatch"}`}>{aiResult.matches ? <Check size={16} /> : <X size={16} />}AIの判定：{aiResult.matches ? "○正解" : "×不正解"}</span>
                        : <span className="kanji-ai-badge neutral">文字を読み取れませんでした</span>)}
                      {aiState === "done" && aiResult?.text && <small className="kanji-ai-text">読み取った文字：{aiResult.text}</small>}
                    </div>
                    <p>{active.question.explanation}</p>
                    {!answered ? <div><button type="button" className="self-score correct" onClick={() => void scoreKanji(true)}><Check size={20} />できた</button><button type="button" className="self-score wrong" onClick={() => void scoreKanji(false)}><X size={20} />まちがえた</button></div> : <button className="next-button" type="button" onClick={() => void nextQuestion()}>{index === session.length - 1 ? "結果を見る" : "次の問題"}<ChevronRight size={18} /></button>}
                  </div>
                )}
              </>
            ) : isShortAnswerEntry(active) ? (
              <>
                {active.question.context && <div className="question-context">{active.question.context}</div>}
                <p className="question-prompt">{active.question.prompt}</p>
                {active.question.imageUrl && (
                  <div className="question-diagram">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={active.question.imageUrl} alt="問題の図" />
                  </div>
                )}
                {isSelfScoredMathEntry(active) ? (
                  <div className="math-walkthrough">
                    {active.question.steps && active.question.steps.length > 0 && (
                      <div className="step-reveal">
                        {active.question.steps.slice(0, revealedStepCount).map((step, stepIndex) => (
                          <p className="step-reveal-line" key={stepIndex}>{step}</p>
                        ))}
                      </div>
                    )}
                    {!revealed && (
                      <button
                        type="button"
                        className="step-reveal-button reveal-answer-button"
                        onClick={() => {
                          const steps = active.question.steps ?? [];
                          if (revealedStepCount < steps.length) setRevealedStepCount((count) => count + 1);
                          else setRevealed(true);
                        }}
                      >
                        {active.question.steps && revealedStepCount < active.question.steps.length
                          ? `次の途中式を見る（${revealedStepCount}/${active.question.steps.length}）`
                          : "答えを見る"}
                      </button>
                    )}
                    {revealed && (
                    <div className="math-answer-panel">
                      {timedOut && <small className="timeup-label">TIME UP</small>}
                      <p className="math-final-answer">答え<strong>{active.question.answer}</strong></p>
                      <p className="math-explanation">{active.question.explanation}</p>
                      {!answered ? (
                        <div className="self-score-row">
                          <button type="button" className="self-score correct" onClick={() => void scoreSelfGraded(true)}><Check size={20} />わかった</button>
                          <button type="button" className="self-score wrong" onClick={() => void scoreSelfGraded(false)}><X size={20} />もう一度</button>
                        </div>
                      ) : (
                        <button className="next-button" type="button" onClick={() => void nextQuestion()}>{index === session.length - 1 ? "結果を見る" : "次の問題"}<ChevronRight size={18} /></button>
                      )}
                    </div>
                    )}
                  </div>
                ) : (
                  <>
                    {active.question.guidedSteps && active.question.guidedSteps.length > 0 ? (
                      <>
                        {!answered && (
                          <div className="guided-step">
                            <div className="guided-step-heading">ステップ {guidedIndex + 1} / {active.question.guidedSteps.length}</div>
                            <p className="guided-step-expression">{active.question.guidedSteps[guidedIndex].expression} を計算しましょう</p>
                            <div className="short-answer-row">
                              <input
                                type="text"
                                inputMode="numeric"
                                className="short-answer-input"
                                placeholder="答えを入力"
                                value={guidedInput}
                                disabled={guidedSubmitted}
                                onChange={(event) => setGuidedInput(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter") return;
                                  if (!guidedSubmitted && guidedInput.trim()) submitGuidedStep();
                                  else if (guidedSubmitted) advanceGuidedStep();
                                }}
                              />
                              {!guidedSubmitted ? (
                                <button className="primary-button" type="button" disabled={!guidedInput.trim()} onClick={submitGuidedStep}>こたえる</button>
                              ) : (
                                <button className="primary-button" type="button" onClick={advanceGuidedStep}>
                                  {guidedIndex + 1 === active.question.guidedSteps.length ? "けっかを見る" : "次のステップ"}
                                  <ChevronRight size={16} />
                                </button>
                              )}
                            </div>
                            {guidedSubmitted && (
                              <div className={`basic-feedback ${guidedResults[guidedResults.length - 1] ? "good" : "retry"}`}>
                                <div><strong>{guidedResults[guidedResults.length - 1] ? "正解！" : "ここを確認"}</strong></div>
                                <p className="short-answer-correct">正解：{active.question.guidedSteps[guidedIndex].answer}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {active.question.steps && active.question.steps.length > 0 && (
                          <div className="step-reveal">
                            {active.question.steps.slice(0, revealedStepCount).map((step, stepIndex) => (
                              <p className="step-reveal-line" key={stepIndex}>{step}</p>
                            ))}
                            {revealedStepCount < active.question.steps.length && (
                              <button
                                type="button"
                                className="step-reveal-button"
                                onClick={() => setRevealedStepCount((count) => count + 1)}
                              >
                                途中式を見る（{revealedStepCount}/{active.question.steps.length}）
                              </button>
                            )}
                          </div>
                        )}
                        <div className="short-answer-row">
                          <input
                            type="text"
                            inputMode="numeric"
                            className="short-answer-input"
                            placeholder="答えを入力"
                            value={shortAnswerInput}
                            disabled={answered}
                            onChange={(event) => setShortAnswerInput(event.target.value)}
                            onKeyDown={(event) => { if (event.key === "Enter" && shortAnswerInput.trim() && !answered) void submitShortAnswer(); }}
                          />
                          <button className="primary-button" type="button" disabled={!shortAnswerInput.trim() || answered} onClick={() => void submitShortAnswer()}>こたえる</button>
                        </div>
                      </>
                    )}
                    {answered && (
                      <div className={`basic-feedback ${(active.question.guidedSteps?.length ? guidedAllCorrect : shortAnswerCorrect) ? "good" : "retry"}`}>
                        <div><strong>{timedOut ? "時間切れ" : (active.question.guidedSteps?.length ? guidedAllCorrect : shortAnswerCorrect) ? "正解！" : "ここを確認"}</strong>{award && <span>+{award.xp} XP・+{award.coins} COIN</span>}</div>
                        <p className="short-answer-correct">正解：{active.question.answer}</p>
                        <p>{active.question.explanation}</p>
                        <button className="next-button" type="button" onClick={() => void nextQuestion()}>{index === session.length - 1 ? "結果を見る" : "次の問題"}<ChevronRight size={18} /></button>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                {active.question.context && <div className="question-context">{active.question.context}</div>}
                <p className="question-prompt">{active.question.prompt}</p>
                {active.question.imageUrl && (
                  <div className="question-diagram">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={active.question.imageUrl} alt="問題の図" />
                  </div>
                )}
                <div className="options basic-options">{active.question.options.map((option, optionIndex) => {
                  const correct = answered && optionIndex === active.question.correctIndex;
                  const wrong = answered && optionIndex === selectedIndex && !correct;
                  return <button key={option} type="button" className={`option ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`} disabled={answered} onClick={() => void answerChoice(optionIndex)}><span className="option-letter">{String.fromCharCode(65 + optionIndex)}</span><span>{option}</span>{correct && <Check size={20} />}{wrong && <X size={20} />}</button>;
                })}</div>
                {answered && <div className={`basic-feedback ${selectedIndex === active.question.correctIndex ? "good" : "retry"}`}><div><strong>{selectedIndex === -1 ? "時間切れ" : selectedIndex === active.question.correctIndex ? "正解！" : "ここを確認"}</strong>{award && <span>+{award.xp} XP・+{award.coins} COIN</span>}</div><p>{active.question.explanation}</p><button className="next-button" type="button" onClick={() => void nextQuestion()}>{index === session.length - 1 ? "結果を見る" : "次の問題"}<ChevronRight size={18} /></button></div>}
              </>
            )}
            {isWritingEntry(active) && answered && award && <div className="basic-award">{award.label}・+{award.xp} XP・+{award.coins} COIN</div>}
          </article>
        </div>
      ) : null}
    </section>
  );
}
