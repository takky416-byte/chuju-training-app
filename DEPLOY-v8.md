# v8 のデプロイ手順

Cloud Shell の `aichi-jh-training-deploy` フォルダで次を実行してください。

```bash
unzip -o aichi-jh-training-revised-v8.zip
npx firebase-tools deploy --only hosting --project aichi-jh-training-507310
```

デプロイ後、タブレットでサイトを再読み込みしてください。音設定から BGM と効果音をそれぞれ「小・中・大」に変更できます。設定は端末に保存されます。

## v8 の変更点

- BGM の標準音量を従来の約 2.6 倍に調整
- 効果音の標準音量を従来の約 1.8 倍に調整
- BGM と効果音に個別の音量設定（小・中・大）を追加
- 音量設定の変更時に効果音を試聴できるよう改善
