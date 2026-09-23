# v9 のデプロイ手順

Cloud Shell の `aichi-jh-training-deploy` フォルダで次を実行してください。

```bash
unzip -o aichi-jh-training-revised-v9.zip
npx firebase-tools deploy --only hosting --project aichi-jh-training-507310
```

デプロイ後、保護者アカウントでサイトを開き、「問題を一括追加」の右側にある「○問をJSON出力」を押してください。

## v9 の変更点

- 登録済みの全問題をインポート互換JSONとして出力
- 重複チェックしやすいよう問題をID順に整列
- 出力ファイル名に日本時間の年月日・時分秒を付与
- Firestoreとの同期が完了するまで出力ボタンを無効化
