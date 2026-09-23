# v18 デプロイ手順

Cloud ShellでZIPをアップロードし、次を実行します。

```bash
unzip -o aichi-jh-training-revised-v18.zip
npx firebase-tools deploy --only hosting,firestore:rules --project aichi-jh-training-507310
```

デプロイ後、保護者アカウントでログインし、「問題を一括追加」に「適性検査ひな形」「漢字ひな形」「地理ひな形」の3ボタンが表示されることを確認してください。
