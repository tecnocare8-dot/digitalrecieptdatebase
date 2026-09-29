'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export interface DriveStatus {
  connected: boolean;
  folder: { id: string; name: string; url: string } | null;
  folderExists: boolean;
  ledgerUrl: string | null;
}

const DEFAULT_FOLDER_NAME = '領収書（デジタル領収書管理）';

/**
 * Googleドライブの保存先の設定。ドライブを使ったことがない人でも迷わないよう、
 * 「①連携 → ②フォルダ作成 → ③完了（リンクを開く・コピー）」の順に1つずつ表示する
 */
export default function DriveFolderSetup({ drive, onChanged }: { drive: DriveStatus; onChanged: () => void }) {
  const [folderName, setFolderName] = useState(DEFAULT_FOLDER_NAME);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createFolder = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/drive/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'フォルダを作成できませんでした。');
      } else {
        onChanged();
      }
    } catch {
      setError('通信エラーでフォルダを作成できませんでした。');
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('コピーできませんでした。リンクを長押し（右クリック）してコピーしてください。');
    }
  };

  // ① Googleドライブと未連携
  if (!drive.connected) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-700 leading-relaxed">
          領収書の画像と記録（CSV）は、<b>あなたのGoogleドライブ</b>に保存されます。このアプリには保存されないので、アプリが無くなってもドライブに残ります。
        </p>
        <p className="text-xs text-gray-500 leading-relaxed">
          次の画面でGoogleに「このアプリが作成したファイルの表示・編集」を許可してください。ドライブにあるほかのファイルは見えません。
        </p>
        <button
          onClick={() => signIn('google', { callbackUrl: '/settings' })}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow text-sm"
        >
          ① Googleドライブと連携する
        </button>
      </div>
    );
  }

  // ② 連携済みだが、保存用フォルダがまだ無い（またはドライブで削除された）
  if (!drive.folder || !drive.folderExists) {
    return (
      <div className="space-y-3">
        {drive.folder && !drive.folderExists && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            以前のフォルダ「{drive.folder.name}」がドライブで見つかりません（削除された可能性があります）。新しいフォルダを作成してください。
          </p>
        )}
        <p className="text-sm text-gray-700 leading-relaxed">
          領収書を入れるフォルダを、あなたのGoogleドライブに作ります。名前は変えても、そのままでも大丈夫です。
        </p>
        <label className="block text-xs font-medium text-gray-600">フォルダの名前</label>
        <input
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          maxLength={100}
          className="block w-full rounded-md border border-gray-300 p-2 text-sm text-gray-900 bg-white"
        />
        <button
          onClick={createFolder}
          disabled={creating}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow text-sm disabled:bg-gray-400"
        >
          {creating ? '作成中...' : '② Googleドライブにフォルダを作成する'}
        </button>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  // ③ 準備完了。フォルダと一覧CSVへのリンク
  return (
    <div className="space-y-3">
      <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
        ✅ 保存先の準備ができています。領収書はフォルダ「<b>{drive.folder.name}</b>」に保存されます。
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <a
          href={drive.folder.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center py-2.5 px-4 bg-white border rounded-lg shadow-sm hover:bg-gray-50 text-sm font-semibold text-gray-800"
        >
          📁 ドライブでフォルダを開く
        </a>
        <button
          onClick={() => copyLink(drive.folder!.url)}
          className="py-2.5 px-4 bg-white border rounded-lg shadow-sm hover:bg-gray-50 text-sm font-semibold text-gray-800"
        >
          {copied ? '✅ コピーしました' : '🔗 フォルダのリンクをコピー'}
        </button>
      </div>
      {drive.ledgerUrl && (
        <a
          href={drive.ledgerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-sm text-blue-700 hover:underline"
        >
          📄 領収書一覧（CSV）をドライブで開く
        </a>
      )}
      <p className="text-xs text-gray-500 break-all">フォルダのリンク: {drive.folder.url}</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
