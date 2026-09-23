# v16 デプロイ手順

Cloud Shell の `~/aichi-jh-training-deploy` にZIPをアップロードしてから実行します。

```bash
unzip -o aichi-jh-training-revised-v16.zip
npx firebase-tools deploy --only hosting --project aichi-jh-training-507310
```

`Deploy complete!` と表示されたら、次のURLを再読み込みしてください。

https://aichi-jh-training-507310.web.app

## v16の変更

- 「適性検査 問題演習」と「中学受験 基礎トレ」を同じ階層の演習メニューに整理
- 基礎トレを「弱点から5問」「全科目から10問」「科目を選んで5問」に変更
- 基礎トレの科目として「漢字の書き」「地理」を表示
- セット番号を選ぶ方式を廃止し、誤答と未挑戦を優先して自動出題
- 演習終了後にも科目別出題メニューを表示
- 将来、歴史・生物などを追加しやすい科目単位の構造に整理

