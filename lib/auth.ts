import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encryptSecret } from '@/lib/crypto';
import { DRIVE_SCOPE } from '@/lib/drive';

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
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, profile, account }) {
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
      if (session.user && typeof token.userId === 'string') {
        session.user.id = token.userId;
      }
      return session;
    },
  },
};

export class UnauthorizedError extends Error {}

/** ログイン中の利用者IDを返す。未ログインなら UnauthorizedError */
export async function requireUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) throw new UnauthorizedError();
  return userId;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });
}
