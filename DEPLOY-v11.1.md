# v11.1 のデプロイ手順

v11で「初期設定中です」から進まない問題を修正した差し替え版です。

```bash
unzip -o aichi-jh-training-revised-v11.1.zip
npx firebase-tools deploy --only hosting,firestore:rules --project aichi-jh-training-507310
```

FirebaseのWeb公開設定をビルドへ確実に含めるようにしました。既存の問題、履歴、経験値、Firestoreデータは変更・削除されません。
