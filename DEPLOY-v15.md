# v15 デプロイ手順

Cloud Shell の `~/aichi-jh-training-deploy` にZIPをアップロードしてから実行します。

```bash
unzip -o aichi-jh-training-revised-v15.zip
npx firebase-tools deploy --only hosting --project aichi-jh-training-507310
```

`Deploy complete!` と表示されたら、次のURLを再読み込みしてください。

https://aichi-jh-training-507310.web.app

## v15の変更

- 問題バンクを基礎トレ込みの総数で表示
- 「全930問（適性検査830問＋基礎トレ100問）」と内訳を明示
- JSON出力の対象が適性検査問題であることを明示

