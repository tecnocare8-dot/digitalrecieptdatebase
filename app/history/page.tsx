'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

interface Receipt {
    id: number;
    date: string | null;
    invoiceNumber: string | null;
    companyName: string | null;
    category: string | null;
    memo: string | null;
    totalAmount: number | null;
    paymentMethod: string | null;
    imagePath: string;
    logs?: ReceiptLog[];
}

interface ReceiptLog {
    id: number;
    operationType: string;
    changedAt: string;
    changedBy: string | null;
    previousData: any;
}

export default function HistoryPage() {
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
    const [showFilters, setShowFilters] = useState(false);
    const [filters, setFilters] = useState({
        startDate: '',
        endDate: '',
        minAmount: '',
        maxAmount: '',
        keyword: '',
        paymentMethod: ''
    });

    useEffect(() => {
        fetchReceipts();
    }, []);

    const fetchReceipts = async () => {
        try {
            const query = new URLSearchParams();
            Object.entries(filters).forEach(([key, value]) => {
                if (value) query.append(key, value);
            });

            const res = await fetch(`/api/receipts/list?${query.toString()}`);
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

    const downloadCSV = () => {
        if (receipts.length === 0) return;

        // CSV Header
        const header = ['日付', '会社名', 'カテゴリー', '備考', '金額', '支払い方法', '登録番号', '画像パス'].join(',');

        // CSV Rows
        const rows = receipts.map(r => {
            const dateStr = r.date ? new Date(r.date).toISOString().split('T')[0] : '';
            return [
                dateStr,
                r.companyName || '',
                r.category || '',
                r.memo || '',
                r.totalAmount || '',
                r.paymentMethod || '',
                r.invoiceNumber || '',
                r.invoiceNumber || '',
                r.imagePath.startsWith('data:') ? '[画像データ]' : r.imagePath
            ].map(val => `"${val}"`).join(','); // Quote values
        });

        const csvContent = [header, ...rows].join('\n');
        // Use BOM for Excel compatibility (UTF-8 with BOM)
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `receipts_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDelete = async (id: number) => {
        if (!confirm('本当にこのレシートを削除しますか？\n（画像ファイルも削除されます）')) {
            return;
        }

        try {
            const res = await fetch(`/api/receipts/${id}`, {
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

    const handleEdit = async (receipt: Receipt) => {
        setEditingReceipt(receipt);
        try {
            const res = await fetch(`/api/receipts/${receipt.id}`);
            if (res.ok) {
                const detail = await res.json();
                setEditingReceipt(detail);
            }
        } catch (e) {
            console.error('Failed to fetch details', e);
        }
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingReceipt) return;

        try {
            const formData = new FormData();
            formData.append('date', editingReceipt.date || '');
            formData.append('invoiceNumber', editingReceipt.invoiceNumber || '');
            formData.append('companyName', editingReceipt.companyName || '');
            formData.append('category', editingReceipt.category || '未分類');
            formData.append('memo', editingReceipt.memo || '');
            formData.append('totalAmount', (editingReceipt.totalAmount || 0).toString());
            formData.append('paymentMethod', editingReceipt.paymentMethod || '現金');

            const res = await fetch(`/api/receipts/${editingReceipt.id}`, {
                method: 'PUT',
                body: formData,
            });

            if (res.ok) {
                const updated = await res.json();
                const updatedReceipts = receipts.map(r => r.id === updated.id ? updated : r);

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
        <div className="min-h-screen bg-gray-50 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+5rem)]">
            {/* ... existing header and table code ... */}
            <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">レシート履歴</h1>
                    <div className="flex items-center gap-4">
                        <div className="space-x-2">
                            <Link href="/" className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
                                ← スキャンへ戻る
                            </Link>
                            <button onClick={downloadCSV} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm">
                                CSVダウンロード
                            </button>
                        </div>
                        <img src="/icon.png" alt="Company Logo" className="h-10 w-auto object-contain" />
                    </div>
                </div>


                {/* Advanced Search Filters */}
                <div className="bg-white rounded-lg shadow mb-6 overflow-hidden">
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="w-full px-4 py-3 flex justify-between items-center bg-gray-50 text-gray-700 font-medium hover:bg-gray-100 transition-colors"
                    >
                        <span>🔍 詳細検索・フィルタリング</span>
                        <svg className={`w-5 h-5 transform transition-transform ${showFilters ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {showFilters && (
                        <div className="p-4 border-t border-gray-200">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">日付範囲</label>
                                    <div className="flex gap-2 items-center">
                                        <input type="date" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })} className="w-full rounded border-gray-300 shadow-sm text-sm" />
                                        <span>~</span>
                                        <input type="date" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })} className="w-full rounded border-gray-300 shadow-sm text-sm" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">金額範囲</label>
                                    <div className="flex gap-2 items-center">
                                        <input type="number" placeholder="Min" value={filters.minAmount} onChange={e => setFilters({ ...filters, minAmount: e.target.value })} className="w-full rounded border-gray-300 shadow-sm text-sm" />
                                        <span>~</span>
                                        <input type="number" placeholder="Max" value={filters.maxAmount} onChange={e => setFilters({ ...filters, maxAmount: e.target.value })} className="w-full rounded border-gray-300 shadow-sm text-sm" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">キーワード・支払い方法</label>
                                    <div className="flex gap-2">
                                        <input type="text" placeholder="会社名、備考など" value={filters.keyword} onChange={e => setFilters({ ...filters, keyword: e.target.value })} className="w-full rounded border-gray-300 shadow-sm text-sm" />
                                        <select value={filters.paymentMethod} onChange={e => setFilters({ ...filters, paymentMethod: e.target.value })} className="rounded border-gray-300 shadow-sm text-sm">
                                            <option value="">全種別</option>
                                            <option value="現金">現金</option>
                                            <option value="クレジットカード">カード</option>
                                            <option value="電子マネー">電子マネー</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-4 flex justify-end gap-2">
                                <button onClick={() => {
                                    setFilters({ startDate: '', endDate: '', minAmount: '', maxAmount: '', keyword: '', paymentMethod: '' });
                                    fetchReceipts();
                                }} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">クリア</button>
                                <button onClick={fetchReceipts} className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 shadow-sm">検索実行</button>
                            </div>
                        </div>
                    )}
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
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">カテゴリー</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">備考</th>
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
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                                                    {receipt.category || '-'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {receipt.memo || '-'}
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
                                                {/* Open edit modal directly when clicking view image */}
                                                <button
                                                    onClick={() => handleEdit(receipt)}
                                                    className="text-blue-600 hover:underline"
                                                >
                                                    画像・詳細
                                                </button>
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

            {/* Edit Modal with Pan/Zoom Image */}
            {
                editingReceipt && (
                    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50 overflow-hidden">
                        <div className="bg-white rounded-xl w-full max-w-6xl h-[90vh] flex flex-col md:flex-row overflow-hidden shadow-2xl">

                            {/* Left Side: Image Viewer (Dark background) */}
                            <div className="w-full md:w-2/3 bg-gray-900 flex flex-col relative overflow-hidden">
                                <div className="absolute top-4 left-4 z-10 bg-black/50 text-white px-3 py-1 rounded-full text-sm pointer-events-none">
                                    マウスホイール/ピンチで拡大・ドラッグで移動
                                </div>
                                <TransformWrapper
                                    initialScale={1}
                                    minScale={0.5}
                                    maxScale={5}
                                    centerOnInit={true}
                                    wheel={{ step: 0.1 }}
                                >
                                    <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: "100%", height: "100%" }}>
                                        <img
                                            src={editingReceipt.imagePath}
                                            alt="Receipt"
                                            className="w-full h-full object-contain"
                                        />
                                    </TransformComponent>
                                </TransformWrapper>
                            </div>

                            {/* Right Side: Edit Form (Scrollable) */}
                            <div className="w-full md:w-1/3 bg-white flex flex-col border-l border-gray-200">
                                <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                                    <h2 className="text-lg font-bold text-gray-800">レシート詳細・編集</h2>
                                    <button onClick={() => setEditingReceipt(null)} className="text-gray-500 hover:text-gray-700">
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>

                                <div className="p-6 overflow-y-auto flex-1">
                                    <form id="edit-form" onSubmit={handleUpdate} className="space-y-5">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">日付</label>
                                            <input
                                                type="date"
                                                value={editingReceipt.date ? new Date(editingReceipt.date).toISOString().split('T')[0] : ''}
                                                onChange={e => setEditingReceipt({ ...editingReceipt, date: e.target.value })}
                                                className="block w-full rounded-lg border-gray-300 shadow-sm p-2.5 border text-gray-900 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">企業名</label>
                                            <input
                                                type="text"
                                                value={editingReceipt.companyName || ''}
                                                onChange={e => setEditingReceipt({ ...editingReceipt, companyName: e.target.value })}
                                                className="block w-full rounded-lg border-gray-300 shadow-sm p-2.5 border text-gray-900 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">カテゴリー</label>
                                            <select
                                                value={editingReceipt.category || '未分類'}
                                                onChange={e => setEditingReceipt({ ...editingReceipt, category: e.target.value })}
                                                className="block w-full rounded-lg border-gray-300 shadow-sm p-2.5 border text-gray-900 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                                            >
                                                <option value="未分類">未分類</option>
                                                <option value="消耗品費">消耗品費</option>
                                                <option value="旅費交通費">旅費交通費</option>
                                                <option value="接待交際費">接待交際費</option>
                                                <option value="会議費">会議費</option>
                                                <option value="通信費">通信費</option>
                                                <option value="水道光熱費">水道光熱費</option>
                                                <option value="新聞図書費">新聞図書費</option>
                                                <option value="雑費">雑費</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">備考</label>
                                            <input
                                                type="text"
                                                value={editingReceipt.memo || ''}
                                                onChange={e => setEditingReceipt({ ...editingReceipt, memo: e.target.value })}
                                                placeholder="人数: 4名、相手: 〇〇様"
                                                className="block w-full rounded-lg border-gray-300 shadow-sm p-2.5 border text-gray-900 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">合計金額</label>
                                            <div className="relative">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                    <span className="text-gray-500 sm:text-sm">¥</span>
                                                </div>
                                                <input
                                                    type="number"
                                                    value={editingReceipt.totalAmount || ''}
                                                    onChange={e => setEditingReceipt({ ...editingReceipt, totalAmount: parseInt(e.target.value) || 0 })}
                                                    className="block w-full rounded-lg border-gray-300 shadow-sm pl-7 p-2.5 border text-gray-900 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">支払い方法</label>
                                            <select
                                                value={editingReceipt.paymentMethod || '現金'}
                                                onChange={e => setEditingReceipt({ ...editingReceipt, paymentMethod: e.target.value })}
                                                className="block w-full rounded-lg border-gray-300 shadow-sm p-2.5 border text-gray-900 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                                            >
                                                <option value="現金">現金</option>
                                                <option value="クレジットカード">クレジットカード</option>
                                                <option value="電子マネー">電子マネー</option>
                                                <option value="その他">その他</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 mb-1">インボイス番号</label>
                                            <input
                                                type="text"
                                                value={editingReceipt.invoiceNumber || ''}
                                                onChange={e => setEditingReceipt({ ...editingReceipt, invoiceNumber: e.target.value })}
                                                className="block w-full rounded-lg border-gray-300 shadow-sm p-2.5 border text-gray-900 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                                                placeholder="T1234567890123"
                                            />
                                        </div>

                                        {/* Compliance: Audit Log / History */}
                                        {editingReceipt.logs && editingReceipt.logs.length > 0 && (
                                            <div className="mt-8 pt-6 border-t border-gray-200">
                                                <h3 className="text-sm font-bold text-gray-700 mb-3">変更履歴 (監査ログ)</h3>
                                                <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-2 max-h-40 overflow-y-auto">
                                                    {editingReceipt.logs.map(log => (
                                                        <div key={log.id} className="border-b border-gray-200 pb-2 last:border-0 last:pb-0">
                                                            <div className="flex justify-between font-semibold">
                                                                <span className={log.operationType === 'DELETE' ? 'text-red-600' : 'text-blue-600'}>{log.operationType}</span>
                                                                <span>{new Date(log.changedAt).toLocaleString()}</span>
                                                            </div>
                                                            <div className="mt-1 text-gray-500">
                                                                Before: {log.previousData ? `¥${(log.previousData as any).totalAmount?.toLocaleString()} / ${(log.previousData as any).companyName}` : '-'}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                    </form>
                                </div>

                                <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 rounded-br-xl">
                                    <button type="button" onClick={() => setEditingReceipt(null)} className="px-5 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors shadow-sm">
                                        キャンセル
                                    </button>
                                    <button type="submit" form="edit-form" className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm">
                                        保存する
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}


