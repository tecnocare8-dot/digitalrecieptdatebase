'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Receipt {
    id: string;
    date: string | null;
    invoiceNumber: string | null;
    companyName: string | null;
    totalAmount: number | null;
    paymentMethod: string | null;
    imageUrl: string;
    driveUrl: string;
}

export default function HistoryPage() {
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);

    useEffect(() => {
        fetchReceipts();
    }, []);

    const fetchReceipts = async () => {
        try {
            const res = await fetch('/api/receipts/list');
            if (res.ok) {
                const data = await res.json();
                setReceipts(data);
            }
        } catch (error) {
            console.error('Failed to fetch receipts', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('本当にこのレシートを削除しますか？\n（画像ファイルも削除されます）')) {
            return;
        }

        try {
            const res = await fetch(`/api/receipts/${encodeURIComponent(id)}`, {
                method: 'DELETE',
            });

            if (res.ok) {
                setReceipts(receipts.filter(r => r.id !== id));
            } else {
                alert('削除に失敗しました');
            }
        } catch (error) {
            console.error('Failed to delete', error);
            alert('通信エラーが発生しました');
        }
    };

    const handleEdit = (receipt: Receipt) => {
        setEditingReceipt(receipt);
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingReceipt) return;

        try {
            const formData = new FormData();
            formData.append('date', editingReceipt.date || '');
            formData.append('invoiceNumber', editingReceipt.invoiceNumber || '');
            formData.append('companyName', editingReceipt.companyName || '');
            formData.append('totalAmount', (editingReceipt.totalAmount || 0).toString());
            formData.append('paymentMethod', editingReceipt.paymentMethod || '現金');

            const res = await fetch(`/api/receipts/${encodeURIComponent(editingReceipt.id)}`, {
                method: 'PUT',
                body: formData,
            });

            if (res.ok) {
                const updated = await res.json();
                const updatedReceipts = receipts.map(r => r.id === updated.id ? { ...r, ...updated } : r);

                // Sort by date (newest first)
                updatedReceipts.sort((a, b) => {
                    if (!a.date) return 1;
                    if (!b.date) return -1;
                    return new Date(b.date).getTime() - new Date(a.date).getTime();
                });

                setReceipts(updatedReceipts);
                setEditingReceipt(null);
                alert('更新しました');
            } else {
                alert('更新に失敗しました');
            }
        } catch (error) {
            console.error(error);
            alert('エラーが発生しました');
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4">
            <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">レシート履歴</h1>
                    <div className="space-x-2">
                        <Link href="/" className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
                            ← スキャンへ戻る
                        </Link>
                        <a href="/api/receipts/export" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm">
                            CSVダウンロード
                        </a>
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-10 text-gray-500">読み込み中...</div>
                ) : receipts.length === 0 ? (
                    <div className="text-center py-10 bg-white rounded-lg shadow">
                        <p className="text-gray-500 mb-4">保存されたレシートはありません。</p>
                        <Link href="/" className="text-blue-600 hover:underline">
                            レシートをスキャンする
                        </Link>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg shadow overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日付</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">会社名</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">金額</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">支払い</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">登録番号</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">画像</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {receipts.map((receipt) => (
                                        <tr key={receipt.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {receipt.date ? new Date(receipt.date).toLocaleDateString() : '-'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {receipt.companyName || '-'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                {receipt.totalAmount ? `¥${receipt.totalAmount.toLocaleString()}` : '-'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${receipt.paymentMethod === 'クレジットカード' ? 'bg-blue-100 text-blue-800' :
                                                    receipt.paymentMethod === '電子マネー' ? 'bg-purple-100 text-purple-800' :
                                                        'bg-green-100 text-green-800'
                                                    }`}>
                                                    {receipt.paymentMethod || '現金'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {receipt.invoiceNumber || '-'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                <a href={receipt.imageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                                    画像を見る
                                                </a>
                                                <a href={receipt.driveUrl} target="_blank" rel="noopener noreferrer" className="ml-3 text-gray-500 hover:underline">
                                                    ドライブ
                                                </a>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                <button
                                                    onClick={() => handleEdit(receipt)}
                                                    className="text-blue-600 hover:text-blue-900 bg-blue-50 px-3 py-1 rounded-full text-xs font-medium transition-colors hover:bg-blue-100 mr-2"
                                                >
                                                    編集
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(receipt.id)}
                                                    className="text-red-600 hover:text-red-900 bg-red-50 px-3 py-1 rounded-full text-xs font-medium transition-colors hover:bg-red-100"
                                                >
                                                    削除
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Edit Modal */}
            {editingReceipt && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
                        <h2 className="text-xl font-bold mb-4 text-gray-900">レシート編集</h2>
                        <form onSubmit={handleUpdate} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">日付</label>
                                <input
                                    type="date"
                                    value={editingReceipt.date ? new Date(editingReceipt.date).toISOString().split('T')[0] : ''}
                                    onChange={e => setEditingReceipt({ ...editingReceipt, date: e.target.value })}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border text-gray-900 bg-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">企業名</label>
                                <input
                                    type="text"
                                    value={editingReceipt.companyName || ''}
                                    onChange={e => setEditingReceipt({ ...editingReceipt, companyName: e.target.value })}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border text-gray-900 bg-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">合計金額</label>
                                <input
                                    type="number"
                                    value={editingReceipt.totalAmount || ''}
                                    onChange={e => setEditingReceipt({ ...editingReceipt, totalAmount: parseInt(e.target.value) || 0 })}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border text-gray-900 bg-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">支払い方法</label>
                                <select
                                    value={editingReceipt.paymentMethod || '現金'}
                                    onChange={e => setEditingReceipt({ ...editingReceipt, paymentMethod: e.target.value })}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border text-gray-900 bg-white"
                                >
                                    <option value="現金">現金</option>
                                    <option value="クレジットカード">クレジットカード</option>
                                    <option value="電子マネー">電子マネー</option>
                                    <option value="その他">その他</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">インボイス番号</label>
                                <input
                                    type="text"
                                    value={editingReceipt.invoiceNumber || ''}
                                    onChange={e => setEditingReceipt({ ...editingReceipt, invoiceNumber: e.target.value })}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border text-gray-900 bg-white"
                                />
                            </div>
                            <div className="flex justify-end gap-2 mt-6">
                                <button type="button" onClick={() => setEditingReceipt(null)} className="px-4 py-2 bg-gray-200 rounded text-gray-800">キャンセル</button>
                                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
