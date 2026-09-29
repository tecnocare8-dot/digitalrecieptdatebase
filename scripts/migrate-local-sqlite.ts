/**
 * 旧版（SQLite + public/uploads）の領収書を、指定アカウントの Google ドライブ（保存用フォルダ・一覧CSV）へ移す。
 *
 * 事前準備: 移行先のアカウントでアプリにログインし、設定画面で「Googleドライブと連携」「フォルダを作成」まで済ませる。
 * 実行（.env に本番の DATABASE_URL / DATABASE_URL_UNPOOLED / NEXTAUTH_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を設定）:
 *   npm run migrate-local -- --email you@example.com --sqlite ../prisma/dev.db --uploads ../public/uploads [--dry-run]
 *
 * - 同じ内容（日付・金額・会社名・登録番号・登録日時）が既にドライブの一覧CSVにある行は飛ばすので、途中で止まっても再実行できる
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { driveForUser, type ReceiptRecord } from '../lib/drive';

interface OldReceipt {
  id: number;
  date: number | string | null;
  invoiceNumber: string | null;
  companyName: string | null;
  totalAmount: number | null;
  paymentMethod: string | null;
  imagePath: string;
  imageHash: string | null;
  createdAt: number | string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Prisma の SQLite は DateTime をミリ秒の数値で保存している
function toDate(v: number | string | null): Date | null {
  if (v === null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : /^\d+$/.test(v) ? new Date(Number(v)) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// 旧版は日本時間の日付を UTC 0時として保存していたため、日本時間に直して日付部分を取る
function toJstDateString(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

const keyOf = (r: Pick<ReceiptRecord, 'date' | 'totalAmount' | 'companyName' | 'invoiceNumber' | 'createdAt'>) =>
  [r.date, r.totalAmount, r.companyName, r.invoiceNumber, r.createdAt].join('|');

async function main() {
  const email = arg('email');
  const sqlitePath = arg('sqlite');
  const uploadsDir = arg('uploads');
  const dryRun = process.argv.includes('--dry-run');

  if (!email || !sqlitePath || !uploadsDir) {
    console.error('Usage: --email <email> --sqlite <path/to/dev.db> --uploads <path/to/public/uploads> [--dry-run]');
    process.exit(1);
  }

  const json = execFileSync('sqlite3', ['-json', sqlitePath, 'SELECT * FROM Receipt ORDER BY id'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows: OldReceipt[] = json.trim() ? JSON.parse(json) : [];
  console.log(`旧DBの領収書: ${rows.length}件`);

  // 旧版は日付や支払い方法の修正時にファイル名を変えていたため、DBのパスと実ファイル名がずれている行がある。
  // その場合は保存時の画像ハッシュ(imageHash)が一致するファイルを使う（名前の推測はしない）
  const byHash = new Map<string, string>();
  for (const name of fs.readdirSync(uploadsDir)) {
    const p = path.join(uploadsDir, name);
    if (!fs.statSync(p).isFile()) continue;
    byHash.set(createHash('sha256').update(fs.readFileSync(p)).digest('hex'), p);
  }

  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user && !dryRun) {
    console.error(`${email} のアカウントがありません。先にアプリにログインし、ドライブ連携とフォルダ作成を済ませてください。`);
    process.exit(1);
  }
  const drive = user ? await driveForUser(user.id) : null;
  const existing = new Set((drive && user?.driveFolderId ? await drive.listReceipts() : []).map(keyOf));

  let migrated = 0;
  let skipped = 0;
  const missing: string[] = [];
  const recovered: string[] = [];

  for (const r of rows) {
    let filePath = path.join(uploadsDir, path.basename(r.imagePath));
    if (!fs.existsSync(filePath)) {
      const match = r.imageHash ? byHash.get(r.imageHash) : undefined;
      if (!match) {
        missing.push(`id=${r.id} ${r.imagePath}`);
        continue;
      }
      recovered.push(`id=${r.id} ${r.imagePath} → ${path.basename(match)}`);
      filePath = match;
    }

    const meta = {
      date: toJstDateString(toDate(r.date)),
      invoiceNumber: r.invoiceNumber,
      companyName: r.companyName,
      totalAmount: r.totalAmount,
      paymentMethod: r.paymentMethod,
      createdAt: (toDate(r.createdAt) ?? new Date()).toISOString(),
    };
    if (existing.has(keyOf(meta))) {
      skipped++;
      continue;
    }
    if (dryRun) {
      migrated++;
      continue;
    }

    await drive!.addReceipt(meta, fs.readFileSync(filePath), () => true);
    existing.add(keyOf(meta));
    migrated++;
    if (migrated % 50 === 0) console.log(`  ${migrated}件 移行済み...`);
  }

  console.log(`${dryRun ? '[dry-run] 移行予定' : '移行'}: ${migrated}件 / 移行済みのため飛ばした: ${skipped}件 / 画像が無く移行できない: ${missing.length}件`);
  for (const m of recovered) console.log(`  ファイル名違いを画像ハッシュで特定: ${m}`);
  for (const m of missing) console.log(`  画像なし: ${m}`);
  console.log(`移行先: ${email}${drive?.folder ? ` / フォルダ ${drive.folder.url}` : ''}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
