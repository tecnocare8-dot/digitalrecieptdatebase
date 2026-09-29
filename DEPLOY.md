# 本番公開手順（Vercel）

このアプリは「Googleログイン → 利用者ごとに領収書を保存 → 無料5件 / Pro年額1,500円」の構成です。
データは **Neon（Postgres）**、画像は **Vercel Blob（非公開）** に保存します。
Vercel のサーバーはファイルを保存しても消えるため、SQLite や `public/uploads` は使いません。

## 0. 公開前に確認すること

- [ ] Vercel の `Deployments` で、Production になっているデプロイのコミットが GitHub の `main` の最新と一致しているか
      （2026-09-29 時点では、公開中のサイトは `main` とは別のコードでした）

## 1. データベース（Neon）

1. Vercel のプロジェクト → `Storage` → `Create Database` → **Neon (Postgres)** を作成し、このプロジェクトに接続
2. 自動で `DATABASE_URL` と `DATABASE_URL_UNPOOLED` が環境変数に入ることを確認
3. テーブルはデプロイ時に `prisma migrate deploy` で自動作成されます（`npm run build` に含まれています）

## 2. 画像の保存先（Vercel Blob）

1. `Storage` → `Create` → **Blob** を作成し、このプロジェクトに接続
2. `BLOB_READ_WRITE_TOKEN` が環境変数に入ることを確認
   - 未設定のまま Vercel で動かすと、領収書の保存はエラーになります（画像が消える状態で保存を受け付けないため）

## 3. Googleログイン

1. Google Cloud Console → 認証情報 → OAuth クライアント（`.env` の `GOOGLE_CLIENT_ID` と同じもの）を開く
2. 「承認済みのリダイレクト URI」に次を追加
   `https://digitalrecieptdatebase.vercel.app/api/auth/callback/google`
3. Vercel の環境変数に設定
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   - `NEXTAUTH_SECRET`（`openssl rand -base64 32` で作った値）
   - `NEXTAUTH_URL` = `https://digitalrecieptdatebase.vercel.app`

## 4. Stripe

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

## 5. （任意）国税庁の登録番号照会

国税庁「適格請求書発行事業者公表システム Web-API」のアプリケーションIDを申請し、`NTA_APP_ID` に設定すると、
登録番号から会社名を自動入力できます。未設定の間は、本人が過去に保存した領収書からだけ補完します。

## 6. 再デプロイと確認

1. 環境変数を入れたら `Deployments` → 最新 → `Redeploy`
2. 確認（**実際に操作して**確認すること）
   - [ ] 別々の Google アカウント2つでログインし、互いの領収書が見えない
   - [ ] 無料アカウントで6件目を保存すると、アップグレードの案内が出る
   - [ ] テストモードのカード `4242 4242 4242 4242` で決済 → 設定画面が「Proプラン適用中」、有効期限が1年後
   - [ ] Stripe ダッシュボードの Webhook の配信履歴が 200 になっている

## 7. 旧データ（手元の SQLite 389件）の移行

本番の `DATABASE_URL` / `DATABASE_URL_UNPOOLED` / `BLOB_READ_WRITE_TOKEN` を `.env` に入れてから:

```bash
# まず試し実行（何も書き込まない）
npm run migrate-local -- --email <移行先のGoogleアカウント> --sqlite ../prisma/dev.db --uploads ../public/uploads --dry-run
# 問題なければ本実行（途中で止まっても再実行できる）
npm run migrate-local -- --email <移行先のGoogleアカウント> --sqlite ../prisma/dev.db --uploads ../public/uploads
```

旧データの移行対象アカウントは無料プランのままなので、5件を超えて保存を続けるには Pro の購入（または管理者による `proExpiresAt` の設定）が必要です。

## 手元での動作確認

```bash
# Postgres を用意して .env の DATABASE_URL / DATABASE_URL_UNPOOLED をローカルに向ける
npx prisma migrate dev
npm run build && npx next start -p 3100 &
# 利用者の分離・5件制限・webhook・期限切れを実リクエストで確認（ローカルDBを全削除するので本番に向けないこと）
node --env-file=.env scripts/e2e-local.mjs
```
