# v11 のデプロイ手順

Cloud Shell の `aichi-jh-training-deploy` フォルダで次を実行してください。

```bash
unzip -o aichi-jh-training-revised-v11.zip
npx firebase-tools deploy --only hosting,firestore:rules --project aichi-jh-training-507310
```

今回はコイン・ガチャ設定・コレクションをFirestoreへ保存するため、HostingとFirestoreルールを同時に反映します。

## v11 の変更点

- 1問回答、正解、3連続正解以上でコインを獲得
- 完走時とランクに応じたコインボーナスを追加
- 20コインで引ける「愛知コレクション」ガチャを追加
- 通常70%・レア25%・スーパーレア5%、10回ごとにレア以上確定
- 重複時は5コイン返却
- コレクション図鑑、所持コイン、抽選回数を端末間同期
- 保護者画面からガチャのON/OFFを設定可能
- 課金、広告、現金交換はありません
