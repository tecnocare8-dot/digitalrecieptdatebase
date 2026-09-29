# 本番公開手順（Vercel）

このアプリは「Googleログイン → 領収書を本人のGoogleドライブに保存 → 無料5件 / Pro年額1,500円」の構成です。

- **領収書の画像と記録は、利用者本人のGoogleドライブ**（アプリが作る保存用フォルダ）に保存します。
  フォルダには `領収書一覧.csv`（記録の本体。アプリはこのCSVを読み書きする）と画像が入り、アプリが無くなってもドライブに残ります。
- **Neon（Postgres）** には、アカウント・プラン（Proの期限）・支払いの記録・ドライブ連携情報（暗号化したトークン、フォルダID）だけを持ちます。

## 0. 公開前に確認すること

- [ ] Vercel の `Deployments` で、Production になっているデプロイのコミットが GitHub の `main` の最新と一致しているか
      （2026-09-29 時点では、公開中のサイトは `main` とは別のコードでした）

## 1. データベース（Neon）

1. Vercel のプロジェクト → `Storage` → `Create Database` → **Neon (Postgres)** を作成し、このプロジェクトに接続
2. 自動で `DATABASE_URL` と `DATABASE_URL_UNPOOLED` が環境変数に入ることを確認
3. テーブルはデプロイ時に `scripts/migrate-deploy.mjs`（`npm run build` に含まれています）で自動作成されます
   - このアプリの表は **`app` スキーマ**に作ります。本番の Neon（`receipt-db`）の `public` スキーマには旧版アプリの表が残っており、
     そちらには一切触れません。旧版の表が不要になったら、Neon の画面から `public` の表を削除して構いません

## 2. Googleログインとドライブ

1. Google Cloud Console で、OAuth クライアント（`GOOGLE_CLIENT_ID` と同じもの）があるプロジェクトを開く
2. **「APIとサービス」→「ライブラリ」→「Google Drive API」→ 有効にする**（未設定だと、フォルダ作成時に「Google Drive API が有効になっていません」と出ます）
3. 「OAuth 同意画面」→「データアクセス（スコープ）」に `.../auth/drive.file` を追加
   - drive.file は「このアプリが作成したファイルだけ」を扱う権限で、利用者のほかのファイルは見えません
4. 認証情報 → OAuth クライアント →「承認済みのリダイレクト URI」に次があることを確認
   `https://digitalrecieptdatebase.vercel.app/api/auth/callback/google`
5. Vercel の環境変数
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   - `NEXTAUTH_SECRET`（`openssl rand -base64 32` で作った値）。**ドライブ連携のトークンの暗号化にも使うので、変えると全員の再連携が必要**
   - `NEXTAUTH_URL` = `https://digitalrecieptdatebase.vercel.app`

## 3. Stripe

1. Stripe ダッシュボード（本番 or テストモード）でシークレットキーを取得し、Vercel に `STRIPE_SECRET_KEY` として設定
   - 名前は必ず `STRIPE_SECRET_KEY`。`NEXT_PUBLIC_` を付けるとブラウザに漏れます
2. 商品ID: 既定は `prod_VLY4V3qhIvZbmu`。**テストモードと本番モードでは商品IDが別**なので、
   テストモードで試すときはテスト側の商品IDを `STRIPE_PRODUCT_ID` に設定
3. Webhook を登録（開発者 → Webhook → エンドポイントを追加）
   - URL: `https://digitalrecieptdatebase.vercel.app/api/webhook/stripe`
   - イベント: `checkout.session.completed`, `checkout.session.async_payment_succeeded`
   - 表示された署名シークレット（`whsec_...`）を `STRIPE_WEBHOOK_SECRET` に設定
   - **未設定だと webhook はすべて拒否されます**（偽の通知で Pro にされないため）。
     その場合でも、決済後に戻った設定画面が Stripe に直接確認して Pro を反映します
4. クーポン: 決済画面に「プロモーションコードを追加」欄が出ます。使うには Stripe で
   **「商品カタログ」→「クーポン」→ クーポンを作成 → その中で「プロモーションコード」を作成**（例: `WELCOME50`）。
   利用者はそのコードを決済画面で入力します。100%割引のクーポンでも Pro は有効になります

## 4. （任意）国税庁の登録番号照会

国税庁「適格請求書発行事業者公表システム Web-API」のアプリケーションIDを申請し、`NTA_APP_ID` に設定すると、
登録番号から会社名を自動入力できます。未設定の間は、本人が過去に保存した領収書（ドライブの一覧CSV）からだけ補完します。

## 5. 再デプロイと確認

1. 環境変数を入れたら `Deployments` → 最新 → `Redeploy`
2. 確認（**実際に操作して**確認すること）
   - [ ] Googleでログイン → 設定で「① Googleドライブと連携」→「② フォルダを作成」→ ドライブにフォルダと `領収書一覧.csv` ができる
   - [ ] 領収書を1件保存 → ドライブのフォルダに画像が入り、CSVに1行増える
   - [ ] 別々の Google アカウント2つでログインし、互いの領収書が見えない
   - [ ] 無料アカウントで6件目を保存すると、アップグレードの案内が出る
   - [ ] テストモードのカード `4242 4242 4242 4242` で決済 → 設定画面が「Proプラン適用中」、有効期限が1年後
   - [ ] Stripe ダッシュボードの Webhook の配信履歴が 200 になっている

## 6. 旧データ（手元の SQLite 389件）の移行

移行先のアカウントでログインし、設定画面でドライブ連携とフォルダ作成を済ませてから、
本番の `DATABASE_URL` / `DATABASE_URL_UNPOOLED` / `NEXTAUTH_SECRET` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を `.env` に入れて:

```bash
# まず試し実行（何も書き込まない）
npm run migrate-local -- --email <移行先のGoogleアカウント> --sqlite ../prisma/dev.db --uploads ../public/uploads --dry-run
# 問題なければ本実行（ドライブのフォルダに画像とCSVの行が追加される。途中で止まっても再実行できる）
npm run migrate-local -- --email <移行先のGoogleアカウント> --sqlite ../prisma/dev.db --uploads ../public/uploads
```

旧データの移行対象アカウントは無料プランのままなので、5件を超えて保存を続けるには Pro の購入（または管理者による `proExpiresAt` の設定）が必要です。

## 手元での動作確認

```bash
# Postgres を用意して .env の DATABASE_URL / DATABASE_URL_UNPOOLED をローカルに向け、
# DRIVE_FAKE_DIR（擬似ドライブの置き場所）を設定する
npm run build && npx next start -p 3100 &
# ドライブ保存・利用者の分離・5件制限・webhook・期限切れを実リクエストで確認（ローカルDBを全削除するので本番に向けないこと）
node --env-file=.env scripts/e2e-local.mjs
```
