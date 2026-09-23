# v12 のデプロイ手順

```bash
unzip -o aichi-jh-training-revised-v12.zip
npx firebase-tools deploy --only hosting,firestore:rules --project aichi-jh-training-507310
```

## 変更内容

- コレクションを28種類へ拡張
- 「名物・文化」「名所・自然」「ものづくり・交通」「愛知の偉人」の絞り込みを追加
- 同じ景品を引いたときは返金せず、所持数を `×2`、`×3` のように加算
- カプセル抽選、紙吹雪、レア度別の結果表示を追加
- 既存の所持品、コイン、経験値、履歴をそのまま引き継ぐデータ移行を追加
