# 基礎トレ問題JSON仕様（問題作成Work引継ぎ用）

保護者画面の「問題を一括追加」から登録できる基礎トレJSONは、**1ファイルにつき1科目**です。UTF-8のJSONファイルで作成してください。対応科目は「漢字の書き」「語句」「漢字の読み」「地理」「歴史」「生物」「地学」「物理」「化学」です。

## 共通ルール

- ルートの `schemaVersion` は `1`
- `sets` は1個以上の問題セット配列
- 各セットの `schemaVersion` は `1`
- `collectionId`、`setId`、問題の `id` は半角英数字・ハイフン・アンダースコアを使用
- 問題の `id` は全問題で一意にする（例：`kanji-basic-011-q001`）
- `difficulty` は `1`～`3` の整数
- `timeLimitSeconds` は `10`～`45` の整数（通常は20秒を推奨）
- `source` は必ず `"custom"`
- 同じIDが既にある場合、保護者画面で「スキップ」または「上書き」を選択可能

## 漢字の書き

ルートの `type` は `"kanji-writing-collection"`、各セットの `type` は `"kanji-writing"` にします。

```json
{
  "schemaVersion": 1,
  "collectionId": "kanji-basic-011-015",
  "collectionTitle": "漢字の書き 基礎トレ 11〜15",
  "type": "kanji-writing-collection",
  "sets": [
    {
      "schemaVersion": 1,
      "setId": "kanji-basic-011",
      "setTitle": "漢字の書き 基礎トレ11",
      "type": "kanji-writing",
      "questions": [
        {
          "id": "kanji-basic-011-q001",
          "title": "熟語",
          "sentence": "文中の【ことば】を漢字で書きましょう。",
          "reading": "ことば",
          "answer": "言葉",
          "acceptedAnswers": [],
          "explanation": "正答の理由や注意点を書きます。",
          "targetKanji": ["言", "葉"],
          "targetWord": "言葉",
          "grade": 4,
          "category": "熟語",
          "tags": ["熟語"],
          "difficulty": 1,
          "timeLimitSeconds": 20,
          "knowledgeKey": "ことば-言葉",
          "source": "custom",
          "references": []
        }
      ]
    }
  ]
}
```

必須項目は `id`、`title`、`sentence`、`reading`、`answer`、`acceptedAnswers`、`explanation`、`category`、`difficulty`、`timeLimitSeconds`、`knowledgeKey`、`source` です。`acceptedAnswers` は別表記を認めない場合も空配列 `[]` にしてください。

## 地理

ルートの `type` は `"geography-collection"`、各セットの `type` は `"geography"` にします。

```json
{
  "schemaVersion": 1,
  "collectionId": "geography-basic-011-015",
  "collectionTitle": "地理 基礎トレ 11〜15",
  "type": "geography-collection",
  "sets": [
    {
      "schemaVersion": 1,
      "setId": "geography-basic-011",
      "setTitle": "地理 基礎トレ11",
      "type": "geography",
      "questions": [
        {
          "id": "geography-basic-011-q001",
          "title": "都道府県",
          "context": "資料や前提を書きます。",
          "prompt": "正しいものを選びましょう。",
          "options": ["選択肢A", "選択肢B", "選択肢C", "選択肢D"],
          "correctIndex": 0,
          "explanation": "正答の理由を説明します。",
          "topic": "prefecture",
          "subtopic": "都道府県",
          "questionType": "knowledge",
          "region": [],
          "difficulty": 1,
          "timeLimitSeconds": 20,
          "materials": [],
          "statisticsYear": null,
          "source": "custom",
          "references": [],
          "knowledgeKey": "都道府県-例題"
        }
      ]
    }
  ]
}
```

必須項目は `id`、`title`、`prompt`、`options`（空欄のない4項目）、`correctIndex`（0～3）、`explanation`、`topic`、`subtopic`、`difficulty`、`timeLimitSeconds`、`knowledgeKey`、`source` です。`context` は空文字でも構いません。

## その他の選択式7科目

「語句」「漢字の読み」「歴史」「生物」「地学」「物理」「化学」は、地理と同じ選択式の問題項目を使います。ルートとセットの `type` だけを次の表に合わせてください。

| 科目 | ルート `type` | セット `type` | ID接頭辞の例 |
| --- | --- | --- | --- |
| 語句 | `vocabulary-collection` | `vocabulary` | `vocabulary-basic-001-q001` |
| 漢字の読み | `kanji-reading-collection` | `kanji-reading` | `kanji-reading-basic-001-q001` |
| 歴史 | `history-collection` | `history` | `history-basic-001-q001` |
| 生物 | `biology-collection` | `biology` | `biology-basic-001-q001` |
| 地学 | `earth-science-collection` | `earth-science` | `earth-science-basic-001-q001` |
| 物理 | `physics-collection` | `physics` | `physics-basic-001-q001` |
| 化学 | `chemistry-collection` | `chemistry` | `chemistry-basic-001-q001` |

各科目の `topic` は大分類（例：`plant`、`edo`）、`subtopic` は画面に表示する日本語分類（例：「植物」「江戸時代」）にしてください。保護者画面の「基礎トレひな形」から各科目の完成形をダウンロードできます。

## 問題作成Workへ渡す短い指示

> 出力は「基礎トレ問題JSON仕様」に厳密に従うUTF-8 JSONにしてください。1ファイルにつき1科目とし、schemaVersionは1、問題IDは既存問題と重複しない一意なID、sourceはcustom、timeLimitSecondsは10～45（原則20）、difficultyは1～3にしてください。漢字の書きは記述自己採点形式、ほか8科目は4択形式にし、上表のcollection type/set typeを使用してください。各セット10問を基本とし、JSON以外の説明文はファイル内に入れないでください。
