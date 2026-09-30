import type { MetadataRoute } from 'next';

// スマホで「ホーム画面に追加」したときの名前・アイコン・色
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'デジタル経費記録',
    short_name: '経費記録',
    description: '領収書を撮影して、あなたのGoogleドライブに経費の記録を残すアプリ',
    start_url: '/',
    display: 'standalone',
    background_color: '#F3F4F6',
    theme_color: '#4338CA',
    lang: 'ja',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
