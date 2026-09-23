# 履歴保持ホットフィックス v6.1

履歴リセット後に解いた新しい問題まで、再読み込み時に非表示になる不具合を修正しています。

Cloud ShellでZIPを展開し、Hostingだけを再反映してください。

```bash
unzip -o aichi-jh-training-hotfix-v6.1.zip
npx firebase-tools deploy --only hosting --project aichi-jh-training-507310
```

Functionsやメール設定の再登録は不要です。
