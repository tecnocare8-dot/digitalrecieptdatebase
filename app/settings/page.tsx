'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface SettingsData {
  isPro: boolean;
  isExpired: boolean;
  proExpiresAt: string | null;
  receiptCount: number;
  maxFreeReceipts: number;
  canAddReceipt: boolean;
  reason?: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Check URL query parameters for checkout status
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'true') {
      setMessage('🎉 Proプランへのアップグレードが完了しました！');
    } else if (params.get('canceled') === 'true') {
      setMessage('決済手続きがキャンセルされました。');
    }

    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (e) {
      console.error('Failed to fetch settings:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
      });
      const data = await res.json();

      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        const errorMsg = data.error || '決済の開始に失敗しました。';
        setErrorMessage(errorMsg);
        alert(`【エラー】${errorMsg}`);
      }
    } catch (e: any) {
      console.error(e);
      const connErrMsg = e.message || '決済APIへの接続に失敗しました。';
      setErrorMessage(connErrMsg);
      alert(`【通信エラー】${connErrMsg}`);
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-6 flex justify-center items-center">
        <div className="text-gray-600 font-medium">設定情報を読み込み中...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden md:max-w-2xl p-6">
        <div className="flex justify-between items-center mb-6 border-b pb-4">
          <h1 className="text-2xl font-bold text-gray-800">⚙ サブスクリプション・環境設定</h1>
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← トップへ戻る
          </Link>
        </div>

        {message && (
          <div className="mb-6 p-4 rounded-lg bg-blue-50 text-blue-800 font-medium border border-blue-200">
            {message}
          </div>
        )}

        {errorMessage && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 text-red-800 font-medium border border-red-300 flex flex-col gap-1">
            <span className="font-bold text-red-900">⚠️ 決済開始エラー:</span>
            <span className="text-sm leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Status Card */}
        <div className="bg-gray-50 rounded-xl p-5 border mb-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-gray-600 font-semibold">現在のプラン</span>
            {settings?.isPro ? (
              <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                ⭐ Proプラン適用中
              </span>
            ) : settings?.isExpired ? (
              <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                ⚠️ 有効期限切れ
              </span>
            ) : (
              <span className="bg-gray-200 text-gray-700 px-3 py-1 rounded-full text-xs font-bold">
                無料プラン
              </span>
            )}
          </div>

          <div className="space-y-3 text-sm border-t pt-3">
            <div className="flex justify-between">
              <span className="text-gray-500">登録済み領収書件数:</span>
              <span className="font-bold text-gray-800">
                {settings?.receiptCount ?? 0} 件
                {!settings?.isPro && !settings?.isExpired && (
                  <span className="text-gray-500 font-normal ml-1">
                    (上限 {settings?.maxFreeReceipts ?? 5} 件)
                  </span>
                )}
              </span>
            </div>

            {settings?.proExpiresAt && (
              <div className="flex justify-between">
                <span className="text-gray-500">Pro有効期限:</span>
                <span className={`font-bold ${settings.isExpired ? 'text-red-600' : 'text-gray-800'}`}>
                  {new Date(settings.proExpiresAt).toLocaleDateString('ja-JP')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Upgrade / Renewal Action */}
        <div className="border rounded-xl p-5 bg-gradient-to-br from-indigo-50 to-blue-50 mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-2">
            {settings?.isPro
              ? 'Proプランのご利用中'
              : settings?.isExpired
              ? 'Proプランの有効期限が切れました'
              : 'Proプラン（年額 1,500円）へアップグレード'}
          </h2>
          <p className="text-sm text-gray-600 mb-4 leading-relaxed">
            {settings?.isPro ? (
              '現在Proプランが適用されています。領収書の保存件数制限なしでご利用いただけます。'
            ) : settings?.isExpired ? (
              '登録日から1年が経過したため、新しい領収書の追加が制限されています。過去に登録したデータは引き続きそのまま閲覧・ダウンロードが可能です。新しく領収書を登録するには、再購入をお願いいたします。'
            ) : (
              '無料プランでは最大5件まで登録できます。1年間 1,500円で枚数無制限に保存できるようになります。'
            )}
          </p>

          {(!settings?.isPro || settings?.isExpired) && (
            <button
              onClick={handleCheckout}
              disabled={checkoutLoading}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow transition disabled:bg-gray-400 flex items-center justify-center gap-2"
            >
              {checkoutLoading ? (
                'Stripeへ接続中...'
              ) : settings?.isExpired ? (
                '再購入する (1,500円 / 1年間)'
              ) : (
                'Proプランにアップグレード (1,500円 / 1年間)'
              )}
            </button>
          )}
        </div>

        {/* Note Section */}
        <div className="text-xs text-gray-500 leading-relaxed bg-white p-4 border rounded-lg">
          <p className="font-bold mb-1">【ご利用に関する注意事項】</p>
          <ul className="list-disc list-inside space-y-1">
            <li>無料プランは最大5件までの登録制限がございます。</li>
            <li>Proプランは購入日から1年間有効です。</li>
            <li>有効期限が切れても、過去に登録された過去データはそのまま保持され閲覧できます。</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
