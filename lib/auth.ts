import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, profile }) {
      // 初回ログイン時にだけ profile が渡る。ここでDBの利用者を作り、そのIDをトークンに持たせる
      if (profile?.email) {
        const user = await prisma.user.upsert({
          where: { email: profile.email },
          update: { name: profile.name ?? undefined },
          create: { email: profile.email, name: profile.name ?? null },
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
