# v20 デプロイ手順（プロトタイプ）

漢字の書きの正誤判定を補助する「AI判定（プロトタイプ）」を追加しました。Cloud Vision APIで手書き文字を読み取り、参考情報として画面に表示します。**最終的な採点は引き続き「できた／まちがえた」の自己申告のままです**（AIは判定を上書きしません）。

## 事前準備（初回のみ）

Google Cloudコンソールで、このプロジェクト（`aichi-jh-training-507310`）の **Cloud Vision API** を有効化してください。

```
https://console.cloud.google.com/apis/library/vision.googleapis.com?project=aichi-jh-training-507310
```

有効化済みであれば、この手順は不要です。追加のSecret登録は不要です（Cloud Functionsの既定のサービスアカウントでVision APIを呼び出します）。

## デプロイ

```bash
npm install
npm run build
npm install --prefix functions
npx firebase-tools deploy --only hosting,functions --project aichi-jh-training-507310
```

## 変更内容

- `functions/index.js`：新しいCallable Function `recognizeKanjiWriting` を追加。許可済み3アカウントのみ利用可能。手書きキャンバスの画像をCloud Vision API（`documentTextDetection`）に送り、読み取ったテキストを返す。
- `app/basic-training.tsx`：漢字の書き問題の筆記画面に「AI判定」ボタンを追加。押すと読み取り結果を筆記欄の上に表示し、正解・別解と一致していれば緑、していなければ赤で表示する（プロトタイプ・参考用の表示のみ）。
- `app/firebase.ts`：Firebase Functionsクライアント（`asia-northeast1`）を追加。
- `app/globals.css`：筆記欄内のボタン配置とAI読み取り結果表示のスタイルを追加。既存の「消す」「答えを見る」の配置（縦向き・横向きとも）は変更していません。

## 確認項目

- 保護者・学習者アカウントでログインし、漢字の書き問題で「AI判定」ボタンが表示される
- ボタンを押すと「AIが読み取り中…」→ 読み取り結果（または「読み取れませんでした」）が表示される
- 読み取り結果が正解・別解と一致する場合は緑、しない場合は赤で表示される
- 「消す」で筆記欄を消すと、AI判定の表示も消える
- 次の問題に進むと、AI判定の表示がリセットされる
- 「できた／まちがえた」の自己採点・履歴保存は従来通り動作する（AI判定は採点に影響しない）
- 未許可アカウントからの呼び出しが拒否される（Cloud Functionsのログで`permission-denied`を確認）
- タブレット横向きの漢字問題で、筆記欄の高さと「答えを見る」ボタンの位置がこれまで通り維持される

## 精度についての注意

これはプロトタイプです。子どもの手書き文字、特に崩れた字や送り仮名のズレは正しく読み取れないことがあります。しばらく実際に使ってみて、読み取り精度が十分かどうかを確認してから、自動採点そのものに使うかどうかを判断してください。
