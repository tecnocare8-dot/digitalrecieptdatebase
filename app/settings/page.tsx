'use client';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
    const { data: session, status } = useSession();
    const [folderName, setFolderName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState('');
    const router = useRouter();

    useEffect(() => {
        if (status === 'unauthenticated') {
            signIn('google');
        } else if (status === 'authenticated') {
            fetchSettings();
        }
    }, [status]);

    const fetchSettings = async () => {
        try {
            const res = await fetch('/api/settings');
            if (res.ok) {
                const data = await res.json();
                setFolderName(data.driveFolderName);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setMessage('');

        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ driveFolderName: folderName }),
            });

            if (res.ok) {
                setMessage('✅ 設定を保存しました！新しいフォルダ名で保存されます。');
            } else {
                setMessage('❌ 保存に失敗しました。');
            }
        } catch (e) {
            console.error(e);
            setMessage('❌ エラーが発生しました。');
        } finally {
            setIsSaving(false);
        }
    };

    if (status === 'loading') return <div className="p-8 text-center">読み込み中...</div>;

    return (
        <main className="min-h-screen bg-gray-100 p-4">
            <div className="max-w-md mx-auto bg-white rounded-xl shadow-md p-6">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">設定</h1>
                    <Link href="/" className="text-blue-600 hover:underline">
                        ← 戻る
                    </Link>
                </div>

                <div className="mb-8">
                    <h2 className="text-lg font-semibold text-gray-700 mb-4 border-b pb-2">ドキュメント・マニュアル</h2>
                    <div className="space-y-4">
                        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <h3 className="font-bold text-gray-800 mb-2">ユーザー説明書</h3>
                            <p className="text-sm text-gray-600 mb-3">アプリの詳しい使い方や、電子帳簿保存法対応機能についての説明書です。</p>
                            <a href="/docs/user_manual.md" download="user_manual.md" className="inline-flex items-center px-4 py-2 bg-white border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                                📄 ダウンロード (Markdown)
                            </a>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <h3 className="font-bold text-gray-800 mb-2">実装仕様書 (電帳法対応)</h3>
                            <p className="text-sm text-gray-600 mb-3">電子帳簿保存法の要件（検索機能、真実性確保など）に関する技術的な仕様書です。顧問税理士への説明にご利用ください。</p>
                            <a href="/docs/compliance_specification.md" download="compliance_specification.md" className="inline-flex items-center px-4 py-2 bg-white border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                                📄 ダウンロード (Markdown)
                            </a>
                        </div>
                    </div>
                </div>

                <div className="mb-8">
                    <h2 className="text-lg font-semibold text-gray-700 mb-4 border-b pb-2">Google Drive連携設定</h2>
                    <form onSubmit={handleSave} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                保存先フォルダ名
                            </label>
                            <p className="text-xs text-gray-500 mb-2">
                                指定した名前のフォルダが存在しない場合、自動的に作成されます。
                            </p>
                            <input
                                type="text"
                                value={folderName}
                                onChange={(e) => setFolderName(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Receipt Scanner"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isSaving}
                            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 font-bold disabled:bg-gray-400 transition-colors"
                        >
                            {isSaving ? '保存中...' : '設定を保存する'}
                        </button>
                    </form>

                    {message && (
                        <div className={`mt-4 p-3 rounded text-sm ${message.includes('✅') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {message}
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
