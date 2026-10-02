import type { Staff } from '@prisma/client';
import { prisma } from './prisma';
import { planStatus } from './settings';
import {
  generatePassword, hashPassword, MAX_STAFF, normalizeLoginId, validateDisplayName, validateLoginId, validatePassword,
} from './password';

// 代表者が行うスタッフの管理（一覧・追加・パスワード再設定・削除）。
// パスワードは作成・再設定の応答でだけ平文を返し、DBには変換した値だけを残す

/** 画面に返す形（パスワードの変換値やログイン失敗回数は出さない） */
export function toClientStaff(s: Staff) {
  return {
    id: s.id,
    loginId: s.loginId,
    displayName: s.displayName,
    locked: Boolean(s.lockedUntil && s.lockedUntil > new Date()),
    lastLoginAt: s.lastLoginAt ? s.lastLoginAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}

export class StaffInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function listStaff(ownerId: string) {
  const rows = await prisma.staff.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' } });
  return rows.map(toClientStaff);
}

/** パスワードを省略したら読み間違えにくい12文字を作る */
export async function createStaff(ownerId: string, input: { loginId?: unknown; displayName?: unknown; password?: unknown }) {
  const loginId = normalizeLoginId(typeof input.loginId === 'string' ? input.loginId : '');
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  const password = typeof input.password === 'string' && input.password !== '' ? input.password : generatePassword();
  const invalid = validateLoginId(loginId) ?? validateDisplayName(displayName) ?? validatePassword(password);
  if (invalid) throw new StaffInputError(invalid);

  const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
  if (!planStatus(owner.proExpiresAt).isPro) {
    throw new StaffInputError('スタッフの追加はProプランの機能です。', 402);
  }
  const passwordHash = await hashPassword(password);

  // 人数の確認と追加を、代表者ごとに1つずつ順番に行う（同時に押されても5人を超えないように）
  const staff = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`staff:${ownerId}`}))`;
    if ((await tx.staff.count({ where: { ownerId } })) >= MAX_STAFF) {
      throw new StaffInputError(`スタッフは${MAX_STAFF}人まで追加できます。`, 409);
    }
    if (await tx.staff.findUnique({ where: { loginId } })) {
      throw new StaffInputError('このログインIDは使われています。別のIDにしてください。', 409);
    }
    return tx.staff.create({ data: { ownerId, loginId, displayName, passwordHash } });
  }).catch((e) => {
    // ほぼ同時に同じIDで作られた場合（一意制約）
    if ((e as { code?: string }).code === 'P2002') throw new StaffInputError('このログインIDは使われています。別のIDにしてください。', 409);
    throw e;
  });
  return { staff: toClientStaff(staff), password };
}

/** 代表者自身のスタッフだけを対象にする。他人のスタッフIDは「見つからない」 */
async function findOwnStaff(ownerId: string, staffId: string) {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, ownerId } });
  if (!staff) throw new StaffInputError('スタッフが見つかりません。', 404);
  return staff;
}

/** パスワード再設定。ログイン中の画面も無効にし、ログイン停止も解除する */
export async function resetStaffPassword(ownerId: string, staffId: string, input: { password?: unknown; displayName?: unknown }) {
  await findOwnStaff(ownerId, staffId);
  const password = typeof input.password === 'string' && input.password !== '' ? input.password : generatePassword();
  const invalid = validatePassword(password);
  if (invalid) throw new StaffInputError(invalid);
  const staff = await prisma.staff.update({
    where: { id: staffId },
    data: {
      passwordHash: await hashPassword(password),
      sessionVersion: { increment: 1 },
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  return { staff: toClientStaff(staff), password };
}

/** 表示名の変更（ログインは切らない。帳簿の過去の行の登録者名はそのまま） */
export async function renameStaff(ownerId: string, staffId: string, rawName: unknown) {
  await findOwnStaff(ownerId, staffId);
  const displayName = typeof rawName === 'string' ? rawName.trim() : '';
  const invalid = validateDisplayName(displayName);
  if (invalid) throw new StaffInputError(invalid);
  return toClientStaff(await prisma.staff.update({ where: { id: staffId }, data: { displayName } }));
}

/** 削除。過去に登録した領収書と登録者名は帳簿に残る。ログイン中の画面は次の操作で無効になる */
export async function deleteStaff(ownerId: string, staffId: string) {
  await findOwnStaff(ownerId, staffId);
  await prisma.staff.delete({ where: { id: staffId } });
}
