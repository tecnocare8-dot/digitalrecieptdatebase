import { del, get, put } from '@vercel/blob';
import fs from 'fs/promises';
import path from 'path';

// 領収書画像の保存先。本番は Vercel Blob の非公開ストア（BLOB_READ_WRITE_TOKEN 必須）。
// トークンが無い手元の環境（Vercel以外）に限り、公開されないプロジェクト直下の .local-uploads/ に保存する。
const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

if (!useBlob && process.env.VERCEL) {
  // Vercel上でローカル保存に落ちると画像が消えるため、黙って続行せずに失敗させる
  console.error('BLOB_READ_WRITE_TOKEN is not set; receipt image storage is unavailable.');
}

const localRoot = path.join(process.cwd(), '.local-uploads');

function localPath(key: string) {
  const resolved = path.resolve(localRoot, key);
  if (!resolved.startsWith(localRoot + path.sep)) throw new Error('Invalid image key');
  return resolved;
}

function assertAvailable() {
  if (!useBlob && process.env.VERCEL) {
    throw new Error('画像の保存先（Vercel Blob）が設定されていません。');
  }
}

export async function saveImage(key: string, data: Buffer, contentType: string): Promise<void> {
  assertAvailable();
  if (useBlob) {
    await put(key, data, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: false });
    return;
  }
  const p = localPath(key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data);
}

export async function readImage(key: string): Promise<{ body: ReadableStream | Buffer; contentType: string } | null> {
  assertAvailable();
  if (useBlob) {
    const result = await get(key, { access: 'private' });
    if (!result || result.statusCode !== 200) return null;
    return { body: result.stream, contentType: result.blob.contentType };
  }
  try {
    return { body: await fs.readFile(localPath(key)), contentType: 'image/jpeg' };
  } catch {
    return null;
  }
}

export async function deleteImage(key: string): Promise<void> {
  assertAvailable();
  if (useBlob) {
    await del(key);
    return;
  }
  await fs.rm(localPath(key), { force: true });
}
