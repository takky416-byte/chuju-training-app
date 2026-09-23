# 修正版 v7 の反映手順

次の変更を含む修正版です。

- 問題文の近くに「残り○問」を大きく表示
- BGMのON／OFFと3種類（集中・たのしい・チャレンジ）の選択
- 効果音のON／OFF
- 正解・不正解・時間切れ・次の問題・全問終了の効果音
- 音設定を端末に保存

音はサイト内で生成する軽量なオリジナル電子音なので、音源ファイルの追加やライセンス表記は不要です。

Cloud ShellでZIPを展開し、Hostingだけを再反映してください。

```bash
unzip -o aichi-jh-training-revised-v7.zip
npx firebase-tools deploy --only hosting --project aichi-jh-training-507310
```

Firestore、Functions、メール設定の再登録は不要です。
