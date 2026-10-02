/**
 * スタッフアカウントの単体テスト（パスワード・入力チェック・帳簿の登録者列・ログイン停止）。
 *   npm run test:staff
 * ログインの節はテスト用DBを使う（DATABASE_URL がローカルのときだけ実行）。
 */
import assert from 'assert/strict';
import {
  hashPassword, verifyPassword, validateDisplayName, validateLoginId, validatePassword,
} from '../lib/password';
import { fromCsv, toCsv, type ReceiptRecord } from '../lib/drive';

let pass = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`  OK   ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

function record(over: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: 'f1', date: '2026-10-01', invoiceNumber: null, companyName: '喫茶ミドリ', totalAmount: 800,
    paymentMethod: '現金', category: null, imageName: 'a.jpg', createdAt: '2026-10-01T00:00:00.000Z',
    registeredBy: null, registeredById: null, ...over,
  };
}

async function main() {
  console.log('パスワード');
  await test('変換した値で照合できる', async () => {
    assert.equal(await verifyPassword('correct horse', await hashPassword('correct horse')), true);
  });
  await test('違うパスワードは通らない', async () => {
    assert.equal(await verifyPassword('wrong pass', await hashPassword('correct horse')), false);
  });
  await test('同じパスワードでも毎回違う値になり、平文を含まない', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    assert.notEqual(a, b);
    assert.ok(!a.includes('correct'));
  });
  await test('壊れた保存値では例外にならず false', async () => {
    assert.equal(await verifyPassword('x', ''), false);
    assert.equal(await verifyPassword('x', 'scrypt$abc'), false);
    assert.equal(await verifyPassword('x', 'scrypt$!!$!!'), false);
  });

  console.log('入力チェック');
  await test('ログインID', () => {
    assert.equal(validateLoginId('tanaka-01'), null);
    assert.ok(validateLoginId('ab'));
    assert.ok(validateLoginId('Tanaka'));
    assert.ok(validateLoginId('田中'));
    assert.ok(validateLoginId('a'.repeat(33)));
  });
  await test('パスワードは8文字以上・200文字以下', () => {
    assert.equal(validatePassword('12345678'), null);
    assert.ok(validatePassword('1234567'));
    assert.ok(validatePassword('a'.repeat(201)));
  });
  await test('表示名は1〜30文字（前後の空白は数えない）', () => {
    assert.equal(validateDisplayName('田中'), null);
    assert.ok(validateDisplayName('   '));
    assert.ok(validateDisplayName('あ'.repeat(31)));
  });

  console.log('帳簿の登録者列');
  await test('登録者・登録者IDが往復する', () => {
    const csv = toCsv([record({ registeredBy: '田中', registeredById: 'stf1' })]);
    assert.ok(csv.split('\r\n')[0].endsWith(',登録者,登録者ID'));
    const [r] = fromCsv(csv);
    assert.equal(r.registeredBy, '田中');
    assert.equal(r.registeredById, 'stf1');
  });
  await test('登録者列のない旧CSVは代表者の分（null）として読む', () => {
    const old = '﻿ID,日付,会社名,登録番号,金額,支払い方法,分類,画像ファイル名,画像リンク,登録日時\r\nf9,2026-09-01,旧,,100,現金,,x.jpg,,2026-09-01T00:00:00Z\r\n';
    const [r] = fromCsv(old);
    assert.equal(r.id, 'f9');
    assert.equal(r.registeredBy, null);
    assert.equal(r.registeredById, null);
  });
  await test('Excelで列を並べ替えても登録者IDを読める', () => {
    const csv = 'ID,登録者ID,金額,登録者\r\nf2,stf2,500,佐藤\r\n';
    const [r] = fromCsv(csv);
    assert.equal(r.registeredById, 'stf2');
    assert.equal(r.registeredBy, '佐藤');
  });

  if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
    console.log('ログイン（テスト用DB）');
    const { prisma } = await import('../lib/prisma');
    const { authenticateStaff } = await import('../lib/staff-login');
    const owner = await prisma.user.create({ data: { email: `owner-${Date.now()}@example.com` } });
    const staff = await prisma.staff.create({
      data: { ownerId: owner.id, loginId: `t${Date.now()}`, displayName: '田中', passwordHash: await hashPassword('password-1') },
    });
    try {
      await test('正しいIDとパスワードで成功し、最終ログインが入る', async () => {
        const r = await authenticateStaff(staff.loginId, 'password-1');
        assert.equal(r.ok, true);
        const s = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
        assert.ok(s.lastLoginAt);
      });
      await test('ログインIDは大文字・前後の空白があっても同じ人として扱う', async () => {
        assert.equal((await authenticateStaff(` ${staff.loginId.toUpperCase()} `, 'password-1')).ok, true);
      });
      await test('存在しないIDは invalid', async () => {
        const r = await authenticateStaff('no-such-user', 'password-1');
        assert.deepEqual(r, { ok: false, reason: 'invalid' });
      });
      await test('9回失敗しても、成功すれば回数が0に戻る', async () => {
        for (let i = 0; i < 9; i++) await authenticateStaff(staff.loginId, 'bad');
        assert.equal((await authenticateStaff(staff.loginId, 'password-1')).ok, true);
        const s = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
        assert.equal(s.failedLoginCount, 0);
      });
      await test('10回続けて失敗すると、正しいパスワードでも停止中', async () => {
        for (let i = 0; i < 10; i++) await authenticateStaff(staff.loginId, 'bad');
        const r = await authenticateStaff(staff.loginId, 'password-1');
        assert.deepEqual(r, { ok: false, reason: 'locked' });
        const s = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
        assert.ok(s.lockedUntil && s.lockedUntil.getTime() - Date.now() > 14 * 60_000);
      });
      await test('停止時刻を過ぎれば、またログインできる', async () => {
        await prisma.staff.update({ where: { id: staff.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
        assert.equal((await authenticateStaff(staff.loginId, 'password-1')).ok, true);
      });
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
      await prisma.$disconnect();
    }
  } else {
    console.log('（DATABASE_URL がローカルではないため、ログインの節は省略）');
  }

  console.log(`\n${pass} OK`);
}

main();
