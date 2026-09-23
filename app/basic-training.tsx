"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { BookOpenCheck, Check, ChevronRight, Eraser, Map as MapIcon, PencilLine, RotateCcw, Sparkles, Timer, Trophy, X } from "lucide-react";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  BASIC_QUESTION_POOL,
  BASIC_SUBJECT_CONFIG,
  BASIC_SUBJECT_IDS,
  GEOGRAPHY_TOPIC_LABELS,
  normalizeStoredBasicQuestion,
  type BasicQuestionEntry,
  type BasicSubject,
  type GeographyQuestion,
  type KanjiQuestion,
} from "./basic-questions";
import { db, functions, LEARNER_RECORD_ID } from "./firebase";
import type { SoundEffect } from "./audio-engine";

export type BasicAward = { xp: number; coins: number; label: string };
export type BasicStartRequest = { id: string; mode: "weak" | "balanced" | "subject"; subject?: BasicSubject };

export type BasicAttempt = {
  clientAttemptId: string;
  questionId: string;
  questionTitle?: string;
  subject: BasicSubject;
  setId: string;
  isCorrect: boolean;
  durationSeconds: number;
  timedOut?: boolean;
  createdAt: string;
};

type ActiveQuestion = BasicQuestionEntry;

type BasicSessionMode = "weak" | "balanced" | "subject";

type Props = {
  enabled: boolean;
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

const STORAGE_KEY = "aichi_training_basic_attempts_v1";

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

function readLocalAttempts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
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

export function BasicTraining({ enabled, startRequest, questionRefreshToken = 0, resetWindows, onActivityChange, onAttemptsChange, onQuestionCatalogChange, onReward, onComplete, onSound, onSyncStateChange }: Props) {
  const [attempts, setAttempts] = useState<BasicAttempt[]>([]);
  const [questionPool, setQuestionPool] = useState<ActiveQuestion[]>(BASIC_QUESTION_POOL);
  const [session, setSession] = useState<ActiveQuestion[]>([]);
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const startedAtRef = useRef(Date.now());

  const active = session[index];
  const activeLimit = active ? clampTime(active.question.timeLimitSeconds) : 20;
  const isActive = session.length > 0 && !finished;
  const correctCount = answers.filter(Boolean).length;

  useEffect(() => {
    if (!enabled) return;
    const isReset = (attempt: BasicAttempt) => resetWindows.some((window) => attempt.createdAt >= window.start && attempt.createdAt < window.end && attempt.createdAt <= window.createdAt);
    const local = readLocalAttempts().filter((attempt) => !isReset(attempt));
    setAttempts(local);
    getDocs(collection(db!, "learners", LEARNER_RECORD_ID, "basicAttempts"))
      .then((snapshot) => {
        const remote = snapshot.docs.map((row) => row.data() as BasicAttempt);
        const merged = mergeAttempts(local, remote).filter((attempt) => !isReset(attempt));
        setAttempts(merged);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      })
      .catch(() => undefined);
  }, [enabled, resetWindows]);

  useEffect(() => {
    if (!enabled) return;
    getDocs(collection(db!, "basicQuestionBank"))
      .then((snapshot) => {
        const remote = snapshot.docs.flatMap((row) => {
          const normalized = normalizeStoredBasicQuestion({ ...row.data(), id: row.id });
          return normalized ? [normalized] : [];
        });
        const merged = new Map(BASIC_QUESTION_POOL.map((entry) => [entry.question.id, entry]));
        remote.forEach((entry) => merged.set(entry.question.id, entry));
        setQuestionPool([...merged.values()]);
      })
      .catch(() => setQuestionPool(BASIC_QUESTION_POOL));
  }, [enabled, questionRefreshToken]);

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
      startSubjectSession(startRequest.subject);
      return;
    }
    if (startRequest.mode === "weak" || startRequest.mode === "balanced") startBasicSession(startRequest.mode);
  }, [startRequest?.id]);

  useEffect(() => {
    if (!active || answered || (active.subject === "kanji" && revealed)) return;
    const deadline = Date.now() + activeLimit * 1000;
    startedAtRef.current = Date.now();
    setSeconds(activeLimit);
    const timer = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(next);
      if (next === 0) {
        window.clearInterval(timer);
        setTimedOut(true);
        if (active.subject === "kanji") {
          setRevealed(true);
          onSound("timeout");
        } else {
          void answerChoice(-1, true);
        }
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [active?.question.id, activeLimit, answered, revealed]);

  useEffect(() => {
    if (active?.subject !== "kanji" || answered || revealed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [active?.question.id, answered, revealed]);

  const subjectStats = useMemo(() => BASIC_SUBJECT_IDS.map((subject) => {
    const rows = attempts.filter((attempt) => attempt.subject === subject);
    const total = questionPool.filter((entry) => entry.subject === subject).length;
    return {
      subject,
      total,
      attempted: new Set(rows.map((row) => row.questionId)).size,
      accuracy: rows.length ? Math.round(rows.filter((row) => row.isCorrect).length / rows.length * 100) : 0,
    };
  }), [attempts, questionPool]);

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
    setSeconds(clampTime(nextSession[0].question.timeLimitSeconds));
    startedAtRef.current = Date.now();
    setTimeout(() => document.getElementById("basic-training")?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
  }

  function startBasicSession(mode: Exclude<BasicSessionMode, "subject">) {
    if (mode === "weak") {
      beginSession(prioritizeQuestions(questionPool).slice(0, 5));
      return;
    }
    beginSession(prioritizeQuestions(questionPool).slice(0, 10));
  }

  function startSubjectSession(subject: BasicSubject) {
    beginSession(prioritizeQuestions(questionPool.filter((item) => item.subject === subject)).slice(0, 5));
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function revealAnswer() {
    setRevealed(true);
    void runAiCheck();
  }

  async function runAiCheck() {
    if (!active || active.subject !== "kanji" || !functions) return;
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
    lastPointRef.current = canvasPoint(event);
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
  }

  function stopDrawing() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  async function saveAttempt(isCorrect: boolean, wasTimedOut: boolean) {
    if (!active) return;
    const durationSeconds = wasTimedOut ? activeLimit : Math.min(activeLimit, Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)));
    const attempt: BasicAttempt = {
      clientAttemptId: crypto.randomUUID(),
      questionId: active.question.id,
      questionTitle: active.question.title,
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    const nextAward = await onReward(isCorrect, wasTimedOut);
    setAward(nextAward);
    try {
      await setDoc(doc(db!, "learners", LEARNER_RECORD_ID, "basicAttempts", attempt.clientAttemptId), attempt);
      onSyncStateChange("synced");
    } catch {
      onSyncStateChange("local");
    }
  }

  async function answerChoice(choice: number, wasTimedOut = false) {
    if (!active || active.subject === "kanji" || answered) return;
    const isCorrect = choice === active.question.correctIndex;
    setSelectedIndex(choice);
    setAnswered(true);
    onSound(wasTimedOut ? "timeout" : isCorrect ? "correct" : "wrong");
    await saveAttempt(isCorrect, wasTimedOut);
  }

  async function scoreKanji(isCorrect: boolean) {
    if (!active || active.subject !== "kanji" || answered) return;
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
  }

  const timerClass = seconds <= 5 ? "danger" : seconds <= 10 ? "warning" : "";

  return (
    <section id="basic-training" className="basic-training section-shell">
      <div className="section-title-row basic-title-row">
        <div><span className="section-kicker">ENTRANCE EXAM BASICS</span><h2>中学受験 基礎トレ</h2></div>
        <p>科目を横断して、または科目を選んでテンポよく。</p>
      </div>

      {!session.length ? (
        <div className="practice-empty basic-practice-menu">
          <div className="empty-icon"><BookOpenCheck size={30} /></div>
          <h3>基礎トレのメニューを選んで始めましょう</h3>
          <p>弱点優先、全科目、科目別の3つから選べます。</p>
          <div className="empty-actions">
            <button className="primary-button" type="button" onClick={() => startBasicSession("weak")}><Sparkles size={18} /> 弱点から5問</button>
            <button className="secondary-button" type="button" onClick={() => startBasicSession("balanced")}>全科目から10問</button>
          </div>
          <div id="basic-subject-picker" className="domain-picker basic-subject-picker">
            <div><strong>科目を選んで5問</strong><small>直近の誤答と未挑戦を優先します</small></div>
            <div className="domain-picker-grid">
              {subjectStats.map((row) => <button key={row.subject} type="button" disabled={!row.total} onClick={() => startSubjectSession(row.subject)}><span>{row.subject === "kanji" ? <PencilLine size={16} /> : row.subject === "geography" ? <MapIcon size={16} /> : <BookOpenCheck size={16} />} {BASIC_SUBJECT_LABELS[row.subject]}</span><small>{row.total ? `${row.attempted}/${row.total}問挑戦・正答率${row.accuracy}%` : "問題準備中"}</small></button>)}
            </div>
          </div>
        </div>
      ) : finished ? (
        <div className="basic-result-panel">
          <Trophy size={42} />
          <span className="section-kicker">BASIC TRAINING COMPLETE</span>
          <h3>{new Set(session.map((item) => item.subject)).size === 1 ? `${BASIC_SUBJECT_LABELS[session[0].subject]}：` : "全科目："}{session.length}問中 {correctCount}問できた！</h3>
          <p>完了ボーナスとしてコインを{completionCoins}枚獲得しました。</p>
          <div className="empty-actions"><button className="primary-button" type="button" onClick={() => startBasicSession("weak")}><RotateCcw size={18} /> 弱点からもう5問</button><button className="secondary-button" type="button" onClick={stopSession}>メニューへ戻る</button></div>
          <div className="domain-picker result-domain-picker basic-subject-picker">
            <div><strong>次は科目を選んで5問</strong><small>直近の誤答と未挑戦を優先します</small></div>
            <div className="domain-picker-grid">
              {subjectStats.map((row) => <button key={row.subject} type="button" disabled={!row.total} onClick={() => startSubjectSession(row.subject)}><span>{BASIC_SUBJECT_LABELS[row.subject]}</span><small>{row.total ? `${row.total}問登録` : "問題準備中"}</small></button>)}
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
              <div><h3>{active.question.title}</h3><span>{active.subject === "kanji" ? active.question.category : active.subject === "geography" ? GEOGRAPHY_TOPIC_LABELS[active.question.topic] ?? active.question.subtopic : active.question.subtopic || active.question.topic}</span></div>
              <div className={`question-timer ${timerClass}`}><Timer size={18} /><strong>{seconds}</strong><span>秒</span></div>
            </div>
            <div className={`question-time-track ${timerClass}`}><span style={{ width: `${seconds / activeLimit * 100}%` }} /></div>

            {active.subject === "kanji" ? (
              <>
                <p className="kanji-instruction">【　】のひらがなを、漢字で書きましょう。</p>
                <div className="kanji-sentence">{renderKanjiSentence(active.question.sentence)}</div>
                {!revealed ? (
                  <div className="kanji-writing-row">
                    <div className="writing-board"><canvas ref={canvasRef} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} /><button type="button" onClick={clearCanvas}><Eraser size={17} />消す</button></div>
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
            ) : (
              <>
                {active.question.context && <div className="question-context">{active.question.context}</div>}
                <p className="question-prompt">{active.question.prompt}</p>
                <div className="options basic-options">{active.question.options.map((option, optionIndex) => {
                  const correct = answered && optionIndex === active.question.correctIndex;
                  const wrong = answered && optionIndex === selectedIndex && !correct;
                  return <button key={option} type="button" className={`option ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`} disabled={answered} onClick={() => void answerChoice(optionIndex)}><span className="option-letter">{String.fromCharCode(65 + optionIndex)}</span><span>{option}</span>{correct && <Check size={20} />}{wrong && <X size={20} />}</button>;
                })}</div>
                {answered && <div className={`basic-feedback ${selectedIndex === active.question.correctIndex ? "good" : "retry"}`}><div><strong>{selectedIndex === -1 ? "時間切れ" : selectedIndex === active.question.correctIndex ? "正解！" : "ここを確認"}</strong>{award && <span>+{award.xp} XP・+{award.coins} COIN</span>}</div><p>{active.question.explanation}</p><button className="next-button" type="button" onClick={() => void nextQuestion()}>{index === session.length - 1 ? "結果を見る" : "次の問題"}<ChevronRight size={18} /></button></div>}
              </>
            )}
            {active.subject === "kanji" && answered && award && <div className="basic-award">{award.label}・+{award.xp} XP・+{award.coins} COIN</div>}
          </article>
        </div>
      ) : null}
    </section>
  );
}
