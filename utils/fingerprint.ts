// レシート画像から、お店を見分けるための手がかりを作る（ブラウザ内で計算し、画像そのものは送らない）。
// 文字が読めなくても、ロゴや店名の配置・色はお店ごとにほぼ同じなので、見た目の「指紋」として使う。
//   headerHash: レシート上部（ロゴ・店名のあたり）の形の特徴（dHash 64bit）
//   wholeHash : レシート全体の配置の特徴
//   headerHue : レシート上部の色の分布（色付きのロゴ用。白黒なら null）
import type { ReceiptSignals } from '@/lib/stores';

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
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

export interface Box { x: number; y: number; w: number; h: number }

/** 机などの背景から、白いレシートの紙の範囲を探す。うまく見つからなければ画像全体 */
export function findPaper(gray: Float32Array, w: number, h: number): Box {
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
        let byte = 0;
        for (let x = 0; x < 8; x++) {
            byte = (byte << 1) | (lum(y * 9 + x) > lum(y * 9 + x + 1) ? 1 : 0);
        }
        hex += byte.toString(16).padStart(2, '0');
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

// ---------------------------------------------------------------------------
// 画像認識モデル（MobileNet v2）による見た目の特徴。
// 実際のレシート写真144枚（29店）で比べた結果、上の単純な指紋より大幅に良かった
// （見た目だけで正しいお店: 65%、正解率95%で自動入力できた割合: 42%）。
// モデル（約14MB）は初回だけダウンロードされ、以後はブラウザにキャッシュされる。読み込めなければ使わない

const EMBED_DIM = 256; // 1280次元の特徴を、固定の乱数射影で256次元に縮める（保存サイズを小さくするため）

type MobileNet = { infer: (img: HTMLCanvasElement, embedding: boolean) => { data: () => Promise<Float32Array>; dispose: () => void } };
let modelPromise: Promise<MobileNet | null> | null = null;

/** モデルを1回だけ読み込む。撮影前に呼んでおくと、判別を待たずに済む */
export function preloadModel(): Promise<MobileNet | null> {
    if (!modelPromise) {
        modelPromise = (async () => {
            try {
                await import('@tensorflow/tfjs');
                const mobilenet = await import('@tensorflow-models/mobilenet');
                return (await mobilenet.load({ version: 2, alpha: 1.0 })) as unknown as MobileNet;
            } catch (e) {
                console.error('Image model unavailable; store matching falls back to text', e);
                modelPromise = null; // 次回また試す
                return null;
            }
        })();
    }
    return modelPromise;
}

let projection: Float32Array[] | null = null;
/** 決まった種から作る射影行列（全員・全端末で同じでなければ比較できない） */
function projectionFor(dim: number): Float32Array[] {
    if (!projection) {
        let seed = 12345;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
        projection = Array.from({ length: EMBED_DIM }, () => Float32Array.from({ length: dim }, rnd));
    }
    return projection;
}

function projectInt8(v: Float32Array): Int8Array {
    const out = projectionFor(v.length).map((row) => row.reduce((s, x, i) => s + x * v[i], 0));
    const m = Math.max(...out.map(Math.abs)) || 1;
    return Int8Array.from(out, (x) => Math.round((x / m) * 127));
}

async function embed(model: MobileNet, source: HTMLCanvasElement, box: Box): Promise<Int8Array> {
    const c = document.createElement('canvas');
    c.width = 224;
    c.height = 224;
    c.getContext('2d')!.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, 224, 224);
    const t = model.infer(c, true);
    const v = await t.data();
    t.dispose();
    return projectInt8(v);
}

function toBase64(bytes: Int8Array): string {
    let s = '';
    new Uint8Array(bytes.buffer).forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
}

export async function computeSignals(file: Blob, ocrText: string): Promise<ReceiptSignals> {
    const img = await loadImage(file);
    const scale = Math.min(1, 800 / Math.max(img.width, img.height));
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
    const header: Box = { x: paper.x, y: paper.y, w: paper.w, h: Math.max(8, Math.round(paper.h * 0.22)) };

    // レシート上部（ロゴ・店名）と全体の特徴をつなげて512バイトにする
    let embedding: string | null = null;
    const model = await preloadModel();
    if (model) {
        try {
            const both = new Int8Array(EMBED_DIM * 2);
            both.set(await embed(model, canvas, header), 0);
            both.set(await embed(model, canvas, paper), EMBED_DIM);
            embedding = toBase64(both);
        } catch (e) {
            console.error('Image embedding failed', e);
        }
    }

    return {
        embedding,
        headerHash: dHash(canvas, header),
        wholeHash: dHash(canvas, paper),
        headerHue: hueHistogram(ctx, header),
        phones: extractPhones(ocrText),
        text: ocrText.normalize('NFKC').replace(/\s+/g, '').slice(0, 400),
    };
}
