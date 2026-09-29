// レシート画像から、お店を見分けるための手がかりを作る（ブラウザ内で計算し、画像そのものは送らない）。
// 文字が読めなくても、ロゴや店名の配置・色はお店ごとにほぼ同じなので、見た目の「指紋」として使う。
//   headerHash: レシート上部（ロゴ・店名のあたり）の形の特徴（dHash 64bit）
//   wholeHash : レシート全体の配置の特徴
//   headerHue : レシート上部の色の分布（色付きのロゴ用。白黒なら null）
import type { ReceiptSignals } from '@/lib/stores';

async function loadImage(file: Blob): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(file);
    try {
        return await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    } finally {
        // onload 後に画像はデコード済みなので解放してよい
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}

interface Box { x: number; y: number; w: number; h: number }

/** 机などの背景から、白いレシートの紙の範囲を探す。うまく見つからなければ画像全体 */
function findPaper(gray: Float32Array, w: number, h: number): Box {
    let sum = 0;
    for (const v of gray) sum += v;
    const mean = sum / gray.length;
    const threshold = Math.max(mean, 140);
    const rowBright = new Array(h).fill(0);
    const colBright = new Array(w).fill(0);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (gray[y * w + x] >= threshold) { rowBright[y]++; colBright[x]++; }
        }
    }
    const rows = rowBright.map((n, y) => (n / w > 0.35 ? y : -1)).filter((y) => y >= 0);
    const cols = colBright.map((n, x) => (n / h > 0.35 ? x : -1)).filter((x) => x >= 0);
    if (rows.length < h * 0.3 || cols.length < w * 0.2) return { x: 0, y: 0, w, h };
    const box = { x: cols[0], y: rows[0], w: cols[cols.length - 1] - cols[0] + 1, h: rows[rows.length - 1] - rows[0] + 1 };
    return box.w * box.h < w * h * 0.15 ? { x: 0, y: 0, w, h } : box;
}

/** 指定範囲を 9x8 に縮めて、横に隣り合う明るさの大小を 64bit にする（dHash） */
function dHash(source: HTMLCanvasElement, box: Box): string {
    const c = document.createElement('canvas');
    c.width = 9;
    c.height = 8;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, 9, 8);
    const d = ctx.getImageData(0, 0, 9, 8).data;
    const lum = (i: number) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    let hex = '';
    for (let y = 0; y < 8; y++) {
        let nibbleBits = 0;
        let byte = 0;
        for (let x = 0; x < 8; x++) {
            byte = (byte << 1) | (lum(y * 9 + x) > lum(y * 9 + x + 1) ? 1 : 0);
            nibbleBits++;
        }
        hex += byte.toString(16).padStart(2, '0');
        void nibbleBits;
    }
    return hex;
}

/** 範囲内の色付きの画素の色相を12区分で数える。色付きがほとんど無ければ null */
function hueHistogram(ctx: CanvasRenderingContext2D, box: Box): number[] | null {
    const d = ctx.getImageData(box.x, box.y, box.w, box.h).data;
    const bins = new Array(12).fill(0);
    let colored = 0;
    const total = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        if (sat < 0.35 || max < 0.25) continue;
        let hue: number;
        if (max === r) hue = ((g - b) / (max - min)) % 6;
        else if (max === g) hue = (b - r) / (max - min) + 2;
        else hue = (r - g) / (max - min) + 4;
        hue = (hue * 60 + 360) % 360;
        bins[Math.floor(hue / 30) % 12]++;
        colored++;
    }
    if (colored < total * 0.01) return null;
    return bins.map((n) => Math.round((n / colored) * 1000) / 1000);
}

/** OCRの文字から電話番号を拾う（ハイフンや括弧の有無を問わず、数字だけにそろえる） */
export function extractPhones(text: string): string[] {
    const t = text.normalize('NFKC').replace(/[‐ー−―－]/g, '-');
    const found = t.match(/0\d{1,4}[-()\s]{0,2}\d{1,4}[-()\s]{0,2}\d{3,4}/g) ?? [];
    return [...new Set(found.map((s) => s.replace(/\D/g, '')).filter((s) => /^0\d{9,10}$/.test(s)))].slice(0, 3);
}

export async function computeSignals(file: Blob, ocrText: string): Promise<ReceiptSignals> {
    const img = await loadImage(file);
    const scale = Math.min(1, 400 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);

    const data = ctx.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];

    const paper = findPaper(gray, w, h);
    const header: Box = { x: paper.x, y: paper.y, w: paper.w, h: Math.max(8, Math.round(paper.h * 0.2)) };

    return {
        headerHash: dHash(canvas, header),
        wholeHash: dHash(canvas, paper),
        headerHue: hueHistogram(ctx, header),
        phones: extractPhones(ocrText),
        text: ocrText.normalize('NFKC').replace(/\s+/g, '').slice(0, 400),
    };
}
