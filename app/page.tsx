'use client';

import { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import Link from 'next/link';
import { performOCR, ParsedReceipt, cancelOCR } from '@/utils/ocr';
import ImagePreview from '@/components/ImagePreview';
import { rotateImage, compressForUpload } from '@/utils/image-processing';
import DriveFolderSetup, { type DriveStatus } from '@/components/DriveFolderSetup';
import { computeSignals, preloadModel } from '@/utils/fingerprint';
import { RECEIPT_CATEGORIES } from '@/lib/categories';
import type { ReceiptSignals } from '@/lib/stores';

type FormData = {
  date: string;
  invoiceNumber: string;
  companyName: string;
  totalAmount: number;
  paymentMethod: string;
  category: string;
};

/** 学習済みのお店（判別結果・よく使うお店） */
interface StoreSuggestion {
  companyName: string | null;
  invoiceNumber: string | null;
  paymentMethod: string | null;
  category: string | null;
  count: number;
  score: number;
  reasons: string[];
  autoFill?: boolean;
}

interface SubscriptionSettings {
  role: 'owner' | 'staff';
  displayName: string;
  isPro: boolean;
  isExpired: boolean;
  proExpiresAt: string | null;
  receiptCount: number;
  maxFreeReceipts: number;
  canAddReceipt: boolean;
  reason?: string;
  drive: DriveStatus;
}

export default function Home() {
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [ocrDebugText, setOcrDebugText] = useState('');
  const [subSettings, setSubSettings] = useState<SubscriptionSettings | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  // お店の学習: 撮影した画像の手がかり、判別結果、よく使うお店
  const [signals, setSignals] = useState<ReceiptSignals | null>(null);
  const [storeMatches, setStoreMatches] = useState<StoreSuggestion[]>([]);
  const [appliedStore, setAppliedStore] = useState<StoreSuggestion | null>(null);
  const [frequentStores, setFrequentStores] = useState<StoreSuggestion[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Queue State
  const [queue, setQueue] = useState<File[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const { register, handleSubmit, setValue, watch, reset, getValues } = useForm<FormData>({
    defaultValues: {
      paymentMethod: '現金'
    }
  });

  useEffect(() => {
    fetchSubSettings();
    fetchFrequentStores();
  }, []);

  const fetchFrequentStores = async () => {
    try {
      const res = await fetch('/api/stores');
      if (res.ok) setFrequentStores(await res.json());
    } catch (e) {
      console.error('Failed to fetch frequent stores', e);
    }
  };

  /** 学習済みのお店の情報を入力欄に入れる（金額と日付はレシートごとに違うので触らない） */
  const applyStore = (s: StoreSuggestion) => {
    if (s.companyName) setValue('companyName', s.companyName);
    if (s.invoiceNumber) setValue('invoiceNumber', s.invoiceNumber.replace(/^T/, ''));
    if (s.paymentMethod) setValue('paymentMethod', s.paymentMethod);
    if (s.category) setValue('category', s.category);
    setAppliedStore(s);
  };

  const clearStoreState = () => {
    setSignals(null);
    setStoreMatches([]);
    setAppliedStore(null);
  };

  /** 撮影したレシートの見た目・電話番号・読めた文字から、学習済みのお店を判別する */
  const identifyStore = async (file: File, ocrText: string, ocrInvoiceNumber: string | null) => {
    try {
      const sig = await computeSignals(file, ocrText);
      setSignals(sig);
      const res = await fetch('/api/stores/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signals: sig, invoiceNumber: ocrInvoiceNumber }),
      });
      if (!res.ok) return null;
      const { candidates } = await res.json() as { candidates: StoreSuggestion[] };
      setStoreMatches(candidates);
      const best = candidates.find((c) => c.autoFill) ?? null;
      if (best) applyStore(best);
      return best;
    } catch (e) {
      // 判別に失敗しても、通常どおり手入力で保存できる
      console.error('Store identification failed', e);
      return null;
    }
  };

  const fetchSubSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSubSettings(data);
      }
    } catch (e) {
      console.error('Failed to fetch settings', e);
    }
  };

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
      });
      const data = await res.json();

      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        const errorMsg = data.error || '決済の開始に失敗しました。';
        alert(`【エラー】${errorMsg}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`【通信エラー】${e.message || '決済APIへの接続に失敗しました。'}`);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleManualLookup = async () => {
    const currentInvoiceNumber = getValues('invoiceNumber');
    if (!currentInvoiceNumber) {
      alert('インボイス番号を入力してください');
      return;
    }

    let cleanInvoiceNumber = currentInvoiceNumber.replace(/[- ]/g, '');
    if (!cleanInvoiceNumber.startsWith('T')) {
      cleanInvoiceNumber = 'T' + cleanInvoiceNumber;
    }

    setStatusMessage('企業名を検索中...');

    try {
      const res = await fetch(`/api/invoice-lookup?invoiceNumber=${cleanInvoiceNumber}`);
      if (res.ok) {
        const data = await res.json();
        if (data.companyName) {
          setValue('companyName', data.companyName);
          setStatusMessage('企業名が見つかりました！');
        } else {
          setStatusMessage('企業名が見つかりませんでした。');
          alert('企業名が見つかりませんでした。');
        }
      } else {
        setStatusMessage('検索エラー');
      }
    } catch (e) {
      console.error('Lookup failed', e);
      setStatusMessage('通信エラー');
    }
  };

  const handleRotate = async (degrees: number) => {
    if (!image) return;
    setStatusMessage('画像を回転中...');
    try {
      const rotatedFile = await rotateImage(image, degrees);
      await processFile(rotatedFile);
    } catch (e) {
      console.error(e);
      setStatusMessage('回転に失敗しました');
    }
  };

  const handleCancel = async () => {
    await cancelOCR();
    setIsScanning(false);
    setStatusMessage('読み取りを中止しました。');
    setOcrDebugText('');
  };

  const processFile = async (file: File) => {
    setImage(file);
    setPreviewUrl(URL.createObjectURL(file));
    setIsScanning(true);
    setStatusMessage('文字を読み取っています... (Tesseract.js)');
    setOcrDebugText('');
    clearStoreState();
    // 画像認識モデル（初回のみ約14MB）の読み込みを、文字の読み取りと並行して始める
    void preloadModel();
    setValue('category', '');

    try {
      const result = await performOCR(file);
      setOcrDebugText(result.text);

      if (result.date) setValue('date', result.date);
      else setValue('date', '');

      if (result.invoiceNumber) {
        const cleanInvoiceNumber = result.invoiceNumber.replace(/[- ]/g, '').replace(/^T/, '');
        setValue('invoiceNumber', cleanInvoiceNumber);

        const lookupNumber = 'T' + cleanInvoiceNumber;
        try {
          const res = await fetch(`/api/invoice-lookup?invoiceNumber=${lookupNumber}`);
          if (res.ok) {
            const data = await res.json();
            if (data.companyName) setValue('companyName', data.companyName);
          }
        } catch (e) { console.error(e); }
      } else {
        setValue('invoiceNumber', '');
      }

      if (result.companyName && !watch('companyName')) setValue('companyName', result.companyName);
      else if (!result.invoiceNumber) setValue('companyName', '');

      if (result.totalAmount) setValue('totalAmount', result.totalAmount);
      else setValue('totalAmount', 0);

      if (result.paymentMethod) setValue('paymentMethod', result.paymentMethod);
      else setValue('paymentMethod', '現金');

      // 文字だけでなく、ロゴ・デザイン・電話番号からも過去に学習したお店を探す
      setStatusMessage('お店を判別しています...');
      const ocrInvoice = result.invoiceNumber ? 'T' + result.invoiceNumber.replace(/[- ]/g, '').replace(/^T/, '') : null;
      const matched = await identifyStore(file, result.text, ocrInvoice);
      // このレシートの文字でカード・電子マネーと読めた場合は、お店のいつもの支払い方法より優先する
      if (matched && result.paymentMethod && result.paymentMethod !== '現金') setValue('paymentMethod', result.paymentMethod);

      setStatusMessage(matched
        ? `「${matched.companyName ?? matched.invoiceNumber}」と判定して入力しました（${matched.reasons.join('・')}）。内容を確認してください。`
        : '読み取り完了。内容を確認・修正してください。');
    } catch (err) {
      console.error(err);
      setStatusMessage('読み取りに失敗しました。手動で入力してください。');
    } finally {
      setIsScanning(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      if (files.length > 1) {
        setQueue(files);
        setCurrentIndex(0);
        setStatusMessage(`一括処理: 1 / ${files.length} 枚目`);
        processFile(files[0]);
      } else {
        setQueue([]);
        processFile(files[0]);
      }
    }
  };

  const handleNext = () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < queue.length) {
      setCurrentIndex(nextIndex);
      setStatusMessage(`一括処理: ${nextIndex + 1} / ${queue.length} 枚目`);
      processFile(queue[nextIndex]);
    } else {
      setQueue([]);
      setCurrentIndex(0);
      reset();
      setImage(null);
      setPreviewUrl(null);
      setStatusMessage('すべての処理が完了しました！');
      alert('すべての処理が完了しました！');
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const onSubmit = async (data: FormData) => {
    if (!image) return;

    setStatusMessage('保存中...');
    const formData = new FormData();
    formData.append('image', await compressForUpload(image));
    formData.append('date', data.date);

    let invoiceNumber = data.invoiceNumber.replace(/[- ]/g, '');
    if (invoiceNumber && !invoiceNumber.startsWith('T')) {
      invoiceNumber = 'T' + invoiceNumber;
    }
    formData.append('invoiceNumber', invoiceNumber);

    formData.append('companyName', data.companyName);
    formData.append('totalAmount', data.totalAmount.toString());
    formData.append('paymentMethod', data.paymentMethod);
    formData.append('category', data.category || '');
    // 保存と同時に、このお店の見た目・電話番号を学習させる
    if (signals) formData.append('signals', JSON.stringify(signals));

    try {
      const res = await fetch('/api/receipts', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        setStatusMessage('保存しました！');
        fetchSubSettings();
        fetchFrequentStores();
        clearStoreState();
        if (queue.length > 0) {
          handleNext();
        } else {
          alert('保存しました！');
          setImage(null);
          setPreviewUrl(null);
          reset();
          if (fileInputRef.current) fileInputRef.current.value = '';
          if (cameraInputRef.current) cameraInputRef.current.value = '';
          setStatusMessage('');
        }
      } else if (res.status === 402) {
        const errData = await res.json();
        alert(`【保存制限】\n${errData.error}`);
        setStatusMessage(errData.error);
      } else if (res.status === 401) {
        setStatusMessage('ログインの有効期限が切れました。ページを再読み込みして、もう一度ログインしてください。');
        alert('ログインの有効期限が切れました。ページを再読み込みして、もう一度ログインしてください。');
      } else {
        const errData = await res.json().catch(() => null);
        const msg = errData?.error || '保存エラーが発生しました。';
        setStatusMessage(msg);
        alert(msg);
      }
    } catch (e) {
      console.error(e);
      setStatusMessage('通信エラー');
    }
  };

  return (
    <main className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden md:max-w-2xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" width={32} height={32} className="rounded-lg" />
            デジタル経費記録
          </h1>
          <div className="flex items-center gap-3">
            <Link href="/settings" className="text-sm text-gray-600 hover:text-indigo-600 font-medium flex items-center gap-1">
              ⚙ 設定
            </Link>
            <Link href="/history" className="text-sm text-blue-600 hover:underline">
              履歴 →
            </Link>
          </div>
        </div>

        {/* スタッフ：プラン・ドライブは代表者が管理するので、誰の名前で登録されるかだけを出す */}
        {subSettings?.role === 'staff' && (
          <div className="mb-6 p-3 bg-gray-50 border rounded-lg space-y-1">
            <div className="text-sm text-gray-700">
              <span className="font-bold">{subSettings.displayName}</span>（スタッフ）としてログイン中
            </div>
            {!subSettings.canAddReceipt && subSettings.reason && (
              <p className="text-xs text-red-700 leading-relaxed">{subSettings.reason}</p>
            )}
          </div>
        )}

        {/* Plan Status Banner */}
        {subSettings && subSettings.role !== 'staff' && (
          <div className="mb-6 p-3 bg-gray-50 border rounded-lg flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">プラン:</span>
              {subSettings.isPro ? (
                <span className="bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full text-xs font-bold">
                  ⭐ Proプラン適用中
                </span>
              ) : subSettings.isExpired ? (
                <span className="bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full text-xs font-bold">
                  ⚠️ 有効期限切れ
                </span>
              ) : (
                <span className="bg-gray-200 text-gray-700 px-2.5 py-0.5 rounded-full text-xs font-bold">
                  無料プラン ({subSettings.receiptCount}/{subSettings.maxFreeReceipts}件)
                </span>
              )}
            </div>

            {(!subSettings.isPro || subSettings.isExpired) && (
              <button
                type="button"
                onClick={handleCheckout}
                disabled={checkoutLoading}
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded shadow transition disabled:bg-gray-400"
              >
                {checkoutLoading ? '処理中...' : subSettings.isExpired ? '再購入 (1,500円/年)' : 'Proへアップグレード (1,500円/年)'}
              </button>
            )}
          </div>
        )}

        {/* 保存先が未設定なら、撮影より先にドライブの準備を案内する */}
        {subSettings && subSettings.role !== 'staff' && (!subSettings.drive.connected || !subSettings.drive.folderExists) && (
          <div className="mb-6 p-4 rounded-xl border-2 border-blue-300 bg-blue-50 space-y-3">
            <h2 className="font-bold text-blue-900">はじめに：保存先のフォルダを用意しましょう</h2>
            <DriveFolderSetup drive={subSettings.drive} onChanged={fetchSubSettings} />
          </div>
        )}

        {/* Queue Status */}
        {queue.length > 0 && (
          <div className="mb-4 p-2 bg-blue-100 text-blue-800 rounded text-center font-bold">
            一括処理中: {currentIndex + 1} / {queue.length} 枚目
          </div>
        )}

        {/* Camera/File Input */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <label className="block w-full p-4 text-center border-2 border-dashed border-blue-300 rounded-lg cursor-pointer hover:bg-blue-50 bg-blue-50 text-blue-700 font-semibold flex flex-col items-center justify-center h-32">
            <span className="text-2xl mb-2">📸</span>
            <span>カメラ</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
              ref={cameraInputRef}
            />
          </label>
          <label className="block w-full p-4 text-center border-2 border-dashed border-green-300 rounded-lg cursor-pointer hover:bg-green-50 bg-green-50 text-green-700 font-semibold flex flex-col items-center justify-center h-32">
            <span className="text-2xl mb-2">🖼</span>
            <span>アルバム (複数可)</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
              ref={fileInputRef}
            />
          </label>
        </div>

        {/* お店の判別結果。自動入力したお店と、ほかの候補への切り替え */}
        {image && !isScanning && (appliedStore || storeMatches.length > 0) && (
          <div className="mb-4 p-3 rounded-lg border border-emerald-200 bg-emerald-50 space-y-2">
            {appliedStore ? (
              <p className="text-sm text-emerald-900">
                🏪 <b>{appliedStore.companyName ?? appliedStore.invoiceNumber}</b> として入力しました
                <span className="text-xs text-emerald-700">（{appliedStore.reasons.join('・')}{appliedStore.count ? `／これまで${appliedStore.count}回` : ''}）</span>
              </p>
            ) : (
              <p className="text-sm text-emerald-900">🏪 このお店かもしれません。当てはまるものを押すと入力します。</p>
            )}
            <div className="flex flex-wrap gap-2">
              {storeMatches
                .filter((s) => s !== appliedStore)
                .map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => applyStore(s)}
                    className="text-xs px-3 py-1.5 rounded-full bg-white border border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                  >
                    {s.companyName ?? s.invoiceNumber}
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* よく使うお店。同じ情報を何度も入れずに済むよう、ワンタップで入力 */}
        {image && !isScanning && frequentStores.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-1">よく使うお店（押すと店名・登録番号・支払い方法・分類が入ります）</p>
            <div className="flex flex-wrap gap-2">
              {frequentStores.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => applyStore({ ...s, reasons: ['よく使うお店から選択'] })}
                  className="text-xs px-3 py-1.5 rounded-full bg-gray-100 border border-gray-300 text-gray-800 hover:bg-gray-200"
                >
                  {s.companyName ?? s.invoiceNumber}
                  <span className="ml-1 text-gray-500">{s.count}回</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Preview */}
        {previewUrl && (
          <ImagePreview src={previewUrl} onRotate={handleRotate} />
        )}

        {/* Status */}
        {statusMessage && (
          <div className={`mb-4 p-3 rounded flex justify-between items-center ${isScanning ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
            <span className="text-sm">{statusMessage}</span>
            {isScanning && (
              <button
                type="button"
                onClick={handleCancel}
                className="ml-4 px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 whitespace-nowrap"
              >
                中止
              </button>
            )}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">インボイス番号 (T+13桁)</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm">T</span>
                </div>
                <input
                  type="text"
                  disabled={isScanning}
                  {...register('invoiceNumber')}
                  placeholder="1234567890123"
                  className="mt-1 block w-full pl-7 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border disabled:bg-gray-100 text-gray-900 bg-white"
                />
              </div>
              <button
                type="button"
                onClick={handleManualLookup}
                disabled={isScanning}
                className="mt-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 text-sm whitespace-nowrap"
              >
                検索
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">日付</label>
            <input
              type="date"
              disabled={isScanning}
              {...register('date')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border disabled:bg-gray-100 text-gray-900 bg-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">企業名</label>
            <input
              type="text"
              disabled={isScanning}
              {...register('companyName')}
              placeholder="株式会社〇〇"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border disabled:bg-gray-100 text-gray-900 bg-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">合計金額 (円)</label>
            <input
              type="number"
              disabled={isScanning}
              {...register('totalAmount')}
              placeholder="1000"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border disabled:bg-gray-100 text-gray-900 bg-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">支払い方法</label>
            <select
              disabled={isScanning}
              {...register('paymentMethod')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border disabled:bg-gray-100 text-gray-900 bg-white"
            >
              <option value="現金">現金</option>
              <option value="クレジットカード">クレジットカード</option>
              <option value="電子マネー">電子マネー</option>
              <option value="その他">その他</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">分類（勘定科目）</label>
            <select
              disabled={isScanning}
              {...register('category')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border disabled:bg-gray-100 text-gray-900 bg-white"
            >
              <option value="">未分類</option>
              {RECEIPT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">お店ごとに覚えて、次回から自動で入ります。</p>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!image || isScanning}
              className="flex-1 flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-gray-400"
            >
              {queue.length > 0 ? '保存して次へ' : '保存する'}
            </button>
            {queue.length > 0 && (
              <button
                type="button"
                onClick={handleNext}
                className="flex-none px-4 py-3 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                スキップ
              </button>
            )}
          </div>
        </form>
      </div>
      {/* Debug Section */}
      <DebugSection text={ocrDebugText} values={watch()} />
    </main>
  );
}

function DebugSection({ text, values }: { text: string, values: FormData }) {
  if (!text) return null;
  return (
    <div className="mt-8 p-4 bg-gray-800 text-white rounded-lg text-xs font-mono overflow-hidden max-w-md mx-auto md:max-w-2xl">
      <h3 className="font-bold mb-2 text-green-400">🛠 OCR解析ログ (デバッグ用)</h3>

      <div className="grid grid-cols-2 gap-4 mb-4 border-b border-gray-700 pb-4">
        <div>
          <span className="text-gray-400">日付:</span>
          <span className={values.date ? "text-green-400 ml-2" : "text-red-400 ml-2"}>
            {values.date ? `✅ ${values.date}` : "❌ 未取得"}
          </span>
        </div>
        <div>
          <span className="text-gray-400">金額:</span>
          <span className={values.totalAmount ? "text-green-400 ml-2" : "text-red-400 ml-2"}>
            {values.totalAmount ? `✅ ${values.totalAmount}円` : "❌ 未取得"}
          </span>
        </div>
        <div>
          <span className="text-gray-400">番号:</span>
          <span className={values.invoiceNumber ? "text-green-400 ml-2" : "text-red-400 ml-2"}>
            {values.invoiceNumber ? `✅ ${values.invoiceNumber}` : "❌ 未取得"}
          </span>
        </div>
        <div>
          <span className="text-gray-400">企業:</span>
          <span className={values.companyName ? "text-green-400 ml-2" : "text-red-400 ml-2"}>
            {values.companyName ? `✅ ${values.companyName}` : "❌ 未取得"}
          </span>
        </div>
        <div>
          <span className="text-gray-400">支払:</span>
          <span className="text-green-400 ml-2">
            {values.paymentMethod || '-'}
          </span>
        </div>
      </div>

      <div className="mt-2">
        <p className="text-gray-400 mb-1">▼ 読み取り生テキスト:</p>
        <pre className="whitespace-pre-wrap bg-gray-900 p-2 rounded border border-gray-700 max-h-64 overflow-y-auto">
          {text}
        </pre>
      </div>
    </div>
  );
}
