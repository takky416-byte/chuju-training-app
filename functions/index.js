const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { ImageAnnotatorClient } = require("@google-cloud/vision");
const nodemailer = require("nodemailer");

initializeApp();

const db = getFirestore();
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");
const visionClient = new ImageAnnotatorClient();

const LEARNER_RECORD_ID = "69b4e9b0e95a3cb3c9a3ecdf7cc12468f707634f698e879f3c7c636481cd0960";
const SENDER = "takky416@gmail.com";
const RECIPIENTS = ["takky416@gmail.com", "analog3006@gmail.com"];
const FAMILY_EMAILS = ["takky416@gmail.com", "analog3006@gmail.com", "aratasan0204@gmail.com"];
const SITE_URL = "https://aichi-jh-training-507310.web.app";
const DOMAINS = ["数量・図形", "文章・ことば", "表・グラフ", "理科・観察", "社会・生活", "論理・ルール"];
const BASIC_SUBJECT_LABELS = {
  kanji: "漢字の書き",
  vocabulary: "語句",
  kanjiReading: "漢字の読み",
  geography: "地理",
  history: "歴史",
  biology: "生物",
  earthScience: "地学",
  physics: "物理",
  chemistry: "化学",
};
const DOMAIN_ALIASES = {
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

function normalizeDomain(value) {
  return DOMAIN_ALIASES[value] || value || "その他";
}

function masteryState(rows) {
  const latest = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!latest.length) return "unattempted";
  if (latest[0].isCorrect && latest[1]?.isCorrect) return "mastered";
  if (latest[0].isCorrect) return "done";
  return "practicing";
}

function groupAttempts(rows) {
  const grouped = new Map();
  rows.forEach((attempt) => grouped.set(attempt.questionId, [...(grouped.get(attempt.questionId) || []), attempt]));
  return grouped;
}

function bestCorrectStreak(rows) {
  let current = 0;
  let best = 0;
  [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach((attempt) => {
    current = attempt.isCorrect ? current + 1 : 0;
    best = Math.max(best, current);
  });
  return best;
}

function formatJst(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function reportKey(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderReport({ periodStart, periodEnd, rows, aptitudeRows, basicRows, correct, streak, newlyDone, newlyMastered, domainRows, subjectRows, wrongTitles }) {
  const hasActivity = rows.length > 0;
  const period = `${formatJst(periodStart)}〜${formatJst(periodEnd)}`;
  const subject = hasActivity
    ? `【学習レポート】1日で${rows.length}問に挑戦`
    : "【学習レポート】今日は演習なし";
  const domainText = domainRows.length
    ? domainRows.map((row) => `・${row.domain}：${row.attempts}問／${row.correct}問正解`).join("\n")
    : "・演習なし";
  const subjectText = subjectRows.length
    ? subjectRows.map((row) => `・${row.subject}：${row.attempts}問／${row.correct}問正解`).join("\n")
    : "・演習なし";
  const wrongText = wrongTitles.length ? wrongTitles.map((title) => `・${title}`).join("\n") : "・なし";
  const text = [
    "中学受験トレーニング 1日の学習レポート",
    period,
    "",
    hasActivity ? `挑戦 ${rows.length}問／正解 ${correct}問／最高 ${streak}問連続正解` : "この24時間の演習はありませんでした。",
    `適性検査 ${aptitudeRows.length}問／基礎トレ ${basicRows.length}問`,
    `新しく「できた」 ${newlyDone.length}問／新しく「身についた」 ${newlyMastered.length}問`,
    "",
    "適性検査・分野別",
    domainText,
    "",
    "基礎トレ・科目別",
    subjectText,
    "",
    "間違えた問題",
    wrongText,
    "",
    `サイトを開く：${SITE_URL}`,
  ].join("\n");

  const domainHtml = domainRows.length
    ? domainRows.map((row) => `<li><strong>${escapeHtml(row.domain)}</strong>：${row.attempts}問／${row.correct}問正解</li>`).join("")
    : "<li>演習なし</li>";
  const subjectHtml = subjectRows.length
    ? subjectRows.map((row) => `<li><strong>${escapeHtml(row.subject)}</strong>：${row.attempts}問／${row.correct}問正解</li>`).join("")
    : "<li>演習なし</li>";
  const wrongHtml = wrongTitles.length
    ? wrongTitles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")
    : "<li>なし</li>";
  const html = `
    <div style="max-width:640px;margin:auto;padding:24px;color:#17233b;font-family:-apple-system,BlinkMacSystemFont,'Yu Gothic',sans-serif;line-height:1.7">
      <h1 style="margin:0 0 4px;font-size:22px;color:#102847">1日の学習レポート</h1>
      <p style="margin:0 0 22px;color:#667085;font-size:13px">${escapeHtml(period)}</p>
      ${hasActivity ? `
        <div style="display:flex;gap:8px;margin-bottom:18px">
          <div style="flex:1;padding:14px;background:#f4f6f9;border-radius:8px"><strong style="font-size:24px">${rows.length}</strong><br><span style="font-size:12px">挑戦</span></div>
          <div style="flex:1;padding:14px;background:#e6f3f0;border-radius:8px"><strong style="font-size:24px">${correct}</strong><br><span style="font-size:12px">正解</span></div>
          <div style="flex:1;padding:14px;background:#e9eef6;border-radius:8px"><strong style="font-size:24px">${streak}</strong><br><span style="font-size:12px">最高連続正解</span></div>
        </div>` : '<p style="padding:16px;background:#f4f6f9;border-radius:8px">この24時間の演習はありませんでした。</p>'}
      <p style="margin:0 0 14px;color:#52606f;font-size:13px">適性検査 <strong>${aptitudeRows.length}問</strong>　／　基礎トレ <strong>${basicRows.length}問</strong></p>
      <p style="padding:14px 16px;background:#fff3d8;border-left:4px solid #e8a735;border-radius:6px">
        新しく「できた」 <strong>${newlyDone.length}問</strong>　／　新しく「身についた」 <strong>${newlyMastered.length}問</strong>
      </p>
      <h2 style="margin:24px 0 8px;font-size:16px">適性検査・分野別</h2><ul style="margin:0;padding-left:22px">${domainHtml}</ul>
      <h2 style="margin:24px 0 8px;font-size:16px">基礎トレ・科目別</h2><ul style="margin:0;padding-left:22px">${subjectHtml}</ul>
      <h2 style="margin:24px 0 8px;font-size:16px">間違えた問題</h2><ul style="margin:0;padding-left:22px">${wrongHtml}</ul>
      <a href="${SITE_URL}" style="display:inline-block;margin-top:26px;padding:12px 18px;color:white;background:#17345f;border-radius:7px;text-decoration:none;font-weight:700">学習サイトを開く</a>
    </div>`;
  return { subject, text, html };
}

exports.sendDailyLearningReport = onSchedule({
  schedule: "30 21 * * *",
  timeZone: "Asia/Tokyo",
  region: "asia-northeast1",
  secrets: [gmailAppPassword],
}, async () => {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);
  const key = reportKey(periodEnd);
  const reportRef = db.collection("dailyReports").doc(key);
  const now = Date.now();

  const shouldSend = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reportRef);
    const data = snapshot.data();
    if (data?.status === "sent") return false;
    const processingAt = data?.processingAt?.toMillis?.() || 0;
    if (data?.status === "processing" && now - processingAt < 15 * 60 * 1000) return false;
    transaction.set(reportRef, {
      status: "processing",
      processingAt: FieldValue.serverTimestamp(),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    }, { merge: true });
    return true;
  });
  if (!shouldSend) return;

  try {
    const [attemptSnapshot, basicAttemptSnapshot, questionSnapshot, basicQuestionSnapshot] = await Promise.all([
      db.collection("learners").doc(LEARNER_RECORD_ID).collection("attempts").get(),
      db.collection("learners").doc(LEARNER_RECORD_ID).collection("basicAttempts").get(),
      db.collection("questionBank").get(),
      db.collection("basicQuestionBank").get(),
    ]);
    const questions = new Map(questionSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
    const basicQuestions = new Map(basicQuestionSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
    const allAptitudeAttempts = attemptSnapshot.docs.map((doc) => ({
      ...doc.data(),
      track: "aptitude",
      questionId: doc.data().questionId || "",
      domain: normalizeDomain(doc.data().domain),
      createdAt: doc.data().createdAt || "",
      isCorrect: doc.data().isCorrect === true,
    })).filter((attempt) => attempt.questionId && attempt.createdAt && attempt.createdAt < periodEnd.toISOString());
    const allBasicAttempts = basicAttemptSnapshot.docs.map((doc) => ({
      ...doc.data(),
      track: "basic",
      questionId: doc.data().questionId || "",
      subject: doc.data().subject || "",
      questionTitle: doc.data().questionTitle || "",
      createdAt: doc.data().createdAt || "",
      isCorrect: doc.data().isCorrect === true,
    })).filter((attempt) => attempt.questionId && attempt.createdAt && attempt.createdAt < periodEnd.toISOString());
    const aptitudeRows = allAptitudeAttempts.filter((attempt) => attempt.createdAt >= periodStart.toISOString());
    const basicRows = allBasicAttempts.filter((attempt) => attempt.createdAt >= periodStart.toISOString());
    const rows = [...aptitudeRows, ...basicRows];
    const correct = rows.filter((attempt) => attempt.isCorrect).length;

    const beforeAptitudeGrouped = groupAttempts(allAptitudeAttempts.filter((attempt) => attempt.createdAt < periodStart.toISOString()));
    const currentAptitudeGrouped = groupAttempts(allAptitudeAttempts);
    const beforeBasicGrouped = groupAttempts(allBasicAttempts.filter((attempt) => attempt.createdAt < periodStart.toISOString()));
    const currentBasicGrouped = groupAttempts(allBasicAttempts);
    const newlyDone = [];
    const newlyMastered = [];
    currentAptitudeGrouped.forEach((attempts, questionId) => {
      const question = questions.get(questionId);
      const before = masteryState(beforeAptitudeGrouped.get(questionId) || []);
      const current = masteryState(attempts);
      if (current === "done" && before !== "done" && before !== "mastered") newlyDone.push(question?.title || questionId);
      if (current === "mastered" && before !== "mastered") newlyMastered.push(question?.title || questionId);
    });
    currentBasicGrouped.forEach((attempts, questionId) => {
      const question = basicQuestions.get(questionId);
      const title = question?.title || attempts[0]?.questionTitle || questionId;
      const before = masteryState(beforeBasicGrouped.get(questionId) || []);
      const current = masteryState(attempts);
      if (current === "done" && before !== "done" && before !== "mastered") newlyDone.push(title);
      if (current === "mastered" && before !== "mastered") newlyMastered.push(title);
    });

    const domainRows = DOMAINS.map((domain) => {
      const attempts = rows.filter((attempt) => attempt.domain === domain);
      return { domain, attempts: attempts.length, correct: attempts.filter((attempt) => attempt.isCorrect).length };
    }).filter((row) => row.attempts > 0);
    const subjectRows = Object.entries(BASIC_SUBJECT_LABELS).map(([subject, label]) => {
      const attempts = basicRows.filter((attempt) => attempt.subject === subject);
      return { subject: label, attempts: attempts.length, correct: attempts.filter((attempt) => attempt.isCorrect).length };
    }).filter((row) => row.attempts > 0);
    const wrongAptitudeTitles = aptitudeRows
      .filter((attempt) => !attempt.isCorrect)
      .map((attempt) => `【適性検査】${questions.get(attempt.questionId)?.title || attempt.questionId}`);
    const wrongBasicTitles = basicRows
      .filter((attempt) => !attempt.isCorrect)
      .map((attempt) => `【基礎・${BASIC_SUBJECT_LABELS[attempt.subject] || attempt.subject}】${basicQuestions.get(attempt.questionId)?.title || attempt.questionTitle || attempt.questionId}`);
    const wrongTitles = [...new Set([...wrongAptitudeTitles, ...wrongBasicTitles])];
    const message = renderReport({
      periodStart,
      periodEnd,
      rows,
      aptitudeRows,
      basicRows,
      correct,
      streak: bestCorrectStreak(rows),
      newlyDone,
      newlyMastered,
      domainRows,
      subjectRows,
      wrongTitles,
    });

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: SENDER, pass: gmailAppPassword.value() },
    });
    const result = await transporter.sendMail({
      from: `中学受験トレーニング <${SENDER}>`,
      to: RECIPIENTS.join(","),
      ...message,
    });
    await reportRef.set({
      status: "sent",
      sentAt: FieldValue.serverTimestamp(),
      messageId: result.messageId,
      recipients: RECIPIENTS,
      attemptCount: rows.length,
      aptitudeAttemptCount: aptitudeRows.length,
      basicAttemptCount: basicRows.length,
    }, { merge: true });
  } catch (error) {
    await reportRef.set({
      status: "failed",
      failedAt: FieldValue.serverTimestamp(),
      error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
    }, { merge: true });
    throw error;
  }
});

const MAX_HANDWRITING_IMAGE_BASE64_LENGTH = 2_000_000;

exports.recognizeKanjiWriting = onCall({
  region: "asia-northeast1",
}, async (request) => {
  const email = request.auth?.token?.email;
  if (!email || !FAMILY_EMAILS.includes(email)) {
    throw new HttpsError("permission-denied", "許可されていないアカウントです。");
  }

  const imageBase64 = request.data?.imageBase64;
  if (typeof imageBase64 !== "string" || !imageBase64) {
    throw new HttpsError("invalid-argument", "画像データがありません。");
  }
  if (imageBase64.length > MAX_HANDWRITING_IMAGE_BASE64_LENGTH) {
    throw new HttpsError("invalid-argument", "画像データが大きすぎます。");
  }

  try {
    const [result] = await visionClient.documentTextDetection({
      image: { content: Buffer.from(imageBase64, "base64") },
      imageContext: { languageHints: ["ja"] },
    });
    const text = (result.fullTextAnnotation?.text || "").replace(/\s+/g, "");
    return { text };
  } catch (error) {
    throw new HttpsError("internal", "文字認識に失敗しました。");
  }
});
