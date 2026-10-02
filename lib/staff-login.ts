import type { Staff } from '@prisma/client';
import { prisma } from './prisma';
import { burnPasswordCheck, LOCK_MINUTES, MAX_FAILED_LOGINS, normalizeLoginId, verifyPassword } from './password';

export type StaffLoginResult = { ok: true; staff: Staff } | { ok: false; reason: 'invalid' | 'locked' };

/**
 * スタッフのID・パスワードを確かめる。10回続けて間違えたら15分止める（総当たり対策）。
 * 停止中は正しいパスワードでも通さない。成功すると失敗回数を0に戻す。
 *
 * 同時に大量に送られても10回分しか照合しないよう、照合の前にDB側で1回分の枠を予約する
 * （停止中でなければ回数を1つ増やし、増やした後の値を受け取る）。
 * 枠を超えた試行は、パスワードが正しくても照合せずに停止扱いにする
 */
export async function authenticateStaff(rawLoginId: string, password: string): Promise<StaffLoginResult> {
  const staff = await prisma.staff.findUnique({ where: { loginId: normalizeLoginId(rawLoginId) } });
  if (!staff) {
    await burnPasswordCheck(password);
    return { ok: false, reason: 'invalid' };
  }

  const now = new Date();
  // 列はタイムゾーンなしの日時（UTC）で保存されているので、比べる値もUTCにそろえる
  const reserved = await prisma.$queryRaw<{ failedLoginCount: number }[]>`
    UPDATE "app"."Staff"
       SET "failedLoginCount" = "failedLoginCount" + 1
     WHERE "id" = ${staff.id}
       AND ("lockedUntil" IS NULL OR "lockedUntil" <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'))
     RETURNING "failedLoginCount"`;
  if (reserved.length === 0) return { ok: false, reason: 'locked' };
  const attempt = reserved[0].failedLoginCount;
  if (attempt > MAX_FAILED_LOGINS) {
    await lock(staff.id, now);
    return { ok: false, reason: 'locked' };
  }

  if (!(await verifyPassword(password, staff.passwordHash))) {
    if (attempt >= MAX_FAILED_LOGINS) {
      await lock(staff.id, now);
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'invalid' };
  }

  // 正しいパスワードでも、照合している間に（同時に送られた他の試行で）停止になっていたら通さない
  const cleared = await prisma.staff.updateMany({
    where: { id: staff.id, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
  if (cleared.count === 0) return { ok: false, reason: 'locked' };
  return { ok: true, staff: await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } }) };
}

async function lock(staffId: string, now: Date) {
  await prisma.staff.update({
    where: { id: staffId },
    data: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) },
  });
}
