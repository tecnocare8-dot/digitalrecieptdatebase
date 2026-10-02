'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import DriveFolderSetup, { type DriveStatus } from '@/components/DriveFolderSetup';
import StaffManager from '@/components/StaffManager';

interface SettingsData {
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

export default function SettingsPage() {
  const { data: session } = useSession();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');

    const init = async () => {
      if (sessionId) {
        // 決済から戻ってきたとき。Stripeに支払い状況を直接確認してから表示する
        setMessage('お支払いを確認しています...');
        try {
          const res = await fetch('/api/checkout/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });
          const data = await res.json();
          if (res.ok && (data.result === 'granted' || data.result === 'already')) {
            setMessage('🎉 Proプランへのアップグレードが完了しました！');
          } else if (res.ok && data.result === 'not_paid') {
            setMessage('お支払いの完了を確認できませんでした。反映まで時間がかかる場合があります。しばらくしてからこのページを再読み込みしてください。');
          } else {
            setErrorMessage(data.error || 'お支払い状況の確認に失敗しました。');
          }
        } catch {
          setErrorMessage('お支払い状況の確認中に通信エラーが発生しました。');
        }
        window.history.replaceState(null, '', '/settings');
      } else if (params.get('canceled') === 'true') {
        setMessage('決済手続きがキャンセルされました。');
      }
      await fetchSettings();
    };
    init();
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
        setErrorMessage(data.error || '決済の開始に失敗しました。');
      }
    } catch (e: any) {
      console.error(e);
      setErrorMessage(e.message || '決済APIへの接続に失敗しました。');
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6 flex justify-center items-center">
        <div className="text-gray-600 font-medium">{message ?? '設定情報を読み込み中...'}</div>
      </main>
    );
  }

  // スタッフ：プラン・保存先・スタッフ管理は代表者が行うので、ログイン中の名前とログアウトだけ
  if (settings?.role === 'staff') {
    return (
      <main className="min-h-screen bg-gray-50 p-4 md:p-8">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-sm border p-6 md:p-8 space-y-6">
          <div className="flex justify-between items-center pb-4 border-b">
            <h1 className="text-2xl font-bold text-gray-900">設定</h1>
            <Link href="/" className="text-sm font-medium text-blue-600 hover:text-blue-800">
              ← 戻る
            </Link>
          </div>
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-gray-800 border-b pb-2">アカウント</h2>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-gray-700">
                <span className="font-bold">{settings.displayName}</span>（スタッフ）としてログイン中
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="shrink-0 text-xs font-semibold px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-100 text-gray-700"
              >
                ログアウト
              </button>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              登録した領収書は代表者の帳簿に保存されます。見られるのは自分が登録した分だけです。
              パスワードを忘れたときや、登録を取り消したいときは代表者に連絡してください。
            </p>
            {!settings.canAddReceipt && settings.reason && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{settings.reason}</p>
            )}
          </div>
        </div>
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
            <span className="font-bold text-red-900">⚠️ エラー:</span>
            <span className="text-sm leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Section: Google Drive */}
        {settings?.drive && (
          <div className="p-6 rounded-2xl border border-blue-200 bg-blue-50/40 space-y-4">
            <h2 className="text-lg font-bold text-blue-900">📁 保存先（Googleドライブ）</h2>
            <DriveFolderSetup drive={settings.drive} onChanged={fetchSettings} />
          </div>
        )}

        {/* Section: Staff */}
        {settings && (
          <div className="p-6 rounded-2xl border border-indigo-200 bg-indigo-50/40 space-y-4">
            <h2 className="text-lg font-bold text-indigo-900">👥 スタッフ</h2>
            <StaffManager isPro={settings.isPro} />
          </div>
        )}

        {/* Section: Account */}
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-800 border-b pb-2">アカウント</h2>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-gray-700 break-all">{session?.user?.email}</div>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="shrink-0 text-xs font-semibold px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-100 text-gray-700"
            >
              ログアウト
            </button>
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
                無料プラン ({settings?.receiptCount ?? 0}/{settings?.maxFreeReceipts ?? 5}件)
              </span>
            )}
          </div>

          <p className="text-xs text-amber-800 leading-relaxed">
            {settings?.isPro
              ? '現在Proプランをご利用中です。有効期限まで領収書を件数無制限で保存できます。期限内に再購入すると、有効期限が1年延長されます。'
              : settings?.isExpired
              ? 'Proプランの有効期限（1年間）が経過したため新しい保存が制限されています。これまでの領収書の閲覧・編集・CSV出力は引き続きご利用いただけます。再購入（1,500円/年）いただくと再度保存が可能になります。'
              : `無料プランでは領収書を${settings?.maxFreeReceipts ?? 5}件まで保存できます。Proプラン（1,500円 / 1年間）にアップグレードすると、1年間は件数無制限で保存できます。`}
          </p>

          {settings?.proExpiresAt && (
            <p className="text-xs font-semibold text-gray-600">
              有効期限: {new Date(settings.proExpiresAt).toLocaleDateString('ja-JP')}
            </p>
          )}

          <button
            onClick={handleCheckout}
            disabled={checkoutLoading}
            className="w-full py-3.5 px-4 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow transition disabled:bg-gray-400 flex items-center justify-center gap-2 text-sm"
          >
            {checkoutLoading
              ? '処理中...'
              : settings?.isPro
              ? '💳 1年延長する（1,500円）'
              : settings?.isExpired
              ? '💳 Proプランを再購入する（1,500円/年）'
              : '💳 StripeでProプラン（1,500円/年）にアップグレードする'}
          </button>
        </div>

      </div>
    </main>
  );
}
