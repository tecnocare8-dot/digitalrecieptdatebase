import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'crypto';

// スタッフのパスワード。平文は保存せず、塩付きの scrypt で変換した値だけを DB に置く。
// 保存形式: scrypt$<塩(base64)>$<変換値(base64)>

export const MAX_STAFF = 5;
export const MAX_FAILED_LOGINS = 10;
export const LOCK_MINUTES = 15;

const KEY_LEN = 64;

function derive(plain: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain.normalize('NFKC'), salt, KEY_LEN, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(plain, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [kind, saltB64, keyB64] = stored.split('$');
  if (kind !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  if (expected.length !== KEY_LEN) return false;
  const actual = await derive(plain, Buffer.from(saltB64, 'base64'));
  return timingSafeEqual(actual, expected);
}

/** 存在しないIDでも同じくらいの時間をかけて、IDの有無を応答時間から推測させない */
const DUMMY_HASH = hashPassword('dummy-password-for-timing');
export async function burnPasswordCheck(plain: string) {
  await verifyPassword(plain, await DUMMY_HASH);
}

/** 入力のゆれ（前後の空白・大文字）をそろえたログインID */
export function normalizeLoginId(s: string) {
  return s.trim().toLowerCase();
}

// 以下の検証は、問題がなければ null、あれば画面に出す文言を返す

export function validateLoginId(s: string): string | null {
  return /^[a-z0-9_-]{3,32}$/.test(s) ? null : 'ログインIDは半角の英小文字・数字・「-」「_」で3〜32文字にしてください。';
}

export function validatePassword(s: string): string | null {
  if (s.length < 8) return 'パスワードは8文字以上にしてください。';
  if (s.length > 200) return 'パスワードは200文字以内にしてください。';
  return null;
}

export function validateDisplayName(s: string): string | null {
  const t = s.trim();
  return t.length >= 1 && t.length <= 30 ? null : '表示名は1〜30文字で入力してください。';
}

/** 代表者が手渡しやすい、読み間違えにくい文字だけのパスワード（12文字） */
export function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars[randomInt(chars.length)]).join('');
}
