'use client';

import { SessionProvider, signIn, useSession } from 'next-auth/react';

function Gate({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  if (status === 'loading') {
    return (
      <main className="min-h-screen bg-gray-100 p-6 flex justify-center items-center">
        <div className="text-gray-600 font-medium">読み込み中...</div>
      </main>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <main className="min-h-screen bg-gray-100 p-4 flex justify-center items-center">
        <div className="max-w-sm w-full bg-white rounded-xl shadow-md p-6 space-y-5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={72} height={72} className="mx-auto rounded-2xl shadow" />
          <h1 className="text-xl font-bold text-gray-800">デジタル経費記録</h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            領収書はアカウントごとに保存され、ほかの人からは見えません。
            <br />
            無料プランでは5件まで保存できます。
          </p>
          <button
            onClick={() => signIn('google')}
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow text-sm"
          >
            Googleアカウントでログイン
          </button>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}

/** ログインしていない人にはログイン画面だけを表示する */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Gate>{children}</Gate>
    </SessionProvider>
  );
}
