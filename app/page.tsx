'use client';

import { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import Link from 'next/link';
import { performOCR, cancelOCR } from '@/utils/ocr';
import ImagePreview from '@/components/ImagePreview';
import LoginButton from '@/components/LoginButton';
import { rotateImage } from '@/utils/image-processing';
import { predictCategory } from '@/utils/categorization';
import { useSession, signIn } from "next-auth/react";

type FormData = {
  date: string;
  invoiceNumber: string;
  companyName: string;
  category: string;
  memo: string;
  totalAmount: number;
  paymentMethod: string;
};

export default function Home() {
  const { data: session, status } = useSession();
  const [isDemo, setIsDemo] = useState(false);

  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [ocrDebugText, setOcrDebugText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Queue State
  const [queue, setQueue] = useState<File[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const { register, handleSubmit, setValue, watch, reset, getValues } = useForm<FormData>({
    defaultValues: {
      paymentMethod: '現金',
      category: '未分類'
    }
  });

  // Watch companyName to auto-predict category
  const watchedCompanyName = watch('companyName');

  useEffect(() => {
    const predicted = predictCategory(watchedCompanyName);
    const currentCategory = getValues('category');
    // Only update if we have a prediction and the current category is default/unset
    if (predicted !== '未分類' && currentCategory === '未分類') {
      setValue('category', predicted);
    }
  }, [watchedCompanyName, setValue, getValues]);

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

          // Auto-categorize
          const predicted = predictCategory(data.companyName);
          setValue('category', predicted);
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

    try {
      const result = await performOCR(file);
      setOcrDebugText(result.text);

      if (result.date) setValue('date', result.date);
      else setValue('date', '');

      if (result.invoiceNumber) {
        // Strip T for display in the input field
        const cleanInvoiceNumber = result.invoiceNumber.replace(/[- ]/g, '').replace(/^T/, '');
        setValue('invoiceNumber', cleanInvoiceNumber);

        // Use T for lookup
        const lookupNumber = 'T' + cleanInvoiceNumber;
        try {
          const res = await fetch(`/api/invoice-lookup?invoiceNumber=${lookupNumber}`);
          if (res.ok) {
            const data = await res.json();
            if (data.companyName) {
              setValue('companyName', data.companyName);
              const predicted = predictCategory(data.companyName);
              setValue('category', predicted);
            }
          }
        } catch (e) { console.error(e); }
      } else {
        setValue('invoiceNumber', '');
      }

      if (result.companyName && !watch('companyName')) {
        setValue('companyName', result.companyName);
        const predicted = predictCategory(result.companyName);
        setValue('category', predicted);
      }
      else if (!result.invoiceNumber) setValue('companyName', '');

      if (result.totalAmount) setValue('totalAmount', result.totalAmount);
      else setValue('totalAmount', 0);

      if (result.paymentMethod) setValue('paymentMethod', result.paymentMethod);
      // else keep default

      setStatusMessage('読み取り完了。内容を確認・修正してください。');
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
      // reset();
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

  const handleUpgrade = async () => {
    try {
      setStatusMessage('決済ページへ移動中...');
      const res = await fetch('/api/checkout', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('決済の開始に失敗しました');
      }
    } catch (e) {
      console.error(e);
      alert('エラーが発生しました');
    }
  };

  const onSubmit = async (data: FormData) => {
    if (!image) return;

    if (isDemo) {
      if (confirm('デモ体験ありがとうございます！\nデータを保存するにはGoogleログインが必要です。\nログイン画面へ移動しますか？')) {
        signIn('google');
      }
      return;
    }

    setStatusMessage('保存中...');
    const formData = new FormData();
    formData.append('image', image);
    formData.append('date', data.date);

    let invoiceNumber = data.invoiceNumber.replace(/[- ]/g, '');
    if (invoiceNumber && !invoiceNumber.startsWith('T')) {
      invoiceNumber = 'T' + invoiceNumber;
    }
    formData.append('invoiceNumber', invoiceNumber);

    formData.append('companyName', data.companyName);
    formData.append('category', data.category);
    formData.append('memo', data.memo || '');
    formData.append('totalAmount', data.totalAmount.toString());
    formData.append('paymentMethod', data.paymentMethod);

    try {
      const res = await fetch('/api/receipts', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        setStatusMessage('保存しました！');
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
      } else {
        // Handle Errors (especially 402 Payment Required)
        if (res.status === 402) {
          const errorData = await res.json();
          setStatusMessage('⚠️ エラー: 上限到達');
          if (confirm('無料プランの上限(5枚)に達しました。\nProプランにアップグレードして無制限に保存しますか？')) {
            handleUpgrade();
          }
          return;
        }

        setStatusMessage('保存エラーが発生しました。');
        alert('保存エラー');
      }
    } catch (e) {
      console.error(e);
      setStatusMessage('通信エラー');
    }
  };

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-gray-100">読み込み中...</div>;
  }

  if (status === 'unauthenticated' && !isDemo) {
    return (
      <main className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-md p-8 text-center space-y-6">
          <h1 className="text-3xl font-bold text-gray-800">レシートスキャン</h1>
          <p className="text-gray-600">
            レシートを撮影して簡単にデータ化・管理できるアプリです。<br />
            まずはGoogleアカウントでログインしてください。
          </p>

          <div className="bg-blue-50 p-4 rounded-lg text-left text-sm text-blue-800 mb-4">
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>無料プラン</strong>: 5枚まで・端末内保存のみ（Google Drive保存なし）</li>
              <li><strong>Proプラン</strong>: 無制限保存 & Google Drive連携（画像永久保存）</li>
              <li><strong>安心設計</strong>: データは自分だけが見れます</li>
            </ul>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => signIn('google')}
              className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 font-bold transition-colors"
            >
              <img src="https://www.google.com/favicon.ico" alt="G" className="w-5 h-5 bg-white rounded-full p-0.5" />
              <span>Googleでログインして開始</span>
            </button>

            <button
              onClick={() => setIsDemo(true)}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              ログインせずにデモを試す (保存不可)
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+5rem)] relative">
      {isDemo && (
        <div className="fixed top-0 left-0 w-full bg-yellow-400 text-yellow-900 text-center text-sm font-bold p-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] z-50 shadow-md">
          ⚠ デモモード中 (保存機能は利用できません)
          <button onClick={() => signIn('google')} className="ml-4 underline text-blue-800">
            ログインして保存する
          </button>
        </div>
      )}
      <div className={`max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden md:max-w-2xl p-6 ${isDemo ? 'mt-8' : ''}`}>
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">レシートスキャン</h1>
          <div className="flex items-center gap-4">
            <Link href="/history" className="text-sm text-blue-600 hover:underline">
              履歴を見る →
            </Link>
            <Link href="/settings" className="text-sm text-gray-600 hover:text-gray-900">
              ⚙️ 設定
            </Link>
            <LoginButton />
            {/* <img src="/company_logo.jpg" alt="Company Logo" className="h-10 w-auto object-contain" /> */}
          </div>
        </div>

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

        {/* Preview */}
        {previewUrl && (
          <ImagePreview src={previewUrl} onRotate={handleRotate} />
        )}

        {/* Status */}
        {statusMessage && (
          <div className={`mb-4 p-3 rounded flex justify-between items-center ${isScanning ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
            <span>{statusMessage}</span>
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
            <label className="block text-sm font-medium text-gray-700">カテゴリー</label>
            <select
              disabled={isScanning}
              {...register('category')}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border disabled:bg-gray-100 text-gray-900 bg-white"
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

          {watch('category') === '会議費' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">備考</label>
              <input
                type="text"
                disabled={isScanning}
                {...register('memo')}
                placeholder="人数：○名、お名前（所属）"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border disabled:bg-gray-100 text-gray-900 bg-white"
              />
            </div>
          )}

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
    <div className="mt-8 p-4 bg-gray-800 text-white rounded-lg text-xs font-mono overflow-hidden">
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
          <span className="text-gray-400">カテゴリ:</span>
          <span className={values.category !== '未分類' ? "text-green-400 ml-2" : "text-yellow-400 ml-2"}>
            {values.category}
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
