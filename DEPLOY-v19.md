# v19 デプロイ手順

Cloud ShellでZIPをアップロードし、次を実行します。

```bash
unzip -o aichi-jh-training-revised-v19.zip
npm install --prefix functions
npx firebase-tools deploy --only hosting,functions --project aichi-jh-training-507310
```

今回は日次メール関数も更新するため、`functions` を含めてデプロイしてください。既存の `GMAIL_APP_PASSWORD` はそのまま使用され、再登録は不要です。

## 確認項目

- 保護者画面に「基礎トレ ○問をJSON出力」が表示される
- 出力JSONに科目別の `collections` と全問題が含まれる
- タブレット横向きの漢字問題で、筆記欄が縦長になり「答えを見る」が右側に表示される
- 翌日21:30の日次メールに「基礎トレ・科目別」が表示される
