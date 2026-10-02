import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptSecret } from '@/lib/crypto';
import { DRIVE_SCOPE } from '@/lib/drive';
import { authenticateStaff } from '@/lib/staff-login';

/** ログイン停止中（画面側は signIn の error でこの値を受け取る） */
export const STAFF_LOCKED = 'STAFF_LOCKED';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          // 領収書を本人のドライブに保存するため、このアプリが作ったファイルだけを扱う drive.file を求める。
          // access_type=offline + prompt=consent で、サーバーからドライブに書き込むためのリフレッシュトークンを受け取る
          scope: `openid email profile ${DRIVE_SCOPE}`,
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
    // スタッフ：代表者が発行したログインIDとパスワード。ログインすると代表者の帳簿を使う
    CredentialsProvider({
      id: 'credentials',
      name: 'スタッフ',
      credentials: { loginId: { type: 'text' }, password: { type: 'password' } },
      async authorize(credentials) {
        const loginId = typeof credentials?.loginId === 'string' ? credentials.loginId : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!loginId || !password) return null;
        const result = await authenticateStaff(loginId, password);
        if (!result.ok) {
          if (result.reason === 'locked') throw new Error(STAFF_LOCKED);
          return null;
        }
        const { staff } = result;
        return { id: staff.id, name: staff.displayName, ownerId: staff.ownerId, sessionVersion: staff.sessionVersion };
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, profile, account, user }) {
      if (account?.provider === 'credentials' && user) {
        token.userId = user.ownerId;
        token.staffId = user.id;
        token.staffSessionVersion = user.sessionVersion;
        token.name = user.name;
        token.email = null;
        return token;
      }
      // スタッフは確認のたびにDBを見て、削除・パスワード再設定されていたらログインを無効にする
      // （JWTは30日有効なので、これが無いと辞めた人が使い続けられる）
      if (typeof token.staffId === 'string') {
        const staff = await prisma.staff.findUnique({ where: { id: token.staffId } });
        if (!staff || staff.sessionVersion !== token.staffSessionVersion || staff.ownerId !== token.userId) {
          return { revoked: true };
        }
        token.name = staff.displayName;
        return token;
      }
      // 初回ログイン時にだけ profile / account が渡る。ここでDBの利用者を作り、そのIDをトークンに持たせる
      if (profile?.email) {
        // Googleの同意画面でドライブのチェックを外された場合は、トークンを保存しない（未連携として扱う）
        const driveGranted = account?.scope?.split(' ').includes(DRIVE_SCOPE) ?? false;
        const refreshToken = driveGranted && account?.refresh_token ? encryptSecret(account.refresh_token) : undefined;
        const user = await prisma.user.upsert({
          where: { email: profile.email },
          update: { name: profile.name ?? undefined, ...(refreshToken ? { googleRefreshToken: refreshToken } : {}) },
          create: { email: profile.email, name: profile.name ?? null, googleRefreshToken: refreshToken ?? null },
        });
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === 'string' && !token.revoked) {
        session.user.id = token.userId;
        session.user.staffId = typeof token.staffId === 'string' ? token.staffId : null;
      } else {
        // 無効になったスタッフ：画面側（AuthGate）は id が無ければログイン画面に戻す
        session.user = undefined;
      }
      return session;
    },
  },
};

export class UnauthorizedError extends Error {}
/** スタッフには許していない操作 */
export class ForbiddenError extends Error {}

/**
 * 操作している人。帳簿・ドライブ・プランは常に代表者（ownerId）のものを使う。
 * staffId があればスタッフで、見える範囲・できる操作を絞る
 */
export interface Actor {
  ownerId: string;
  staffId: string | null;
  displayName: string;
}

/** ログイン中の人を返す。未ログイン・無効になったスタッフなら UnauthorizedError */
export async function requireActor(): Promise<Actor> {
  const session = await getServerSession(authOptions);
  const ownerId = session?.user?.id;
  if (!ownerId) throw new UnauthorizedError();
  const staffId = session.user?.staffId ?? null;
  const displayName = session.user?.name || session.user?.email || (staffId ? 'スタッフ' : '代表者');
  return { ownerId, staffId, displayName };
}

/** 代表者だけに許す操作。スタッフなら ForbiddenError */
export async function requireOwner(): Promise<Actor> {
  const actor = await requireActor();
  if (actor.staffId) throw new ForbiddenError();
  return actor;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: 'この操作は代表者だけができます。' }, { status: 403 });
}
