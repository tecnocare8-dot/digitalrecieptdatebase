/**
 * お店の学習・判別（lib/stores.ts）の単体テスト。
 *   npm run test:stores
 */
import assert from 'assert/strict';
import {
  emptyPatterns, forget, frequentStores, learn, matchStores, sanitizeSignals, AUTO_FILL_SCORE,
  type PatternsFile, type ReceiptSignals,
} from '../lib/stores';

let pass = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`  OK   ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

// 64bitの指紋のうち n bit だけ変えたものを作る
function flip(hash: string, n: number): string {
  let bits = BigInt('0x' + hash);
  for (let i = 0; i < n; i++) bits ^= BigInt(1) << BigInt(i * 5 % 64);
  return bits.toString(16).padStart(16, '0');
}

const LAWSON_HEAD = 'f0e1d2c3b4a59687';
const SEVEN_HEAD = '0f1e2d3c4b5a6978';
const RED = [0.9, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const BLUE = [0, 0, 0, 0, 0, 0, 0, 0.1, 0.9, 0, 0, 0];

function sig(over: Partial<ReceiptSignals> = {}): ReceiptSignals {
  return { embedding: null, headerHash: null, wholeHash: null, headerHue: null, phones: [], text: '', ...over };
}

let n = 0;
function add(p: PatternsFile, store: { companyName: string | null; invoiceNumber?: string | null; paymentMethod?: string; category?: string }, s: ReceiptSignals | null) {
  n++;
  return learn(p, {
    receiptId: `r${n}`,
    companyName: store.companyName,
    invoiceNumber: store.invoiceNumber ?? null,
    paymentMethod: store.paymentMethod ?? '現金',
    category: store.category ?? null,
    usedAt: new Date(2026, 0, n).toISOString(),
    signals: s,
  });
}

function trained(): PatternsFile {
  let p = emptyPatterns();
  for (let i = 0; i < 3; i++) {
    p = add(p, { companyName: 'ローソン 渋谷店', invoiceNumber: 'T1111111111111', paymentMethod: '電子マネー', category: '会議費' },
      sig({ headerHash: flip(LAWSON_HEAD, i), wholeHash: 'aaaaaaaaaaaaaaaa', headerHue: BLUE, phones: ['0312345678'] }));
  }
  p = add(p, { companyName: 'セブン-イレブン', invoiceNumber: 'T2222222222222', paymentMethod: 'クレジットカード', category: '消耗品費' },
    sig({ headerHash: SEVEN_HEAD, wholeHash: '5555555555555555', headerHue: RED }));
  p = add(p, { companyName: 'セブン-イレブン', invoiceNumber: 'T2222222222222', paymentMethod: '現金', category: '消耗品費' },
    sig({ headerHash: flip(SEVEN_HEAD, 1), wholeHash: '5555555555555555', headerHue: RED }));
  return p;
}

console.log('学習');
test('同じ登録番号のレシートは1つのお店にまとまる', () => {
  const p = trained();
  assert.equal(p.stores.length, 2);
  assert.equal(p.stores.find((s) => s.invoiceNumber === 'T1111111111111')!.count, 3);
});
test('店名も登録番号も無いレシートは学習しない', () => {
  assert.equal(add(emptyPatterns(), { companyName: null }, sig({ headerHash: LAWSON_HEAD })).stores.length, 0);
});
test('店名だけで学習していたお店は、登録番号が分かった時点でまとめる', () => {
  let p = add(emptyPatterns(), { companyName: '株式会社 喫茶ミドリ' }, null);
  p = add(p, { companyName: '株式会社 喫茶ミドリ', invoiceNumber: 'T3333333333333' }, null);
  assert.equal(p.stores.length, 1);
  assert.equal(p.stores[0].count, 2);
  assert.equal(p.stores[0].invoiceNumber, 'T3333333333333');
});

console.log('判別');
test('登録番号が一致 → 100点で自動入力', () => {
  const [top] = matchStores(trained(), sig(), 'T1111111111111');
  assert.equal(top.companyName, 'ローソン 渋谷店');
  assert.equal(top.score, 100);
  assert.ok(top.reasons.includes('登録番号が一致'));
});
test('電話番号が一致 → 自動入力', () => {
  const [top] = matchStores(trained(), sig({ phones: ['0312345678'] }), null);
  assert.equal(top.companyName, 'ローソン 渋谷店');
  assert.ok(top.score >= AUTO_FILL_SCORE);
});
test('店名の文字が一致（全角・法人格・空白の違いは無視）', () => {
  const [top] = matchStores(trained(), sig({ text: 'ｾﾌﾞﾝ－ｲﾚﾌﾞﾝ本日はご来店' }), null);
  assert.equal(top.companyName, 'セブン-イレブン');
  assert.ok(top.score >= AUTO_FILL_SCORE, String(top.score));
});
test('単純な指紋（dHash・色）だけが似ている場合は、候補に出すだけで自動入力しない', () => {
  const [top] = matchStores(trained(), sig({ headerHash: flip(LAWSON_HEAD, 2), wholeHash: 'aaaaaaaaaaaaaaaa', headerHue: BLUE }), null);
  assert.equal(top.companyName, 'ローソン 渋谷店');
  assert.ok(top.score < AUTO_FILL_SCORE, String(top.score));
  assert.ok(top.reasons.some((r) => r.includes('ロゴ')), top.reasons.join());
});
test('判別したお店のいつもの支払い方法・分類を返す（回数の多いもの）', () => {
  const [top] = matchStores(trained(), sig(), 'T1111111111111');
  assert.equal(top.paymentMethod, '電子マネー');
  assert.equal(top.category, '会議費');
});
test('見た目が大きく違えば、どのお店にも当てはめない', () => {
  const res = matchStores(trained(), sig({ headerHash: flip(LAWSON_HEAD, 30), headerHue: null }), null);
  assert.ok(res.every((r) => r.score < AUTO_FILL_SCORE), JSON.stringify(res));
});
test('見た目だけで2つのお店が僅差なら、自動入力しない（候補として出すだけ）', () => {
  let p = emptyPatterns();
  p = add(p, { companyName: 'A店' }, sig({ headerHash: LAWSON_HEAD }));
  p = add(p, { companyName: 'B店' }, sig({ headerHash: flip(LAWSON_HEAD, 1) }));
  const res = matchStores(p, sig({ headerHash: LAWSON_HEAD }), null);
  assert.equal(res.length, 2);
  assert.ok(res[0].score < AUTO_FILL_SCORE, String(res[0].score));
});
test('学習が無ければ候補なし', () => {
  assert.deepEqual(matchStores(emptyPatterns(), sig({ headerHash: LAWSON_HEAD }), null), []);
});

console.log('画像認識の特徴（ロゴ・デザイン）');
// お店ごとの「基準の見た目」に、撮影ごとの揺れ（ノイズ）を足した特徴を作る
function base(seed: number): number[] {
  let s = seed;
  return Array.from({ length: 512 }, () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; });
}
function emb(b: number[], noise: number, seed: number): string {
  let s = seed;
  const v = b.map((x) => { s = (s * 69069 + 1) % 4294967296; return x + (s / 4294967296 - 0.5) * noise; });
  const m = Math.max(...v.map(Math.abs));
  return Buffer.from(Int8Array.from(v, (x) => Math.round((x / m) * 127)).buffer).toString('base64');
}
const CAFE = base(1), BAKERY = base(2);
function visualTrained(): PatternsFile {
  let p = emptyPatterns();
  for (let i = 0; i < 3; i++) p = add(p, { companyName: '喫茶ミドリ', category: '会議費' }, sig({ embedding: emb(CAFE, 0.6, 10 + i) }));
  for (let i = 0; i < 3; i++) p = add(p, { companyName: 'パン工房ムギ', category: '福利厚生費' }, sig({ embedding: emb(BAKERY, 0.6, 20 + i) }));
  return p;
}
test('文字が読めなくても、ロゴ・デザインがはっきり近いお店は自動入力する', () => {
  const [top] = matchStores(visualTrained(), sig({ embedding: emb(CAFE, 0.6, 99) }), null);
  assert.equal(top.companyName, '喫茶ミドリ');
  assert.ok(top.score >= AUTO_FILL_SCORE, String(top.score));
  assert.ok(top.reasons.includes('ロゴ・デザインが一致（画像認識）'), top.reasons.join());
  assert.equal(top.category, '会議費');
});
test('2つのお店の中間のような見た目なら、自動入力しない', () => {
  const mid = CAFE.map((x, i) => (x + BAKERY[i]) / 2);
  const res = matchStores(visualTrained(), sig({ embedding: emb(mid, 0.1, 5) }), null);
  assert.ok(res.every((r) => r.score < AUTO_FILL_SCORE), JSON.stringify(res.map((r) => [r.companyName, r.score])));
});
test('学習したお店が1つだけなら、見た目だけでは自動入力しない（比べる相手がいない）', () => {
  let p = emptyPatterns();
  p = add(p, { companyName: '喫茶ミドリ' }, sig({ embedding: emb(CAFE, 0.6, 1) }));
  const [top] = matchStores(p, sig({ embedding: emb(CAFE, 0.6, 2) }), null);
  assert.ok(top.score < AUTO_FILL_SCORE, String(top.score));
});
test('画像認識と店名の文字が両方合えば、さらに確かになる', () => {
  const [top] = matchStores(visualTrained(), sig({ embedding: emb(CAFE, 0.6, 7), text: '喫茶ミドリへようこそ' }), null);
  assert.equal(top.companyName, '喫茶ミドリ');
  assert.equal(top.score, 90);
});
test('画像認識の特徴は検証を通り、保存される', () => {
  const e = emb(CAFE, 0.6, 3);
  assert.equal(sanitizeSignals({ embedding: e, phones: [], text: '' })!.embedding, e);
  assert.equal(sanitizeSignals({ embedding: e.slice(0, 100), phones: [], text: '' })!.embedding, null);
  const p = add(emptyPatterns(), { companyName: 'X店' }, sig({ embedding: e }));
  assert.equal(p.stores[0].fingerprints[0].embedding, e);
});

console.log('訂正・削除');
test('削除したレシートの学習は取り消す（回数と指紋）', () => {
  let p = add(emptyPatterns(), { companyName: 'C店', category: '雑費' }, sig({ headerHash: LAWSON_HEAD }));
  const id = `r${n}`;
  p = add(p, { companyName: 'C店', category: '雑費' }, sig({ headerHash: SEVEN_HEAD }));
  p = forget(p, id, { companyName: 'C店', invoiceNumber: null, paymentMethod: '現金', category: '雑費' });
  assert.equal(p.stores[0].count, 1);
  assert.equal(p.stores[0].fingerprints.length, 1);
  assert.equal(p.stores[0].fingerprints[0].headerHash, SEVEN_HEAD);
});
test('最後の1枚を消したお店は消える', () => {
  let p = add(emptyPatterns(), { companyName: 'D店' }, null);
  p = forget(p, `r${n}`, { companyName: 'D店', invoiceNumber: null, paymentMethod: '現金', category: null });
  assert.equal(p.stores.length, 0);
});
test('店を訂正すると、見た目の指紋は正しいお店に移る', () => {
  let p = add(emptyPatterns(), { companyName: '間違った店' }, sig({ headerHash: SEVEN_HEAD }));
  const id = `r${n}`;
  const s = sig({ headerHash: SEVEN_HEAD });
  p = forget(p, id, { companyName: '間違った店', invoiceNumber: null, paymentMethod: '現金', category: null });
  p = learn(p, { receiptId: id, companyName: '正しい店', invoiceNumber: null, paymentMethod: '現金', category: null, usedAt: new Date().toISOString(), signals: s });
  assert.deepEqual(p.stores.map((x) => x.companyName), ['正しい店']);
  assert.equal(matchStores(p, sig({ headerHash: SEVEN_HEAD }), null)[0].companyName, '正しい店');
});

console.log('よく使うお店');
test('2回以上使ったお店を回数順に返す', () => {
  const p = add(trained(), { companyName: '1回だけの店' }, null);
  assert.deepEqual(frequentStores(p).map((s) => [s.companyName, s.count]), [['ローソン 渋谷店', 3], ['セブン-イレブン', 2]]);
});

console.log('入力の検証');
test('おかしな値は捨てる', () => {
  const s = sanitizeSignals({ headerHash: 'zz', wholeHash: 'ABCDEF0123456789', headerHue: [2], phones: ['0312345678', '12345', 'x'], text: 'a'.repeat(1000) })!;
  assert.equal(s.headerHash, null);
  assert.equal(s.wholeHash, null); // 大文字は受け付けない（画面側は小文字で作る）
  assert.equal(s.headerHue, null);
  assert.deepEqual(s.phones, ['0312345678']);
  assert.equal(s.text.length, 400);
  assert.equal(sanitizeSignals('nope'), null);
});

console.log(`\n結果: ${pass} OK${process.exitCode ? ' / FAILあり' : ' / 0 FAIL'}`);
