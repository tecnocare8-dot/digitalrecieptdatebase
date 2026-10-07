import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: '特定商取引法に基づく表記 | デジタル経費記録' };

const ROWS: [string, React.ReactNode][] = [
  ['販売事業者', '株式会社AwesomeLife'],
  ['代表者', '代表取締役 田中一秀'],
  ['所在地', '〒254-0024 神奈川県平塚市馬入本町15-13-702'],
  ['電話番号', 'ご請求があれば遅滞なく開示します。下記のメールアドレスまでご連絡ください。'],
  ['メールアドレス', <a key="m" className="underline" href="mailto:awesomelifeds@gmail.com">awesomelifeds@gmail.com</a>],
  ['販売価格', 'Proプラン 1,500円（税込）／1年間'],
  ['商品代金以外の必要料金', 'インターネットの接続にかかる通信料はお客様のご負担となります。'],
  ['支払方法', 'クレジットカード（Stripe による決済）'],
  ['支払時期', 'ご購入の手続きの完了時に決済されます。'],
  ['提供時期', '決済の完了後、ただちにご利用いただけます。'],
  ['契約期間・更新', '購入日から1年間です。自動では更新されません。期間内に再購入すると、有効期限が1年延長されます。'],
  ['返品・キャンセル', 'デジタルサービスの性質上、決済の完了後の返金・キャンセルはお受けしておりません。ただし、当社の責めに帰すべき事由によりサービスをご利用いただけない場合は、個別にご相談に応じます。'],
  ['動作環境', 'インターネットに接続できるスマートフォン・パソコンの最新のブラウザ。保存先として Google アカウント（Google ドライブ）が必要です。'],
];

export default function LegalPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 pb-12 text-sm leading-relaxed text-gray-900">
      <h1 className="text-xl font-bold">特定商取引法に基づく表記</h1>
      <dl className="divide-y divide-gray-200 rounded-lg border border-gray-300 bg-white">
        {ROWS.map(([k, v]) => (
          <div key={k} className="grid gap-1 p-3 sm:grid-cols-[10rem_1fr]">
            <dt className="font-bold">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p><Link href="/privacy" className="underline">プライバシーポリシー</Link>　<Link href="/" className="underline">アプリに戻る</Link></p>
    </main>
  );
}
