# v17 デプロイ手順

Cloud Shell の `~/aichi-jh-training-deploy` にZIPをアップロードしてから実行します。

```bash
unzip -o aichi-jh-training-revised-v17.zip
npx firebase-tools deploy --only hosting --project aichi-jh-training-507310
```

`Deploy complete!` と表示されたら、次のURLを再読み込みしてください。

https://aichi-jh-training-507310.web.app

## v17の変更

- トップのクイックスタートを「適性検査／中学受験 基礎トレ」の切替式に変更
- 基礎トレもトップから弱点5問・全科目10問・科目別演習を開始可能
- 学習サマリーの演習数・正解数・正答率を両トレーニングの合算に変更
- 「分野別の成果」を「分野・科目別の成果」に変更
- 適性検査6分野に加え、漢字の書き・地理の習熟状況を表示
- 最近の記録に基礎トレの解答履歴も時系列で表示
- 履歴リセットの対象件数にも基礎トレを含める

