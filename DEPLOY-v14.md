# v14 デプロイ手順

Cloud Shell の `~/aichi-jh-training-deploy` にZIPをアップロードしてから実行します。

```bash
unzip -o aichi-jh-training-revised-v14.zip
npx firebase-tools deploy --only hosting,firestore:rules --project aichi-jh-training-507310
```

`Deploy complete!` と表示されたら、次のURLを再読み込みしてください。

https://aichi-jh-training-507310.web.app

## v14の主な変更

- 「中学受験 基礎トレ」を追加
- 漢字の書き50問（5セット）を搭載
- 地理50問（5セット）を搭載
- 漢字はタブレット手書き・自己採点に対応
- 地理は2×2の四択表示に対応
- 基礎トレの履歴を端末間で同期
- 基礎トレでも経験値とコインを獲得
- ガチャを既存28種から54種へ拡張
- ご当地・ものづくり・人物の3種類から選択可能
- 既存の獲得状況と重複回数を引き継ぎ
