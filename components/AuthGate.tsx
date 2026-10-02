'use client';

import { useEffect, useState } from 'react';
import { SessionProvider, signIn, signOut, useSession } from 'next-auth/react';

// lib/auth.ts の STAFF_LOCKED と同じ値（サーバー側の部品を画面に読み込まないよう文字列で持つ）
const STAFF_LOCKED = 'STAFF_LOCKED';

/** スタッフのログイン（代表者が発行したIDとパスワード） */
function StaffLogin() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn('credentials', { loginId, password, redirect: false });
    setBusy(false);
    if (res?.ok && !res.error) {
      window.location.reload();
      return;
    }
    setError(res?.error === STAFF_LOCKED
      ? '続けて間違えたため、しばらくログインできません。15分ほどしてからお試しください（代表者がパスワードを再設定すると解除されます）。'
      : 'ログインIDまたはパスワードが違います。');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 text-left">
      <input
        value={loginId}
        onChange={(e) => setLoginId(e.target.value)}
        placeholder="ログインID"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        required
        className="w-full rounded-lg border p-2.5 text-sm text-gray-900 bg-white"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="パスワード"
        autoComplete="current-password"
        required
        className="w-full rounded-lg border p-2.5 text-sm text-gray-900 bg-white"
      />
      {error && <p className="text-xs text-red-700 leading-relaxed">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full py-2.5 px-4 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-bold rounded-lg text-sm disabled:text-gray-400"
      >
        {busy ? '確認中...' : 'スタッフとしてログイン'}
      </button>
    </form>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  // 削除・パスワード再設定されたスタッフは、セッションに id が無くなる → 残ったcookieを消してログイン画面へ
  const revoked = status === 'authenticated' && !session?.user?.id;

  useEffect(() => {
    if (revoked) signOut({ redirect: false });
  }, [revoked]);

  if (status === 'loading') {
    return (
      <main className="min-h-screen bg-gray-100 p-6 flex justify-center items-center">
        <div className="text-gray-600 font-medium">読み込み中...</div>
      </main>
    );
  }

  if (status === 'unauthenticated' || revoked) {
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
          <div className="pt-4 border-t space-y-2">
            <p className="text-xs text-gray-500">スタッフの方は、代表者から受け取ったIDとパスワードで</p>
            <StaffLogin />
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}

/** ログインしていない人にはログイン画面だけを表示する */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  return (
    // 削除・再設定されたスタッフの画面を早めにログイン画面へ戻すため、5分ごとにセッションを確かめる
    <SessionProvider refetchInterval={300}>
      <Gate>{children}</Gate>
    </SessionProvider>
  );
}
