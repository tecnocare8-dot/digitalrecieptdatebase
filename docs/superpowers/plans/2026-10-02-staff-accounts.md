# スタッフアカウント 実装計画

> 実行方法: 利用者の「実装してください」の指示により、この会話で順に実装し（executing-plans）、最後に別の確認役が全体を点検する。

**目的:** 代表者が発行する ID・パスワードでスタッフがログインし、代表者の帳簿に登録・自分の分だけ閲覧修正できるようにする。

**方式:** 表 `Staff` を追加し、ログイン中の人を `Actor { ownerId, staffId, displayName }` として全窓口で受け取る。ドライブ処理は常に `ownerId` で行い、スタッフのときだけ帳簿の行を `registeredById` で絞る。

**使うもの:** Next.js 16 / next-auth 4（Credentials を追加）/ Prisma 5（Neon、app スキーマ）/ Node `crypto.scrypt`

**設計書:** `docs/superpowers/specs/2026-10-02-staff-accounts-design.md`

## 全体の決まり

- 追加の部品は入れない（パスワードは `crypto.scrypt`、比較は `timingSafeEqual`）
- DB 変更は表 `Staff` の追加のみ（migration 1本）。既存の表は変えない
- スタッフ上限 5人、パスワード 8文字以上、10回失敗で15分停止
- ログインID: `^[a-z0-9_-]{3,32}$`、表示名 1〜30文字
- 画面・エラー文言はすべて日本語

## 点検で特に見る点（テストで押さえる）

1. スタッフが他人の領収書IDを直接指定（閲覧・修正・画像）→ 404、削除・CSV・設定・購入・スタッフ管理 → 403
2. スタッフが修正時に `registeredById` を送っても書き換わらない
3. 削除・パスワード再設定されたスタッフの既存ログインが次の要求で 401
4. 旧CSV（登録者列なし）の行が代表者の分として読まれ、スタッフには見えない
5. 代表者とスタッフが同時に登録しても帳簿の行が欠けない

---

### 作業1: 表 Staff とパスワード処理

**ファイル:** `prisma/schema.prisma`、`prisma/migrations/20261002000000_staff/migration.sql`、新規 `lib/password.ts`、新規 `scripts/staff-test.ts`、`package.json`（`test:staff`）

**提供:** `hashPassword(plain): Promise<string>`、`verifyPassword(plain, stored): Promise<boolean>`、`validateLoginId(s): string|null`（エラー文言 or null）、`validatePassword(s)`、`validateDisplayName(s)`、定数 `MAX_STAFF=5`、`MAX_FAILED_LOGINS=10`、`LOCK_MINUTES=15`

- [ ] 単体テスト（変換→照合成功／別パスワード失敗／同じ平文でも毎回違う値／壊れた保存値で false／ID・パスワード・表示名の検証）を書いて失敗を確認
- [ ] 実装してテスト成功
- [ ] schema に `Staff` を追加し、`User.staff Staff[]` を張る。migration を作成（手元のテストDBで `prisma migrate deploy` が通ること）
- [ ] 保存

### 作業2: ログイン（Credentials）と Actor

**ファイル:** `lib/auth.ts`、`types/next-auth.d.ts`、新規 `lib/staff-login.ts`

**提供:**
- `authenticateStaff(loginId, password): Promise<{ ok: true, staff } | { ok: false, reason: 'invalid'|'locked' }>` — 失敗回数・停止・最終ログインの更新を含む（DB のみに依存し、単体テスト可能）
- `requireActor(): Promise<Actor>`（`Actor = { ownerId: string; staffId: string | null; displayName: string }`）。スタッフは毎回 Staff 行と `sessionVersion` を確認し、合わなければ `UnauthorizedError`
- `requireOwner(): Promise<Actor>` — スタッフなら `ForbiddenError`
- 既存 `requireUserId()` は削除し、全窓口を `requireActor`/`requireOwner` に置き換える（作業4）
- JWT: `userId`(=ownerId)、`staffId`、`staffSessionVersion`。session.user に `staffId`・`isStaff` を出す

- [ ] `authenticateStaff` の単体テスト（テストDB使用：成功で回数0・lastLoginAt 更新、10回失敗で locked、停止中は正しいパスワードでも locked、存在しないIDは invalid）
- [ ] 実装・成功
- [ ] 保存

### 作業3: 帳簿の登録者列と、絞り込み付きドライブ操作

**ファイル:** `lib/drive.ts`、`lib/receipts.ts`

**提供:**
- `ReceiptMeta` に `registeredBy: string | null`、`registeredById: string | null` を追加。CSV 末尾に「登録者」「登録者ID」列
- `driveForActor(actor)` — `driveForUser(actor.ownerId)` を包み、スタッフのとき `listReceipts` を自分の分に絞り、`updateReceipt`/`downloadReceipt` は自分の分以外を null、`trashReceipt`・`ledgerCsv`・`createFolder` は使わせない（窓口側で403）。`addReceipt` は登録者を Actor から自動で入れる
- `updateReceipt` の patch から登録者項目を除外（書き換え不可）
- `toClientReceipt` に `registeredBy` を追加

- [ ] stores-test と同じ形式で CSV の単体テスト（旧CSVは登録者 null、新列の往復、Excel で列を並べ替えても読める）
- [ ] 実装・成功
- [ ] 保存

### 作業4: 全窓口の権限

**ファイル:** `app/api/**/route.ts` 全部、`lib/api-errors.ts`、新規 `app/api/staff/route.ts`（GET 一覧・POST 追加）、新規 `app/api/staff/[id]/route.ts`（PATCH パスワード再設定・DELETE）、`lib/settings.ts`（`role`・`displayName`・スタッフ一覧用情報）

- `errorResponse(error, context, actor?)`: `ForbiddenError` → 403。スタッフのときドライブ関連 409 の文言を「代表者にドライブの再連携を依頼してください。」に、402 に「代表者に連絡してください。」を添える
- スタッフ追加は Pro 有効かつ5人未満のみ。ログインID重複は 409
- 再設定・削除で `sessionVersion` を増やし、再設定では `failedLoginCount=0, lockedUntil=null`
- 作成・再設定の応答でだけパスワードを返す

- [ ] e2e-local.mjs に「12. スタッフ」節を追加（点検ポイント1〜5、Pro なし追加不可、6人目不可、重複ID、ログイン停止、ログイン本体は `/api/auth/callback/credentials` に実際に POST して確認）
- [ ] 実装し、e2e 全体（既存の節も）成功
- [ ] 保存

### 作業5: 画面

**ファイル:** `components/AuthGate.tsx`、`app/settings/page.tsx`、新規 `components/StaffManager.tsx`、`app/history/page.tsx`、`app/page.tsx`

- ログイン画面にスタッフ用 ID・パスワード欄（`signIn('credentials', { redirect: false })`、失敗・停止の文言）
- 設定: スタッフ時はプラン・ドライブ・購入を出さず「〇〇（スタッフ）としてログイン中」とログアウトのみ。代表者には StaffManager（一覧・追加・再設定・削除、パスワード一度だけ表示＋コピー）
- 一覧: 代表者に「登録者」表示と絞り込み。スタッフは削除ボタン・CSV出力を出さない
- 上部にスタッフ表示

- [ ] `npm run build`・`npm run lint` 成功
- [ ] 手元で起動し、ブラウザで代表者・スタッフの両方の画面を確認
- [ ] 保存・push、変更の取り込み依頼のリンクを用意
