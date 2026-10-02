'use client';

import { useCallback, useEffect, useState } from 'react';

interface StaffRow {
  id: string;
  loginId: string;
  displayName: string;
  locked: boolean;
  lastLoginAt: string | null;
}

const MAX_STAFF = 5;

/**
 * 代表者がスタッフを追加・パスワード再設定・削除する欄（設定ページ）。
 * パスワードは作成・再設定の直後に一度だけ表示する（あとから見直す方法はない）
 */
export default function StaffManager({ isPro }: { isPro: boolean }) {
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [loginId, setLoginId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 直前に発行したパスワード（この画面を離れると消える）
  const [issued, setIssued] = useState<{ name: string; loginId: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/staff');
    if (res.ok) setStaff(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const call = async (url: string, init: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '処理に失敗しました。');
        return null;
      }
      await load();
      return data;
    } catch {
      setError('通信エラーが発生しました。');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const show = (name: string, id: string, password: string) => {
    setCopied(false);
    setIssued({ name, loginId: id, password });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await call('/api/staff', { method: 'POST', body: JSON.stringify({ loginId, displayName }) });
    if (data) {
      show(data.staff.displayName, data.staff.loginId, data.password);
      setLoginId('');
      setDisplayName('');
    }
  };

  const handleReset = async (s: StaffRow) => {
    if (!confirm(`${s.displayName}さんのパスワードを新しくしますか？\n（今ログインしている画面は使えなくなります）`)) return;
    const data = await call(`/api/staff/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: JSON.stringify({ resetPassword: true }) });
    if (data) show(s.displayName, s.loginId, data.password);
  };

  const handleDelete = async (s: StaffRow) => {
    if (!confirm(`${s.displayName}さんを削除しますか？\n（これまでに登録した領収書は残ります）`)) return;
    await call(`/api/staff/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
    if (issued?.loginId === s.loginId) setIssued(null);
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(`ログインID: ${issued.loginId}\nパスワード: ${issued.password}\n${window.location.origin}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const full = (staff?.length ?? 0) >= MAX_STAFF;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-600 leading-relaxed">
        スタッフは、ここで発行したログインIDとパスワードで入り、この帳簿に領収書を登録できます。
        スタッフに見えるのは自分が登録した分だけで、削除・CSV出力・設定はできません。（{MAX_STAFF}人まで）
      </p>

      {issued && (
        <div className="p-4 rounded-xl border-2 border-emerald-300 bg-emerald-50 space-y-2">
          <p className="text-sm font-bold text-emerald-900">{issued.name}さんのログイン情報（この画面でだけ表示されます）</p>
          <div className="font-mono text-sm bg-white border rounded p-2 text-gray-900 select-all">
            ログインID: {issued.loginId}
            <br />
            パスワード: {issued.password}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={copy} className="text-xs font-semibold px-3 py-1.5 bg-emerald-600 text-white rounded-lg">
              {copied ? 'コピーしました' : 'コピー'}
            </button>
            <button type="button" onClick={() => setIssued(null)} className="text-xs font-semibold px-3 py-1.5 bg-white border rounded-lg text-gray-700">
              閉じる
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      {staff === null ? (
        <p className="text-sm text-gray-500">読み込み中...</p>
      ) : staff.length === 0 ? (
        <p className="text-sm text-gray-500">まだスタッフはいません。</p>
      ) : (
        <ul className="divide-y border rounded-lg bg-white">
          {staff.map((s) => (
            <li key={s.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold text-gray-900">
                  {s.displayName}
                  {s.locked && <span className="ml-2 text-xs font-semibold text-red-700">ログイン停止中</span>}
                </div>
                <div className="text-xs text-gray-500 break-all">
                  ID: {s.loginId}／最終ログイン: {s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleDateString('ja-JP') : 'まだなし'}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" disabled={busy} onClick={() => handleReset(s)} className="text-xs font-semibold px-3 py-1.5 bg-white border rounded-lg text-gray-700 hover:bg-gray-100">
                  パスワード再設定
                </button>
                <button type="button" disabled={busy} onClick={() => handleDelete(s)} className="text-xs font-semibold px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-red-700 hover:bg-red-100">
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!isPro ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">スタッフの追加はProプランの機能です。</p>
      ) : full ? (
        <p className="text-sm text-gray-600">スタッフは{MAX_STAFF}人まで追加できます。</p>
      ) : (
        <form onSubmit={handleAdd} className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="表示名（例：田中）"
              maxLength={30}
              required
              className="w-full rounded-lg border p-2 text-sm text-gray-900 bg-white"
            />
            <input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value.toLowerCase())}
              placeholder="ログインID（例：tanaka）"
              pattern="[a-z0-9_\-]{3,32}"
              title="半角の英小文字・数字・「-」「_」で3〜32文字"
              autoCapitalize="none"
              autoCorrect="off"
              required
              className="w-full rounded-lg border p-2 text-sm text-gray-900 bg-white"
            />
          </div>
          <button type="submit" disabled={busy} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-sm disabled:bg-gray-400">
            {busy ? '処理中...' : '＋ スタッフを追加（パスワードは自動で作ります）'}
          </button>
        </form>
      )}
    </div>
  );
}
