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
