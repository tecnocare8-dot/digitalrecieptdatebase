// 手元で起動したアプリに実際のHTTPリクエストを送り、ドライブ保存（一覧CSV）・利用者の分離・5件制限・
// Stripe webhook・期限切れを確認する。ドライブは DRIVE_FAKE_DIR の擬似ドライブを使う。
// ※ テスト用DBの User / Payment を全削除するので、本番DBに向けて実行しないこと。
//
//   .env に DRIVE_FAKE_DIR=/tmp/fake-drive などを追加
//   npm run build && npx next start -p 3100 &
//   E2E_BASE=http://localhost:3100 node --env-file=.env scripts/e2e-local.mjs
import { createRequire } from 'module';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { encode } = require('next-auth/jwt');
const Stripe = require('stripe');
const { PrismaClient } = require('@prisma/client');

const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const SECRET = process.env.NEXTAUTH_SECRET;
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET;
const FAKE = process.env.DRIVE_FAKE_DIR;

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  console.error('DATABASE_URL がローカルではありません。テストはDBを全削除するため中止します。');
  process.exit(1);
}
if (!FAKE) {
  console.error('DRIVE_FAKE_DIR を設定してください。');
  process.exit(1);
}

const prisma = new PrismaClient();
const stripe = new Stripe('sk_test_unused');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

// lib/crypto.ts と同じ方式でリフレッシュトークンを暗号化（擬似ドライブは復号できるかで連携済みを判定する）
function encryptSecret(plain) {
  const key = createHash('sha256').update(`google-refresh-token:${SECRET}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

async function cookieFor(user) {
  const token = await encode({ token: { email: user.email, userId: user.id, sub: user.id }, secret: SECRET });
  return `next-auth.session-token=${token}`;
}

// スタッフの実際のログイン（CSRFトークンを取り、ID・パスワードを送る）。成功ならセッションのcookie、失敗なら error を返す
async function staffLogin(loginId, password) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const csrfCookie = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: csrfCookie },
    body: new URLSearchParams({ csrfToken, loginId, password, json: 'true' }),
  });
  const session = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('next-auth.session-token='));
  // 失敗時は 401 と { url: '.../api/auth/error?error=…' } が返る（json=true のため）
  const location = res.headers.get('location') ?? (await res.json().catch(() => ({}))).url ?? '';
  return { cookie: session ?? null, error: new URL(location, BASE).searchParams.get('error') };
}

// 擬似ドライブの中身を直接見る（ドライブを開いたときに見えるもの）
function fakeFiles(userId) {
  const dir = path.join(FAKE, userId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
}
function ledgerOf(userId, folderId) {
  return fakeFiles(userId).find((f) => f.appProperties?.kind === 'ledger' && !f.trashed && (!folderId || f.parents?.includes(folderId)));
}
function ledgerText(userId, folderId) {
  const l = ledgerOf(userId, folderId);
  return l ? fs.readFileSync(path.join(FAKE, userId, `${l.id}.bin`), 'utf8') : null;
}
function markTrashed(userId, id) {
  const p = path.join(FAKE, userId, `${id}.json`);
  const f = JSON.parse(fs.readFileSync(p, 'utf8'));
  fs.writeFileSync(p, JSON.stringify({ ...f, trashed: true }));
}

// 最小のJPEG(1x1)
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function addReceipt(cookie, i, company = `テスト商店${i}`) {
  const fd = new FormData();
  fd.append('image', new Blob([JPEG], { type: 'image/jpeg' }), 'r.jpg');
  fd.append('date', `2026-09-${String(i).padStart(2, '0')}`);
  fd.append('invoiceNumber', 'T1234567890123');
  fd.append('companyName', company);
  fd.append('totalAmount', String(1000 + i));
  fd.append('paymentMethod', '現金');
  return fetch(`${BASE}/api/receipts`, { method: 'POST', body: fd, headers: { cookie } });
}
const getJson = async (p, cookie) => (await fetch(BASE + p, { headers: { cookie } })).json();
const createFolder = (cookie, name) => fetch(`${BASE}/api/drive/folder`, {
  method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name }),
});

async function webhook(payloadObj, { sign = true, badSig = false } = {}) {
  const payload = JSON.stringify(payloadObj);
  const headers = { 'content-type': 'application/json' };
  if (sign) headers['stripe-signature'] = stripe.webhooks.generateTestHeaderString({ payload, secret: badSig ? 'whsec_wrong' : WHSEC });
  return fetch(`${BASE}/api/webhook/stripe`, { method: 'POST', body: payload, headers });
}

function sessionEvent(id, userId, paymentStatus = 'paid', amount = 1500) {
  return {
    id: 'evt_' + id, object: 'event', type: 'checkout.session.completed',
    data: { object: { id, object: 'checkout.session', client_reference_id: userId, payment_status: paymentStatus, amount_total: amount, currency: 'jpy' } },
  };
}

async function main() {
  fs.rmSync(FAKE, { recursive: true, force: true });
  await prisma.payment.deleteMany();
  await prisma.user.deleteMany();
  const token = encryptSecret('fake-refresh-token');
  const A = await prisma.user.create({ data: { email: 'a@example.com', googleRefreshToken: token } });
  const B = await prisma.user.create({ data: { email: 'b@example.com', googleRefreshToken: token } });
  const C = await prisma.user.create({ data: { email: 'c@example.com' } }); // ドライブ未連携
  const ca = await cookieFor(A), cb = await cookieFor(B), cc = await cookieFor(C);

  console.log('1. 未ログイン');
  for (const p of ['/api/settings', '/api/receipts/list', '/api/receipts/export', '/api/receipts/x/image', '/api/invoice-lookup?invoiceNumber=T1234567890123']) {
    const r = await fetch(BASE + p);
    check(`${p} → 401`, r.status === 401, r.status);
  }
  check('POST /api/receipts → 401', (await addReceipt('', 1)).status === 401);
  check('POST /api/checkout → 401', (await fetch(BASE + '/api/checkout', { method: 'POST' })).status === 401);
  check('POST /api/drive/folder → 401', (await createFolder('', 'x')).status === 401);

  console.log('2. ドライブ未連携・フォルダ未作成の案内');
  let s = await getJson('/api/settings', cc);
  check('未連携は drive.connected=false・保存不可', s.drive.connected === false && s.canAddReceipt === false, JSON.stringify(s.drive));
  let r = await addReceipt(cc, 1);
  check('未連携で保存 → 409 DRIVE_AUTH', r.status === 409 && (await r.json()).code === 'DRIVE_AUTH', r.status);
  check('未連携でフォルダ作成 → 409 DRIVE_AUTH', (await createFolder(cc, 'x')).status === 409);
  s = await getJson('/api/settings', ca);
  check('連携済み・フォルダなし', s.drive.connected === true && s.drive.folder === null && !s.canAddReceipt, JSON.stringify(s.drive));
  r = await addReceipt(ca, 1);
  check('フォルダなしで保存 → 409 DRIVE_FOLDER_MISSING', r.status === 409 && (await r.json()).code === 'DRIVE_FOLDER_MISSING', r.status);

  console.log('3. フォルダ作成とリンク');
  r = await createFolder(ca, '経費の領収書');
  let body = await r.json();
  check('フォルダ作成 → 200・created', r.status === 200 && body.created === true && body.folder.name === '経費の領収書', JSON.stringify(body));
  const folderA = body.folder;
  check('フォルダのリンクはドライブのURL', folderA.url === `https://drive.google.com/drive/folders/${folderA.id}`, folderA.url);
  r = await createFolder(ca, '別の名前');
  body = await r.json();
  check('もう一度押しても作り直さず同じフォルダ', body.created === false && body.folder.id === folderA.id);
  s = await getJson('/api/settings', ca);
  check('設定にフォルダとCSVのリンクが出る', s.drive.folderExists && s.drive.folder.url === folderA.url && /^https:\/\/drive\.google\.com\/file\/d\//.test(s.drive.ledgerUrl ?? ''), JSON.stringify(s.drive));
  check('作成直後に空の一覧CSVがドライブにある', (ledgerText(A.id) ?? '').startsWith('﻿ID,日付,会社名,登録番号,金額,支払い方法,分類,画像ファイル名,画像リンク,登録日時'));
  const emptyName = await createFolder(cb, '   ');
  const bFolder = (await emptyName.json()).folder;
  check('名前が空なら既定の名前で作る', bFolder.name === '領収書（デジタル経費記録）', bFolder.name);

  console.log('4. 保存は本人のドライブ（CSV＋画像）へ・無料5件まで');
  for (let i = 1; i <= 5; i++) {
    r = await addReceipt(ca, i);
    check(`Aの${i}件目 → 200`, r.status === 200, r.status);
  }
  check('Aの6件目 → 402', (await addReceipt(ca, 6)).status === 402);
  check('Bは影響を受けず保存できる', (await addReceipt(cb, 1)).status === 200);
  const csvA = ledgerText(A.id);
  const csvLines = csvA.trim().split('\r\n');
  check('ドライブの一覧CSVに5行', csvLines.length === 6, csvLines.length);
  check('CSVに内容と画像リンクが入る', csvA.includes('テスト商店5') && csvA.includes('1005') && csvA.includes('https://drive.google.com/file/d/'));
  const imagesA = fakeFiles(A.id).filter((f) => f.appProperties?.kind === 'receipt');
  check('画像5枚がAのフォルダに入る', imagesA.length === 5 && imagesA.every((f) => f.parents.includes(folderA.id)), imagesA.length);
  check('画像のファイル名で中身が分かる', imagesA.some((f) => f.name === '2026-09-05_テスト商店5_1005円.jpg'), imagesA.map((f) => f.name).join(','));
  check('Bのドライブには1件だけ', (ledgerText(B.id) ?? '').trim().split('\r\n').length === 2);
  // text() はBOMを取り除くので、バイト列で比べる（ExcelのためにBOMが付いていることも確かめる）
  const exportA = Buffer.from(await (await fetch(BASE + '/api/receipts/export', { headers: { cookie: ca } })).arrayBuffer());
  check('CSV出力はドライブの一覧CSVと同じ内容（BOM付き）', exportA.equals(Buffer.from(csvA, 'utf8')) && exportA.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));

  console.log('5. 他人のデータは見えない・触れない');
  const listA = await getJson('/api/receipts/list', ca);
  const listB = await getJson('/api/receipts/list', cb);
  check('Aの一覧は5件', listA.length === 5, listA.length);
  check('Bの一覧は1件', listB.length === 1, listB.length);
  const aId = listA[0].id;
  check('一覧にドライブのリンクが付く', listA[0].driveUrl === `https://drive.google.com/file/d/${aId}/view`);
  check('BがAの画像 → 404', (await fetch(`${BASE}/api/receipts/${aId}/image`, { headers: { cookie: cb } })).status === 404);
  check('BがAの領収書を削除 → 404', (await fetch(`${BASE}/api/receipts/${aId}`, { method: 'DELETE', headers: { cookie: cb } })).status === 404);
  const fdPut = new FormData(); fdPut.append('date', '2026-01-01'); fdPut.append('companyName', '乗っ取り'); fdPut.append('totalAmount', '1'); fdPut.append('paymentMethod', '現金'); fdPut.append('invoiceNumber', '');
  check('BがAの領収書を編集 → 404', (await fetch(`${BASE}/api/receipts/${aId}`, { method: 'PUT', body: fdPut, headers: { cookie: cb } })).status === 404);
  check('AのCSVは乗っ取られていない', !ledgerText(A.id).includes('乗っ取り'));
  const imgA = await fetch(`${BASE}/api/receipts/${aId}/image`, { headers: { cookie: ca } });
  check('Aは自分の画像を取得でき、保存した内容と一致', imgA.status === 200 && Buffer.from(await imgA.arrayBuffer()).equals(JPEG), imgA.status);
  const lk = await getJson('/api/invoice-lookup?invoiceNumber=T1234567890123', cb);
  check('登録番号の照会はBの履歴のみ', lk.companyName === 'テスト商店1', JSON.stringify(lk));

  console.log('6. CSVを基盤に読み書き');
  // 利用者がドライブ上でCSVを直接直した場合も、アプリはCSVの内容を表示する
  const ledgerA = ledgerOf(A.id);
  const edited = ledgerText(A.id).replace('テスト商店3', 'CSVで直した商店');
  fs.writeFileSync(path.join(FAKE, A.id, `${ledgerA.id}.bin`), edited);
  const afterEdit = await getJson('/api/receipts/list', ca);
  check('ドライブでCSVを直すとアプリにも反映', afterEdit.some((x) => x.companyName === 'CSVで直した商店'));
  // CSVが消されても、画像の説明欄に残した内容から作り直す
  markTrashed(A.id, ledgerA.id);
  const rebuilt = await getJson('/api/receipts/list', ca);
  check('CSVを削除しても画像から一覧を作り直す（5件）', rebuilt.length === 5, rebuilt.length);
  check('作り直したCSVがドライブにある', !!ledgerOf(A.id) && ledgerText(A.id).trim().split('\r\n').length === 6);

  console.log('7. Stripe webhook（クーポン含む）');
  check('署名なし → 400', (await webhook(sessionEvent('cs_fake', A.id), { sign: false })).status === 400);
  check('偽の署名 → 400', (await webhook(sessionEvent('cs_fake', A.id), { badSig: true })).status === 400);
  let a = await prisma.user.findUnique({ where: { id: A.id } });
  check('偽の通知ではProにならない', a.proExpiresAt === null);
  check('未払いの通知 → 200', (await webhook(sessionEvent('cs_unpaid', A.id, 'unpaid'))).status === 200);
  a = await prisma.user.findUnique({ where: { id: A.id } });
  check('未払いではProにならない', a.proExpiresAt === null);
  check('100%割引クーポン（支払い不要）→ 200', (await webhook(sessionEvent('cs_coupon100', B.id, 'no_payment_required', 0))).status === 200);
  const bUser = await prisma.user.findUnique({ where: { id: B.id } });
  check('100%割引クーポンでもProになる', bUser.proExpiresAt && (bUser.proExpiresAt - Date.now()) / 86400000 > 364);

  const w1 = await webhook(sessionEvent('cs_paid_1', A.id));
  check('本物の署名・支払い済み → 200', w1.status === 200, w1.status);
  a = await prisma.user.findUnique({ where: { id: A.id } });
  const days1 = (a.proExpiresAt - Date.now()) / 86400000;
  check('Aの有効期限が約1年後', days1 > 364 && days1 < 367, days1);
  const exp1 = a.proExpiresAt.getTime();
  await webhook(sessionEvent('cs_paid_1', A.id));
  a = await prisma.user.findUnique({ where: { id: A.id } });
  check('同じ通知の再送で二重に延長しない', a.proExpiresAt.getTime() === exp1);
  check('Proになったので6件目を保存できる', (await addReceipt(ca, 6)).status === 200);
  await webhook(sessionEvent('cs_paid_2', A.id));
  a = await prisma.user.findUnique({ where: { id: A.id } });
  const days2 = (a.proExpiresAt - Date.now()) / 86400000;
  check('期限内の再購入は残り期間に1年を足す（約2年後）', days2 > 729 && days2 < 733, days2);

  console.log('8. 同時保存でもCSVの行が消えない');
  const parallel = await Promise.all([11, 12, 13, 14, 15].map((i) => addReceipt(ca, i, `同時${i}`)));
  check('同時に5件保存 → すべて200', parallel.every((x) => x.status === 200), parallel.map((x) => x.status).join(','));
  const afterParallel = ledgerText(A.id);
  check('CSVに5件とも残る', [11, 12, 13, 14, 15].every((i) => afterParallel.includes(`同時${i}`)));
  check('CSVの合計は11件', afterParallel.trim().split('\r\n').length === 12, afterParallel.trim().split('\r\n').length);

  console.log('9. 有効期限切れ');
  await prisma.user.update({ where: { id: A.id }, data: { proExpiresAt: new Date(Date.now() - 86400000) } });
  s = await getJson('/api/settings', ca);
  check('期限切れと表示される', s.isExpired && !s.isPro && !s.canAddReceipt, JSON.stringify(s));
  r = await addReceipt(ca, 7);
  check('期限切れでは追加できない → 402', r.status === 402 && (await r.json()).isExpired === true, r.status);
  check('期限切れでも一覧は見られる', (await fetch(BASE + '/api/receipts/list', { headers: { cookie: ca } })).status === 200);
  check('期限切れでもCSV出力できる', (await fetch(BASE + '/api/receipts/export', { headers: { cookie: ca } })).status === 200);
  const fdOwn = new FormData(); fdOwn.append('date', '2026-02-02'); fdOwn.append('companyName', '修正後'); fdOwn.append('totalAmount', '2222'); fdOwn.append('paymentMethod', '電子マネー'); fdOwn.append('invoiceNumber', '');
  const put = await fetch(`${BASE}/api/receipts/${aId}`, { method: 'PUT', body: fdOwn, headers: { cookie: ca } });
  check('期限切れでも自分の領収書は編集できる', put.status === 200, put.status);
  check('編集はドライブのCSVと画像名に反映', ledgerText(A.id).includes('修正後') && fakeFiles(A.id).some((f) => f.id === aId && f.name === '2026-02-02_修正後_2222円.jpg'));
  const del = await fetch(`${BASE}/api/receipts/${aId}`, { method: 'DELETE', headers: { cookie: ca } });
  check('自分の領収書は削除できる', del.status === 200, del.status);
  check('削除はCSVから行が消え、画像はドライブのゴミ箱へ', !ledgerText(A.id).includes(aId) && fakeFiles(A.id).find((f) => f.id === aId)?.trashed === true);
  check('削除後は画像も取れない', (await fetch(`${BASE}/api/receipts/${aId}/image`, { headers: { cookie: ca } })).status === 404);

  console.log('10. ドライブでフォルダが削除された場合');
  markTrashed(B.id, bFolder.id);
  s = await getJson('/api/settings', cb);
  check('フォルダが見つからないと表示', s.drive.folderExists === false && s.drive.folder?.id === bFolder.id && !s.canAddReceipt, JSON.stringify(s.drive));
  r = await addReceipt(cb, 2);
  check('その状態で保存 → 409 DRIVE_FOLDER_MISSING', r.status === 409, r.status);
  r = await createFolder(cb, '新しいフォルダ');
  body = await r.json();
  check('フォルダを作り直せる', body.created === true && body.folder.id !== bFolder.id);
  const bFolderNow = body.folder.id;
  check('作り直した後は保存できる', (await addReceipt(cb, 2)).status === 200);

  console.log('11. お店の学習（ロゴ・デザイン・分類）');
  // お店ごとの基準の見た目＋撮影ごとの揺れ、で画像認識の特徴（512バイト）を作る
  const baseVec = (seed) => { let s = seed; return Array.from({ length: 512 }, () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; }); };
  const embOf = (b, seed) => { let s = seed; const v = b.map((x) => { s = (s * 69069 + 1) % 4294967296; return x + (s / 4294967296 - 0.5) * 0.6; }); const m = Math.max(...v.map(Math.abs)); return Buffer.from(Int8Array.from(v, (x) => Math.round((x / m) * 127)).buffer).toString('base64'); };
  const CAFE = baseVec(1), BAKERY = baseVec(2);
  const sigOf = (embedding) => ({ embedding, headerHash: null, wholeHash: null, headerHue: null, phones: [], text: '' });
  async function addLearned(cookie, company, category, payment, signals) {
    const fd = new FormData();
    fd.append('image', new Blob([JPEG], { type: 'image/jpeg' }), 'r.jpg');
    fd.append('date', '2026-09-20');
    fd.append('invoiceNumber', '');
    fd.append('companyName', company);
    fd.append('totalAmount', '800');
    fd.append('paymentMethod', payment);
    fd.append('category', category);
    if (signals) fd.append('signals', JSON.stringify(signals));
    const res = await fetch(`${BASE}/api/receipts`, { method: 'POST', body: fd, headers: { cookie } });
    return { status: res.status, body: await res.json() };
  }
  const cafe1 = await addLearned(cb, '喫茶ミドリ', '会議費', '電子マネー', sigOf(embOf(CAFE, 11)));
  const cafe2 = await addLearned(cb, '喫茶ミドリ', '会議費', '電子マネー', sigOf(embOf(CAFE, 12)));
  await addLearned(cb, 'パン工房ムギ', '福利厚生費', '現金', sigOf(embOf(BAKERY, 21)));
  await addLearned(cb, 'パン工房ムギ', '福利厚生費', '現金', sigOf(embOf(BAKERY, 22)));
  check('手がかり付きで保存 → 200', cafe1.status === 200 && cafe2.status === 200, cafe1.status);
  check('保存した領収書に分類が入る', cafe1.body.receipt.category === '会議費');
  check('ドライブのCSVに分類の列と値がある', /ID,日付,会社名,登録番号,金額,支払い方法,分類,/.test(ledgerText(B.id, bFolderNow)) && ledgerText(B.id, bFolderNow).includes('会議費'));
  const patternsFile = fakeFiles(B.id).find((f) => f.appProperties?.kind === 'patterns' && !f.trashed && f.parents?.includes(bFolderNow));
  check('ドライブに店舗パターン.jsonができる', patternsFile?.name === '店舗パターン.json');
  const matchRes = await fetch(`${BASE}/api/stores/match`, { method: 'POST', headers: { cookie: cb, 'content-type': 'application/json' }, body: JSON.stringify({ signals: sigOf(embOf(CAFE, 99)) }) });
  const match = await matchRes.json();
  const topMatch = match.candidates?.[0];
  check('文字なしでも、ロゴ・デザインから「喫茶ミドリ」と判別して自動入力', topMatch?.companyName === '喫茶ミドリ' && topMatch.autoFill === true, JSON.stringify(match));
  check('判別したお店のいつもの支払い方法・分類が付く', topMatch?.paymentMethod === '電子マネー' && topMatch?.category === '会議費');
  check('他人（A）の学習では判別されない', (await (await fetch(`${BASE}/api/stores/match`, { method: 'POST', headers: { cookie: ca, 'content-type': 'application/json' }, body: JSON.stringify({ signals: sigOf(embOf(CAFE, 99)) }) })).json()).candidates.every((c) => c.companyName !== '喫茶ミドリ'));
  const freq = await getJson('/api/stores', cb);
  check('よく使うお店に出る（2回）', freq.some((s) => s.companyName === '喫茶ミドリ' && s.count === 2), JSON.stringify(freq));
  const fdFix = new FormData(); fdFix.append('date', '2026-09-20'); fdFix.append('companyName', '喫茶アオ'); fdFix.append('totalAmount', '800'); fdFix.append('paymentMethod', '電子マネー'); fdFix.append('invoiceNumber', ''); fdFix.append('category', '会議費');
  check('店名を訂正 → 200', (await fetch(`${BASE}/api/receipts/${cafe1.body.receipt.id}`, { method: 'PUT', body: fdFix, headers: { cookie: cb } })).status === 200);
  let freq2 = await getJson('/api/stores', cb);
  check('訂正すると、元のお店の回数が減る', !freq2.some((s) => s.companyName === '喫茶ミドリ'), JSON.stringify(freq2));
  check('削除 → 200', (await fetch(`${BASE}/api/receipts/${cafe2.body.receipt.id}`, { method: 'DELETE', headers: { cookie: cb } })).status === 200);
  const patterns = JSON.parse(fs.readFileSync(path.join(FAKE, B.id, `${patternsFile.id}.bin`), 'utf8'));
  check('削除すると、そのお店の学習も消える', !patterns.stores.some((s) => s.companyName === '喫茶ミドリ'), JSON.stringify(patterns.stores.map((s) => [s.companyName, s.count])));
  check('訂正したお店として学習し直される', patterns.stores.some((s) => s.companyName === '喫茶アオ' && s.fingerprints.length === 1));
  check('手がかりなしの保存も今までどおりできる', (await addLearned(cb, '手入力の店', '', '現金', null)).status === 200);
  // 学習ファイルが消えても、ドライブの領収書から学習し直す
  markTrashed(B.id, patternsFile.id);
  const rebuiltMatch = await (await fetch(`${BASE}/api/stores/match`, { method: 'POST', headers: { cookie: cb, 'content-type': 'application/json' }, body: JSON.stringify({ signals: sigOf(embOf(BAKERY, 98)) }) })).json();
  check('店舗パターン.jsonを消しても、画像に残した手がかりから学習し直す', rebuiltMatch.candidates?.[0]?.companyName === 'パン工房ムギ' && rebuiltMatch.candidates[0].autoFill === true, JSON.stringify(rebuiltMatch));

  console.log('12. スタッフ（代表者の帳簿を複数人で使う）');
  const staffApi = (cookie, method, p = '', bodyObj) => fetch(`${BASE}/api/staff${p}`, {
    method, headers: { cookie, 'content-type': 'application/json' }, body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
  const putReceipt = (cookie, id, fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ date: '2026-10-01', invoiceNumber: '', totalAmount: '500', paymentMethod: '現金', ...fields })) fd.append(k, v);
    return fetch(`${BASE}/api/receipts/${id}`, { method: 'PUT', body: fd, headers: { cookie } });
  };
  r = await staffApi(cc, 'POST', '', { loginId: 'nopro', displayName: '無料', password: 'password-123' });
  check('Proでない代表者はスタッフを追加できない → 402', r.status === 402, r.status);
  r = await staffApi(cb, 'POST', '', { loginId: 'Tanaka', displayName: '田中', password: 'password-123' });
  body = await r.json();
  check('Proの代表者はスタッフを追加できる（IDは小文字にそろう）', r.status === 200 && body.staff.loginId === 'tanaka' && body.password === 'password-123', JSON.stringify(body));
  const s1 = body.staff;
  check('応答にパスワードの変換値は含まれない', !JSON.stringify(body).includes('scrypt'));
  check('同じログインID → 409', (await staffApi(cb, 'POST', '', { loginId: 'tanaka', displayName: '別人', password: 'password-123' })).status === 409);
  check('他の代表者でも同じログインIDは使えない → 409', (await staffApi(cb, 'POST', '', { loginId: 'TANAKA ', displayName: '別人', password: 'password-123' })).status === 409);
  check('ログインIDの形式違反 → 400', (await staffApi(cb, 'POST', '', { loginId: 'あ', displayName: 'x', password: 'password-123' })).status === 400);
  check('短いパスワード → 400', (await staffApi(cb, 'POST', '', { loginId: 'shortpw', displayName: 'x', password: '1234567' })).status === 400);
  r = await staffApi(cb, 'POST', '', { loginId: 'sato', displayName: '佐藤' });
  body = await r.json();
  check('パスワード省略で12文字が発行される', r.status === 200 && /^[a-z2-9]{12}$/.test(body.password), JSON.stringify(body));
  const s2 = body.staff, s2pw = body.password;
  const s3 = (await (await staffApi(cb, 'POST', '', { loginId: 'suzuki', displayName: '鈴木', password: 'password-333' })).json()).staff;
  const extra = await Promise.all(['st4', 'st5', 'st6', 'st7'].map((id) => staffApi(cb, 'POST', '', { loginId: id, displayName: id, password: 'password-123' })));
  check('同時に追加しても5人まで（6人目以降 → 409）', extra.filter((x) => x.status === 200).length === 2 && extra.filter((x) => x.status === 409).length === 2, extra.map((x) => x.status).join(','));
  const staffList = await getJson('/api/staff', cb);
  check('スタッフ一覧は5人', staffList.length === 5, staffList.length);

  let li = await staffLogin('tanaka', 'wrong-password');
  check('間違ったパスワードではログインできない', li.cookie === null && li.error === 'CredentialsSignin', JSON.stringify(li));
  li = await staffLogin('nobody', 'password-123');
  check('存在しないIDも同じ失敗', li.cookie === null && li.error === 'CredentialsSignin', JSON.stringify(li));
  li = await staffLogin(' Tanaka', 'password-123');
  check('正しいID・パスワードでログインできる', !!li.cookie, JSON.stringify(li));
  const cs1 = li.cookie;
  const cs2 = (await staffLogin('sato', s2pw)).cookie;
  const sess = await getJson('/api/auth/session', cs1);
  check('セッションは代表者の帳簿とスタッフID', sess.user?.id === B.id && sess.user?.staffId === s1.id && sess.user?.name === '田中', JSON.stringify(sess));

  s = await getJson('/api/settings', cs1);
  check('スタッフの設定はrole=staff・代表者のドライブのリンクを出さない', s.role === 'staff' && s.drive.ledgerUrl === null && s.drive.folder === null && s.canAddReceipt === true, JSON.stringify(s));
  r = await addReceipt(cs1, 21, '田中の立替');
  body = await r.json();
  check('スタッフが登録 → 200・登録者が自分', r.status === 200 && body.receipt.registeredBy === '田中' && body.receipt.registeredById === s1.id, JSON.stringify(body));
  const s1Receipt = body.receipt.id;
  const s2Receipt = (await (await addReceipt(cs2, 22, '佐藤の立替')).json()).receipt.id;
  const csvB = ledgerText(B.id, bFolderNow);
  check('代表者のドライブのCSVに登録者・登録者IDが入る', csvB.split('\r\n')[0].endsWith('登録者,登録者ID') && csvB.includes(`田中,${s1.id}`));
  const ownerList = await getJson('/api/receipts/list', cb);
  const ownerReceipt = ownerList.find((x) => !x.registeredById).id;
  check('代表者の一覧には全員分（登録者付き）', ownerList.some((x) => x.registeredBy === '田中') && ownerList.some((x) => x.registeredBy === '佐藤'));
  let sl = await getJson('/api/receipts/list', cs1);
  check('スタッフの一覧は自分の分だけ', sl.length === 1 && sl[0].id === s1Receipt, JSON.stringify(sl.map((x) => x.companyName)));
  check('スタッフは代表者の分の画像 → 404', (await fetch(`${BASE}/api/receipts/${ownerReceipt}/image`, { headers: { cookie: cs1 } })).status === 404);
  check('スタッフは他のスタッフの分の画像 → 404', (await fetch(`${BASE}/api/receipts/${s2Receipt}/image`, { headers: { cookie: cs1 } })).status === 404);
  check('スタッフは自分の分の画像を見られる', (await fetch(`${BASE}/api/receipts/${s1Receipt}/image`, { headers: { cookie: cs1 } })).status === 200);
  check('スタッフは代表者の分を修正できない → 404', (await putReceipt(cs1, ownerReceipt, { companyName: '乗っ取り' })).status === 404);
  check('スタッフは他のスタッフの分を修正できない → 404', (await putReceipt(cs1, s2Receipt, { companyName: '乗っ取り' })).status === 404);
  check('帳簿は書き換わっていない', !ledgerText(B.id, bFolderNow).includes('乗っ取り'));
  r = await putReceipt(cs1, s1Receipt, { companyName: '田中の修正', registeredBy: '代表者', registeredById: '' });
  body = await r.json();
  check('自分の分は修正でき、登録者は書き換えられない', r.status === 200 && body.companyName === '田中の修正' && body.registeredById === s1.id && body.registeredBy === '田中', JSON.stringify(body));
  check('代表者はスタッフの分も修正できる', (await putReceipt(cb, s2Receipt, { companyName: '代表者が修正' })).status === 200);
  check('代表者が直してもスタッフの登録者は残る', (await getJson('/api/receipts/list', cs2)).some((x) => x.id === s2Receipt && x.companyName === '代表者が修正'));
  check('スタッフは自分の分も削除できない → 403', (await fetch(`${BASE}/api/receipts/${s1Receipt}`, { method: 'DELETE', headers: { cookie: cs1 } })).status === 403);
  check('スタッフはCSV出力できない → 403', (await fetch(`${BASE}/api/receipts/export`, { headers: { cookie: cs1 } })).status === 403);
  check('スタッフはフォルダを作れない → 403', (await createFolder(cs1, 'x')).status === 403);
  check('スタッフはPro購入できない → 403', (await fetch(`${BASE}/api/checkout`, { method: 'POST', headers: { cookie: cs1 } })).status === 403);
  check('スタッフはスタッフ一覧を見られない → 403', (await staffApi(cs1, 'GET')).status === 403);
  check('スタッフはスタッフを追加できない → 403', (await staffApi(cs1, 'POST', '', { loginId: 'evil', displayName: 'x', password: 'password-123' })).status === 403);
  check('スタッフは他のスタッフのパスワードを再設定できない → 403', (await staffApi(cs1, 'PATCH', `/${s2.id}`, { resetPassword: true })).status === 403);
  check('スタッフもお店の候補は使える', (await fetch(`${BASE}/api/stores`, { headers: { cookie: cs1 } })).status === 200);
  check('他の代表者（A）はBのスタッフを再設定できない → 404', (await staffApi(ca, 'PATCH', `/${s1.id}`, { resetPassword: true })).status === 404);
  check('他の代表者（A）はBのスタッフを削除できない → 404', (await staffApi(ca, 'DELETE', `/${s1.id}`)).status === 404);

  const before = ledgerText(B.id, bFolderNow).trim().split('\r\n').length;
  const mixed = await Promise.all([
    addReceipt(cb, 23, '同時B1'), addReceipt(cs1, 24, '同時S1'), addReceipt(cs2, 25, '同時S2'),
    addReceipt(cb, 26, '同時B2'), addReceipt(cs1, 27, '同時S3'), addReceipt(cs2, 28, '同時S4'),
  ]);
  const afterMixed = ledgerText(B.id, bFolderNow);
  check('代表者とスタッフが同時に登録しても行が欠けない', mixed.every((x) => x.status === 200) && afterMixed.trim().split('\r\n').length === before + 6
    && ['同時B1', '同時S1', '同時S2', '同時B2', '同時S3', '同時S4'].every((n) => afterMixed.includes(n)), mixed.map((x) => x.status).join(','));

  for (let i = 0; i < 10; i++) await staffLogin('suzuki', 'wrong-password');
  li = await staffLogin('suzuki', 'password-333');
  check('10回失敗すると正しいパスワードでも停止中', li.cookie === null && li.error === 'STAFF_LOCKED', JSON.stringify(li));
  check('一覧に停止中と出る', (await getJson('/api/staff', cb)).find((x) => x.id === s3.id)?.locked === true);
  r = await staffApi(cb, 'PATCH', `/${s3.id}`, { resetPassword: true, password: 'new-password-3' });
  check('代表者がパスワードを再設定 → 200', r.status === 200 && (await r.json()).password === 'new-password-3');
  check('再設定で停止が解除され、新しいパスワードで入れる', !!(await staffLogin('suzuki', 'new-password-3')).cookie);

  r = await staffApi(cb, 'PATCH', `/${s1.id}`, { resetPassword: true });
  check('田中のパスワードを再設定', r.status === 200);
  check('再設定前のログインは次の操作で無効（401）', (await fetch(`${BASE}/api/receipts/list`, { headers: { cookie: cs1 } })).status === 401);
  check('画面のセッションからも外れる', !(await getJson('/api/auth/session', cs1)).user);
  check('古いパスワードではログインできない', !(await staffLogin('tanaka', 'password-123')).cookie);
  check('表示名を変更できる', (await staffApi(cb, 'PATCH', `/${s2.id}`, { displayName: '佐藤（経理）' })).status === 200);
  check('表示名の変更ではログインは切れない', (await fetch(`${BASE}/api/receipts/list`, { headers: { cookie: cs2 } })).status === 200);

  markTrashed(B.id, bFolderNow);
  r = await addReceipt(cs2, 29);
  body = await r.json();
  check('代表者のフォルダが無いとき、スタッフには代表者に依頼する案内', r.status === 409 && body.code === 'DRIVE_OWNER' && body.error.includes('代表者'), JSON.stringify(body));
  s = await getJson('/api/settings', cs2);
  check('スタッフの設定にも代表者に依頼する案内', !s.canAddReceipt && s.reason.includes('代表者'), JSON.stringify(s));
  const bFolderFile = path.join(FAKE, B.id, `${bFolderNow}.json`);
  fs.writeFileSync(bFolderFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(bFolderFile, 'utf8')), trashed: false }));
  await prisma.user.update({ where: { id: B.id }, data: { proExpiresAt: new Date(Date.now() - 86400000) } });
  r = await addReceipt(cs2, 30);
  body = await r.json();
  check('代表者のProが切れたら、スタッフは登録できず代表者に連絡する案内（402）', r.status === 402 && body.error.includes('代表者に連絡'), JSON.stringify(body));
  check('Proが切れてもスタッフは自分の分を見られる', (await getJson('/api/receipts/list', cs2)).length >= 1);

  check('スタッフを削除 → 200', (await staffApi(cb, 'DELETE', `/${s2.id}`)).status === 200);
  check('削除されたスタッフは次の操作で401', (await fetch(`${BASE}/api/receipts/list`, { headers: { cookie: cs2 } })).status === 401);
  check('削除しても過去の領収書と登録者名は帳簿に残る', ledgerText(B.id, bFolderNow).includes('佐藤'));
  check('削除したスタッフはログインできない', !(await staffLogin('sato', s2pw)).cookie);

  console.log(`\n結果: ${pass} OK / ${fail} FAIL`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
