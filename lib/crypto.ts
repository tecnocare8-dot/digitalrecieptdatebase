import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// Googleのリフレッシュトークンを DB に平文で置かないための暗号化（AES-256-GCM）。
// 鍵は NEXTAUTH_SECRET から作るので、NEXTAUTH_SECRET を変えると保存済みトークンは読めなくなる（再連携が必要）
function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET が設定されていません。');
  return createHash('sha256').update(`google-refresh-token:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(encoded: string): string | null {
  try {
    const [iv, tag, data] = encoded.split('.').map((s) => Buffer.from(s, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
