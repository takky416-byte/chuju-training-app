# 修正版 v6 の反映手順

## 1. ZIPを展開

Cloud Shell の `aichi-jh-training-deploy` フォルダで実行します。

```bash
unzip -o aichi-jh-training-revised-v6.zip
```

## 2. メール送信用パスワードを登録（初回だけ）

送信元 `takky416@gmail.com` で Google の2段階認証を有効にし、
[Google アプリ パスワード](https://myaccount.google.com/apppasswords) で16文字のアプリパスワードを発行します。

次のコマンドを実行し、表示された入力欄にアプリパスワードを貼り付けます。
パスワードは画面上に表示されません。

```bash
npx firebase-tools functions:secrets:set GMAIL_APP_PASSWORD --project aichi-jh-training-507310
```

## 3. Webサイトと日次メールを反映

```bash
npx firebase-tools deploy --only hosting,functions --project aichi-jh-training-507310
```

日次レポートは毎日21:30（日本時間）に、直前24時間分を次の2アドレスへ送ります。

- takky416@gmail.com
- analog3006@gmail.com

演習がなかった日も短いレポートを送ります。同じ日の処理が重なった場合は二重送信を防ぎます。
