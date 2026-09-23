# 修正版 v6.2 の反映手順

演習終了画面から、6分野の次の5問を直接開始できるようにした修正版です。

Cloud ShellでZIPを展開し、Hostingだけを再反映してください。

```bash
unzip -o aichi-jh-training-revised-v6.2.zip
npx firebase-tools deploy --only hosting --project aichi-jh-training-507310
```

Functionsやメール設定の再登録は不要です。
