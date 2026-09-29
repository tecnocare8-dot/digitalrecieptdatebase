// 手元で起動したアプリに実際のHTTPリクエストを送り、利用者の分離・5件制限・Stripe webhook・期限切れを確認する。
// ※ テスト用DBの User / Receipt / Payment を全削除するので、本番DBに向けて実行しないこと。
//
//   npm run build && npx next start -p 3100 &
//   E2E_BASE=http://localhost:3100 node --env-file=.env scripts/e2e-local.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { encode } = require('next-auth/jwt');
const Stripe = require('stripe');
const { PrismaClient } = require('@prisma/client');

const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const SECRET = process.env.NEXTAUTH_SECRET;
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET;

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  console.error('DATABASE_URL がローカルではありません。テストはDBを全削除するため中止します。');
  process.exit(1);
}

const prisma = new PrismaClient();
const stripe = new Stripe('sk_test_unused');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

async function cookieFor(user) {
  const token = await encode({ token: { email: user.email, userId: user.id, sub: user.id }, secret: SECRET });
  return `next-auth.session-token=${token}`;
}

// 最小のJPEG(1x1)
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function addReceipt(cookie, i) {
  const fd = new FormData();
  fd.append('image', new Blob([JPEG], { type: 'image/jpeg' }), 'r.jpg');
  fd.append('date', `2026-09-${String(i).padStart(2, '0')}`);
  fd.append('invoiceNumber', 'T1234567890123');
  fd.append('companyName', `テスト商店${i}`);
  fd.append('totalAmount', String(1000 + i));
  fd.append('paymentMethod', '現金');
  return fetch(`${BASE}/api/receipts`, { method: 'POST', body: fd, headers: { cookie } });
}

async function webhook(payloadObj, { sign = true, badSig = false } = {}) {
  const payload = JSON.stringify(payloadObj);
  const headers = { 'content-type': 'application/json' };
  if (sign) headers['stripe-signature'] = stripe.webhooks.generateTestHeaderString({ payload, secret: badSig ? 'whsec_wrong' : WHSEC });
  return fetch(`${BASE}/api/webhook/stripe`, { method: 'POST', body: payload, headers });
}

function sessionEvent(id, userId, paid = true) {
  return {
    id: 'evt_' + id, object: 'event', type: 'checkout.session.completed',
    data: { object: { id, object: 'checkout.session', client_reference_id: userId, payment_status: paid ? 'paid' : 'unpaid', amount_total: 1500, currency: 'jpy' } },
  };
}

async function main() {
  await prisma.payment.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.user.deleteMany();
  const A = await prisma.user.create({ data: { email: 'a@example.com' } });
  const B = await prisma.user.create({ data: { email: 'b@example.com' } });
  const ca = await cookieFor(A), cb = await cookieFor(B);

  console.log('1. 未ログイン');
  for (const p of ['/api/settings', '/api/receipts/list', '/api/receipts/export', '/api/receipts/1/image', '/api/invoice-lookup?invoiceNumber=T1234567890123']) {
    const r = await fetch(BASE + p);
    check(`${p} → 401`, r.status === 401, r.status);
  }
  check('POST /api/receipts → 401', (await addReceipt('', 1)).status === 401);
  check('POST /api/checkout → 401', (await fetch(BASE + '/api/checkout', { method: 'POST' })).status === 401);

  console.log('2. 無料プラン5件の上限（利用者ごと）');
  let s = await (await fetch(BASE + '/api/settings', { headers: { cookie: ca } })).json();
  check('Aは無料・0件', !s.isPro && !s.isExpired && s.receiptCount === 0 && s.canAddReceipt, JSON.stringify(s));
  for (let i = 1; i <= 5; i++) {
    const r = await addReceipt(ca, i);
    check(`Aの${i}件目 → 200`, r.status === 200, r.status);
  }
  const r6 = await addReceipt(ca, 6);
  check('Aの6件目 → 402', r6.status === 402, r6.status);
  check('Bは影響を受けず保存できる', (await addReceipt(cb, 1)).status === 200);

  console.log('3. 他人のデータは見えない・触れない');
  const listA = await (await fetch(BASE + '/api/receipts/list', { headers: { cookie: ca } })).json();
  const listB = await (await fetch(BASE + '/api/receipts/list', { headers: { cookie: cb } })).json();
  check('Aの一覧は5件', listA.length === 5, listA.length);
  check('Bの一覧は1件', listB.length === 1, listB.length);
  check('一覧に保存先パス(imageKey)やuserIdを出さない', !('imageKey' in listA[0]) && !('userId' in listA[0]));
  const aId = listA[0].id;
  check('BがAの画像 → 404', (await fetch(`${BASE}/api/receipts/${aId}/image`, { headers: { cookie: cb } })).status === 404);
  check('BがAの領収書を削除 → 404', (await fetch(`${BASE}/api/receipts/${aId}`, { method: 'DELETE', headers: { cookie: cb } })).status === 404);
  const fdPut = new FormData(); fdPut.append('date', '2026-01-01'); fdPut.append('companyName', '乗っ取り'); fdPut.append('totalAmount', '1'); fdPut.append('paymentMethod', '現金'); fdPut.append('invoiceNumber', '');
  check('BがAの領収書を編集 → 404', (await fetch(`${BASE}/api/receipts/${aId}`, { method: 'PUT', body: fdPut, headers: { cookie: cb } })).status === 404);
  const csvB = await (await fetch(BASE + '/api/receipts/export', { headers: { cookie: cb } })).text();
  check('BのCSVにAの会社名が出ない', !csvB.includes('テスト商店5') && csvB.includes('テスト商店1'));
  const imgA = await fetch(`${BASE}/api/receipts/${aId}/image`, { headers: { cookie: ca } });
  const imgBytes = Buffer.from(await imgA.arrayBuffer());
  check('Aは自分の画像を取得でき、保存した内容と一致', imgA.status === 200 && imgBytes.equals(JPEG), imgA.status);
  const lkBody = await (await fetch(`${BASE}/api/invoice-lookup?invoiceNumber=T1234567890123`, { headers: { cookie: cb } })).json();
  check('登録番号の照会はBの履歴のみ（Aの会社名が出ない）', lkBody.companyName === 'テスト商店1', JSON.stringify(lkBody));

  console.log('4. Stripe webhook');
  check('署名なし → 400', (await webhook(sessionEvent('cs_fake', A.id), { sign: false })).status === 400);
  check('偽の署名 → 400', (await webhook(sessionEvent('cs_fake', A.id), { badSig: true })).status === 400);
  let a = await prisma.user.findUnique({ where: { id: A.id } });
  check('偽の通知ではProにならない', a.proExpiresAt === null);
  check('未払いの通知 → 200', (await webhook(sessionEvent('cs_unpaid', A.id, false))).status === 200);
  a = await prisma.user.findUnique({ where: { id: A.id } });
  check('未払いではProにならない', a.proExpiresAt === null);

  const w1 = await webhook(sessionEvent('cs_paid_1', A.id));
  check('本物の署名・支払い済み → 200', w1.status === 200, w1.status);
  a = await prisma.user.findUnique({ where: { id: A.id } });
  const days1 = (a.proExpiresAt - Date.now()) / 86400000;
  check('Aの有効期限が約1年後', days1 > 364 && days1 < 367, days1);
  const b = await prisma.user.findUnique({ where: { id: B.id } });
  check('BはProにならない（全員Proにならない）', b.proExpiresAt === null);
  const exp1 = a.proExpiresAt.getTime();
  await webhook(sessionEvent('cs_paid_1', A.id));
  a = await prisma.user.findUnique({ where: { id: A.id } });
  check('同じ通知の再送で二重に延長しない', a.proExpiresAt.getTime() === exp1);
  check('Proになったので6件目を保存できる', (await addReceipt(ca, 6)).status === 200);

  await webhook(sessionEvent('cs_paid_2', A.id));
  a = await prisma.user.findUnique({ where: { id: A.id } });
  const days2 = (a.proExpiresAt - Date.now()) / 86400000;
  check('期限内の再購入は残り期間に1年を足す（約2年後）', days2 > 729 && days2 < 733, days2);

  console.log('5. 有効期限切れ');
  await prisma.user.update({ where: { id: A.id }, data: { proExpiresAt: new Date(Date.now() - 86400000) } });
  s = await (await fetch(BASE + '/api/settings', { headers: { cookie: ca } })).json();
  check('期限切れと表示される', s.isExpired && !s.isPro && !s.canAddReceipt, JSON.stringify(s));
  const r7 = await addReceipt(ca, 7);
  const r7b = await r7.json();
  check('期限切れでは追加できない → 402', r7.status === 402 && r7b.isExpired === true, r7.status);
  check('期限切れでも一覧は見られる', (await fetch(BASE + '/api/receipts/list', { headers: { cookie: ca } })).status === 200);
  check('期限切れでもCSV出力できる', (await fetch(BASE + '/api/receipts/export', { headers: { cookie: ca } })).status === 200);
  const fdOwn = new FormData(); fdOwn.append('date', '2026-02-02'); fdOwn.append('companyName', '修正後'); fdOwn.append('totalAmount', '2222'); fdOwn.append('paymentMethod', '電子マネー'); fdOwn.append('invoiceNumber', '');
  const put = await fetch(`${BASE}/api/receipts/${aId}`, { method: 'PUT', body: fdOwn, headers: { cookie: ca } });
  check('期限切れでも自分の領収書は編集できる', put.status === 200, put.status);
  const del = await fetch(`${BASE}/api/receipts/${aId}`, { method: 'DELETE', headers: { cookie: ca } });
  check('自分の領収書は削除できる', del.status === 200, del.status);
  check('削除後は画像も取れない', (await fetch(`${BASE}/api/receipts/${aId}/image`, { headers: { cookie: ca } })).status === 404);

  console.log(`\n結果: ${pass} OK / ${fail} FAIL`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
