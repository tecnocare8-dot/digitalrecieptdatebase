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
      <main className="min-h-screen bg-gray-50 p-6 flex justify-center items-center">
        <div className="text-gray-600 font-medium">設定情報を読み込み中...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-sm border p-6 md:p-8 space-y-8">
        
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b">
          <h1 className="text-2xl font-bold text-gray-900">設定</h1>
          <Link href="/" className="text-sm font-medium text-blue-600 hover:text-blue-800">
            ← 戻る
          </Link>
        </div>

        {message && (
          <div className="p-4 rounded-xl bg-blue-50 text-blue-800 font-medium border border-blue-200">
            {message}
          </div>
        )}

        {errorMessage && (
          <div className="p-4 rounded-xl bg-red-50 text-red-800 font-medium border border-red-300 flex flex-col gap-1">
            <span className="font-bold text-red-900">⚠️ 決済開始エラー:</span>
            <span className="text-sm leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Section: Documents */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-800 border-b pb-2">ドキュメント・マニュアル</h2>
          
          <div className="p-5 rounded-xl border bg-gray-50 space-y-3">
            <h3 className="font-bold text-gray-900">ユーザー説明書</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              アプリの詳しい使い方や、電子帳簿保存法対応機能についての説明書です。
            </p>
            <a
              href="/docs/user_manual.md"
              download
              className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-100 text-gray-700"
            >
              📄 ダウンロード (Markdown)
            </a>
          </div>

          <div className="p-5 rounded-xl border bg-gray-50 space-y-3">
            <h3 className="font-bold text-gray-900">実装仕様書 (電帳法対応)</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              電子帳簿保存法の要件（検索機能、真実性確保など）に関する技術的な仕様書です。顧問税理士への説明にご利用ください。
            </p>
            <a
              href="/docs/spec_manual.md"
              download
              className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-100 text-gray-700"
            >
              📄 ダウンロード (Markdown)
            </a>
          </div>
        </div>

        {/* Section: Plan Settings */}
        <div className="p-6 rounded-2xl border border-amber-200 bg-amber-50/50 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-amber-900 flex items-center gap-2">
              ⭐ プラン設定 (Stripe決済)
            </h2>
            {settings?.isPro ? (
              <span className="bg-emerald-100 text-emerald-800 text-xs px-3 py-1 rounded-full font-bold">
                ⭐ Proプラン適用中
              </span>
            ) : settings?.isExpired ? (
              <span className="bg-red-100 text-red-800 text-xs px-3 py-1 rounded-full font-bold">
                ⚠️ 有効期限切れ
              </span>
            ) : (
              <span className="bg-amber-200 text-amber-900 text-xs px-3 py-1 rounded-full font-bold">
                無料プラン ({settings?.receiptCount ?? 0}/5件)
              </span>
            )}
          </div>

          <p className="text-xs text-amber-800 leading-relaxed">
            {settings?.isPro
              ? '現在Proプランをご利用中です。保存枚数無制限およびGoogle Driveへの自動保存をご利用いただけます。'
              : settings?.isExpired
              ? 'Proプランの有効期限（1年間）が経過したため新しい保存が制限されています。再購入（1,500円/年）いただくと再度保存が可能になります。'
              : '無料プランをご利用中です。Proプラン（1,500円 / 1年間）にアップグレードすると、無制限の保存およびGoogle Driveへの全自動同期機能が利用可能になります。'}
          </p>

          {settings?.proExpiresAt && (
            <p className="text-xs font-semibold text-gray-600">
              有効期限: {new Date(settings.proExpiresAt).toLocaleDateString('ja-JP')}
            </p>
          )}

          {(!settings?.isPro || settings?.isExpired) && (
            <button
              onClick={handleCheckout}
              disabled={checkoutLoading}
              className="w-full py-3.5 px-4 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow transition disabled:bg-gray-400 flex items-center justify-center gap-2 text-sm"
            >
              💳 StripeでProプラン（1,500円/年）にアップグレードする
            </button>
          )}
        </div>

        {/* Section: Google Drive */}
        <div className="space-y-3 pt-2 border-t">
          <h2 className="text-lg font-bold text-gray-800">Google Drive連携設定</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            Proプラン適用時、保存された領収書画像とメタデータは連携先のGoogle Driveへ自動バックアップ保存されます。
          </p>
        </div>

      </div>
    </main>
  );
}
