# v13 のデプロイ手順

```bash
unzip -o aichi-jh-training-revised-v13.zip
npx firebase-tools deploy --only hosting,firestore:rules --project aichi-jh-training-507310
```

## 変更内容

- 分野別成果が最新500件より古くなると「未挑戦」に戻る問題を修正
- 初回起動時に過去の解答履歴全体から問題ごとの成果を自動復元
- 問題ごとの挑戦回数、正解回数、直近結果をFirestoreへ累積保存
- 履歴リセット後は残った履歴から分野別成果を自動再集計
- 問題、履歴、コイン、経験値、コレクションは削除せず引き継ぎ

