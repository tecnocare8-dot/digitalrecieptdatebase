import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'プライバシーポリシー | デジタル経費記録' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 pb-12 text-sm leading-relaxed text-gray-900">
      <h1 className="text-xl font-bold">プライバシーポリシー</h1>
      <p>株式会社AwesomeLife（以下「当社」）は、デジタル経費記録（以下「本アプリ」）での利用者の情報の扱いを、次のとおり定めます。</p>

      <Section title="1. 本アプリが受け取る情報">
        <ul className="list-disc space-y-1 pl-5">
          <li>Googleアカウントのメールアドレスと名前（ログインのため）</li>
          <li>Googleドライブに領収書を保存するための連携情報（暗号化して保管します）</li>
          <li>ご契約のプランと、その支払いの記録（決済は Stripe が行い、当社はカード番号を受け取りません）</li>
          <li>代表者が登録したスタッフのログインIDと氏名</li>
        </ul>
      </Section>

      <Section title="2. 領収書の保存先">
        <p>
          領収書の画像と記録（日付・店名・金額など）は、利用者ご本人の Google ドライブに保存します。当社のサーバーには保存しません。
          Google ドライブへの権限は、本アプリが作ったファイルだけを扱える範囲（drive.file）に限っています。
        </p>
      </Section>

      <Section title="3. 利用の目的">
        <p>受け取った情報は、ログイン、領収書の保存と表示、プランの管理、お問い合わせへの対応のためだけに使います。広告や販売には使いません。</p>
      </Section>

      <Section title="4. 外部のサービスへの送信">
        <ul className="list-disc space-y-1 pl-5">
          <li>Google（ログイン、Google ドライブへの保存）</li>
          <li>Stripe（Proプランの決済）</li>
          <li>国税庁の適格請求書発行事業者公表サイトの仕組み（領収書の登録番号を確かめるときに、その番号だけを送ります）</li>
          <li>Vercel（本アプリの公開）、Neon（上の1の情報の保管）</li>
        </ul>
        <p>これら以外の第三者に情報を渡すことはありません（法令にもとづく場合を除きます）。</p>
      </Section>

      <Section title="5. Googleのユーザーデータの扱い">
        <p>
          本アプリが Google API から受け取った情報の利用と他のアプリへの転送は、
          <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API サービスのユーザーデータに関するポリシー
          </a>
          （限定使用の要件を含む）に従います。
        </p>
      </Section>

      <Section title="6. 連携の解除と削除">
        <p>
          Googleアカウントの「サードパーティ製のアプリとサービス」から、本アプリの連携をいつでも解除できます。
          当社のサーバーにある情報（上の1）の削除を希望される場合は、下の問い合わせ先までご連絡ください。Google ドライブに保存した領収書は、利用者ご自身のものとしてドライブに残ります。
        </p>
      </Section>

      <Section title="7. 問い合わせ先">
        <p>
          株式会社AwesomeLife（代表取締役 田中一秀）<br />
          〒254-0024 神奈川県平塚市馬入本町15-13-702<br />
          メール：<a className="underline" href="mailto:awesomelifeds@gmail.com">awesomelifeds@gmail.com</a>
        </p>
      </Section>
      <p><Link href="/legal" className="underline">特定商取引法に基づく表記</Link>　<Link href="/" className="underline">アプリに戻る</Link></p>
    </main>
  );
}
