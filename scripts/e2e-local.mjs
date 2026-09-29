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

// 擬似ドライブの中身を直接見る（ドライブを開いたときに見えるもの）
function fakeFiles(userId) {
  const dir = path.join(FAKE, userId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
}
function ledgerOf(userId) {
  return fakeFiles(userId).find((f) => f.appProperties?.kind === 'ledger' && !f.trashed);
}
function ledgerText(userId) {
  const l = ledgerOf(userId);
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
  check('作成直後に空の一覧CSVがドライブにある', (ledgerText(A.id) ?? '').startsWith('﻿ID,日付,会社名,登録番号,金額,支払い方法,画像ファイル名,画像リンク,登録日時'));
  const emptyName = await createFolder(cb, '   ');
  const bFolder = (await emptyName.json()).folder;
  check('名前が空なら既定の名前で作る', bFolder.name === '領収書（デジタル領収書管理）', bFolder.name);

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
  check('作り直した後は保存できる', (await addReceipt(cb, 2)).status === 200);

  console.log(`\n結果: ${pass} OK / ${fail} FAIL`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
