# quimaglet バックエンド（お知らせ・文章・グッズの管理）

サイトの文章・お知らせ・グッズを、ブラウザの管理画面から書き換えるための仕組みです。Cloudflare の無料枠で動きます。

```
管理画面（quimaglet-admin.<あなた>.workers.dev） ── Cloudflare Access でログイン（メールに届く 6 桁のコード）
        │ 保存・画像のアップロード
        ▼
D1（データベース）：中身の JSON・保存した版の履歴（300 件）・画像
        ▲
        │ 読むだけ（公開中のお知らせだけ。下書きと、公開日時が来ていないものは出ない）
サイト（GitHub Pages） ←── quimaglet-api.<あなた>.workers.dev/api/content
```

- 保存すると、サイトには 1 分ほどで出ます（サイトのデプロイは要りません）。
- API が止まっていても、サイトは `public/content.json`（控え）を表示します。
- 2 人が同時に書き換えた場合、後から保存した人には「先に保存されていました」と出て、上書きはされません。

## はじめの準備（1 回だけ）

### 1. Cloudflare のアカウントを作る

https://dash.cloudflare.com/sign-up で無料のアカウントを作ります。
ログイン後、左のメニューの **Workers & Pages** を一度開き、`workers.dev` のサブドメイン（例：`quimaglet`）を決めてください。

### 2. データベースと 2 つの Worker を作る

```sh
cd backend
npm install
npx wrangler login      # ブラウザが開くので「Allow」
npm run setup
```

`npm run setup` は次のことをします。

- D1 を作ります。
- 今のサイトの中身（`public/content.json`）を D1 に入れます。
- `quimaglet-api` と `quimaglet-admin` を公開します。

最後に、2 つの URL が表示されます。

### 3. 管理画面にログインをかける（Cloudflare Access）

**この手順が終わるまで、管理画面は開いても読み込みも保存もできません**（API が誰も通しません）。

1. Cloudflare のダッシュボードで **Workers & Pages → quimaglet-admin → Settings → Domains & Routes** を開きます。
2. `workers.dev` の行で **Cloudflare Access** を有効にします。表示される次の 2 つを控えてください。
   - **Audience (AUD) tag**
   - チームのドメイン（`https://＜チーム名＞.cloudflareaccess.com`）
3. **Zero Trust → Access → Applications** に、自動でできたアプリケーションがあります。その **Policies** で、管理画面を使う人のメールアドレスを **Include → Emails** に登録します。
4. `backend/wrangler.toml` の `[env.admin.vars]` に、控えた 2 つを書きます。

   ```toml
   ACCESS_TEAM_DOMAIN = "https://＜チーム名＞.cloudflareaccess.com"
   ACCESS_AUD = "＜Audience tag＞"
   ```

5. 管理画面を公開し直します。

   ```sh
   npx wrangler deploy --env admin
   ```

これで、管理画面を開くとメールアドレスを聞かれ、届いたコードを入れると使えるようになります。

### 4. サイトが API を読むようにする

リポジトリのいちばん上に `.env.production` を作り、公開側の URL を書きます。

```
VITE_CONTENT_API=https://quimaglet-api.＜サブドメイン＞.workers.dev
```

そのあと、サイトを公開し直します（`npm run deploy`）。

## ふだんの使い方

管理画面（`https://quimaglet-admin.＜サブドメイン＞.workers.dev`）を開いて書き換え、**保存** を押します。

| 項目 | できること |
| --- | --- |
| お知らせの状態 | 「公開」か「下書き」を選べます。下書きはサイトに出ません。 |
| 公開日時 | 入れておくと、その時刻からサイトに出ます（予約投稿）。 |
| 画像 | 「画像を選ぶ」でアップロードします。長い辺が 1600px の WebP に自動で縮めて保存します。 |
| 履歴 | 前の版を画面に読み込み、「保存」でその内容に戻せます。 |

メンバーを増やすときは、手順 3-3 の Policies にメールアドレスを足します。

## 手元で試す

```sh
cd backend
npm run dev:local                                   # http://127.0.0.1:8788 （管理画面。ログインは省略）
# 別の端末で、リポジトリのいちばん上から
VITE_CONTENT_API=http://127.0.0.1:8788 npx vite     # サイトがこの中身を読む
```

## ファイル

| ファイル | 中身 |
| --- | --- |
| `src/worker.js` | API の本体です。公開側と管理画面側は同じコードで、`ROLE` で切り替えます。Access の JWT（ログインの証明）もここで確かめます。 |
| `admin/index.html` | 管理画面 |
| `schema.sql` | D1 の表 |
| `scripts/seed.mjs` | `public/content.json` を D1 に入れる SQL を作ります。 |
| `scripts/setup.mjs` | はじめの準備をまとめて行います。 |
| `wrangler.toml` | 2 つの Worker の設定 |
