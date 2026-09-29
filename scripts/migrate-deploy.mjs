// ビルド時の prisma migrate deploy を app スキーマ向けに実行する。
// 本番Neonの public スキーマには旧版アプリの表が残っており、そのまま実行すると
// 「空でないDBには適用しない」(P3005) で止まるため、移行履歴と空チェックも app スキーマで行う。
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';

// Vercel では環境変数が直接渡される。手元のビルドでは .env から読む
if (existsSync('.env')) process.loadEnvFile('.env');

const base = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!base) {
  console.error('DATABASE_URL_UNPOOLED / DATABASE_URL が設定されていません。');
  process.exit(1);
}

const url = new URL(base);
url.searchParams.set('schema', 'app');

execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL_UNPOOLED: url.toString() },
});
