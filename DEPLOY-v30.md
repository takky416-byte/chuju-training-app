# v30 デプロイ手順

v29からの変更です。コード（hosting）のみの変更で、Firestoreルール・Cloud Functionsの変更はありません。

## 変更内容

### 漢字の書き取り欄を大きくした

- 漢字の書き取り（基礎トレ・チェックテスト対策どちらも共通の仕組み）で、手書き入力欄をできる限り広くしました
- スマホ縦向き：欄の高さを約1.3〜1.75倍に拡大
- タブレット横向き・PC：欄の高さを約1.5倍、幅も使える分すべて広げました（枠全体の最大幅も拡大）

## デプロイ

```bash
unzip -o aichi-jh-training-revised-v30.zip
npm install
npm run build
npx firebase-tools deploy --only hosting --project aichi-jh-training-507310
```

## 確認項目

- フッターに「バージョン v30」と表示される
- 基礎トレまたはチェックテスト対策の漢字の書きで、書き取り欄が広くなっていることを確認する（スマホ縦向き・タブレット横向きの両方）
