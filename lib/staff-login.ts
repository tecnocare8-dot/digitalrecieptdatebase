import type { Staff } from '@prisma/client';
import { prisma } from './prisma';
import { burnPasswordCheck, LOCK_MINUTES, MAX_FAILED_LOGINS, normalizeLoginId, verifyPassword } from './password';

export type StaffLoginResult = { ok: true; staff: Staff } | { ok: false; reason: 'invalid' | 'locked' };

/**
 * スタッフのID・パスワードを確かめる。10回続けて間違えたら15分止める（総当たり対策）。
 * 停止中は正しいパスワードでも通さない。成功すると失敗回数を0に戻す
 */
export async function authenticateStaff(rawLoginId: string, password: string): Promise<StaffLoginResult> {
  const staff = await prisma.staff.findUnique({ where: { loginId: normalizeLoginId(rawLoginId) } });
  if (!staff) {
    await burnPasswordCheck(password);
    return { ok: false, reason: 'invalid' };
  }
  const now = new Date();
  if (staff.lockedUntil && staff.lockedUntil > now) return { ok: false, reason: 'locked' };

  if (!(await verifyPassword(password, staff.passwordHash))) {
    // 同時に何度も試されても数え漏れないよう、DB側で1ずつ足す
    const updated = await prisma.staff.update({
      where: { id: staff.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      await prisma.staff.update({
        where: { id: staff.id },
        data: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) },
      });
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'invalid' };
  }

  const updated = await prisma.staff.update({
    where: { id: staff.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
  return { ok: true, staff: updated };
}
