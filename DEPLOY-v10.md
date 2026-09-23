# v10 のデプロイ手順

Cloud Shell の `aichi-jh-training-deploy` フォルダで次を実行してください。

```bash
unzip -o aichi-jh-training-revised-v10.zip
npx firebase-tools deploy --only hosting,firestore:rules --project aichi-jh-training-507310
```

今回はXP・レベル・自己ベストを端末間で同期するため、HostingとFirestoreルールを同時に反映します。

## v10 の変更点

- 演習画面上部にSTAGE・COMBO・SCOREのゲームHUDを追加
- 正解100点、タイムボーナス最大30点、連続正解ボーナスを追加
- 3連続正解以上の専用表示と効果音を追加
- 正解時の発光、不正解時の揺れ、得点ポップアップを追加
- 全問終了時にS・A・B・Cランクを表示
- 獲得XP、レベル、自己ベスト、最大コンボをFirestoreへ保存
