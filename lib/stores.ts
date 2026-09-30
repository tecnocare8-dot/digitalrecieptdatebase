// お店ごとの学習と判別。
// 文字認識（OCR）だけでは読めないことがあるため、レシート上部（ロゴや店名の配置）の見た目の特徴と色も手がかりにする。
// 学習結果は利用者のドライブの「店舗パターン.json」に保存する（lib/drive.ts）。ここは保存先に依存しない純粋な処理だけを置く

/** 画面側（utils/fingerprint.ts）で作る、1枚のレシートの手がかり */
export interface ReceiptSignals {
  /**
   * 画像認識モデル（MobileNet）による見た目の特徴。レシート上部256＋全体256の8bit値をbase64にしたもの。
   * 見た目での判別の主役（実写144枚の検証で、単純な指紋より大幅に良かった）。モデルが読めない環境では null
   */
  embedding: string | null;
  /** レシート上部の見た目の指紋（64bitのdHashを16桁の16進数で）。精度が低いので候補の提示にだけ使う */
  headerHash: string | null;
  /** レシート全体の見た目の指紋 */
  wholeHash: string | null;
  /** レシート上部の色の分布（色相12区分、合計1）。白黒のレシートでは null */
  headerHue: number[] | null;
  /** OCRで読めた電話番号（数字のみ） */
  phones: string[];
  /** OCRで読めた文字（照合用に正規化済み・先頭部分） */
  text: string;
}

export interface StoreFingerprint {
  receiptId: string;
  embedding?: string | null;
  headerHash: string | null;
  wholeHash: string | null;
  headerHue: number[] | null;
}

export interface StorePattern {
  key: string;
  companyName: string | null;
  invoiceNumber: string | null;
  /** 支払い方法・分類はお店ごとに回数を数え、一番多いものを使う */
  paymentMethods: Record<string, number>;
  categories: Record<string, number>;
  phones: string[];
  fingerprints: StoreFingerprint[];
  count: number;
  lastUsed: string;
}

export interface PatternsFile {
  version: 1;
  stores: StorePattern[];
}

export interface LearnInput {
  receiptId: string;
  companyName: string | null;
  invoiceNumber: string | null;
  paymentMethod: string | null;
  category: string | null;
  usedAt: string;
  signals: ReceiptSignals | null;
}

export interface StoreSuggestion {
  companyName: string | null;
  invoiceNumber: string | null;
  paymentMethod: string | null;
  category: string | null;
  count: number;
  score: number;
  reasons: string[];
}

const MAX_FINGERPRINTS_PER_STORE = 8;
const MAX_PHONES_PER_STORE = 5;
/** 自動入力してよい一致度 */
export const AUTO_FILL_SCORE = 70;

export function emptyPatterns(): PatternsFile {
  return { version: 1, stores: [] };
}

/** 照合用に文字をそろえる（全角→半角、空白・記号・法人格の除去、小文字化） */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/株式会社|有限会社|合同会社|\(株\)|\(有\)|\(同\)|㈱|㈲/g, '')
    .replace(/[\s　・,.、。\-‐ー_/\\()（）「」『』"'’]/g, '');
}

function storeKey(invoiceNumber: string | null, companyName: string | null): string | null {
  if (invoiceNumber) return `inv:${invoiceNumber}`;
  const n = companyName ? normalizeName(companyName) : '';
  return n ? `name:${n}` : null;
}

function top(counts: Record<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

function histogramSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

/**
 * 画像認識モデルの特徴で、1位のお店が2位のお店をこれだけ上回れば、見た目だけで自動入力してよい。
 * 実写144枚（29店）を learn/matchStores に通した検証で、この差以上のときの正解率は95%（57/60枚）だった。
 * 0.06 では94%（63/67枚）だったため、少し厳しくしている
 */
export const EMBEDDING_MARGIN = 0.07;
const EMBED_BYTES = 512;

function decodeEmbedding(b64: string | null | undefined): Int8Array | null {
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  return buf.length === EMBED_BYTES ? new Int8Array(buf.buffer, buf.byteOffset, buf.length) : null;
}

function cosine(a: Int8Array, b: Int8Array, from: number, to: number): number {
  let s = 0, na = 0, nb = 0;
  for (let i = from; i < to; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
}

/** レシート上部と全体の特徴の近さの平均（-1〜1） */
function embeddingSimilarity(a: Int8Array, b: Int8Array): number {
  const half = EMBED_BYTES / 2;
  return (cosine(a, b, 0, half) + cosine(a, b, half, EMBED_BYTES)) / 2;
}

/** 単純な指紋（dHash・色）の一致度 0〜1 と、その理由。精度が低いので候補の提示にだけ使う */
function hashSimilarity(sig: ReceiptSignals, fps: StoreFingerprint[]): { score: number; reason: string | null } {
  let best = 0;
  let reason: string | null = null;
  for (const fp of fps) {
    let s = 0;
    const parts: string[] = [];
    if (sig.headerHash && fp.headerHash) {
      const h = Math.max(0, 1 - hamming(sig.headerHash, fp.headerHash) / 12);
      s += 0.7 * h;
      if (h > 0.5) parts.push('ロゴ・上部のデザイン');
    }
    if (sig.wholeHash && fp.wholeHash) {
      const w = Math.max(0, 1 - hamming(sig.wholeHash, fp.wholeHash) / 16);
      s += 0.15 * w;
      if (w > 0.5) parts.push('全体の配置');
    }
    if (sig.headerHue && fp.headerHue) {
      const c = histogramSimilarity(sig.headerHue, fp.headerHue);
      s += 0.15 * c;
      if (c > 0.8) parts.push('ロゴの色');
    }
    if (s > best) {
      best = s;
      reason = parts.length ? `${parts.join('・')}が似ている` : null;
    }
  }
  return { score: best, reason };
}

/**
 * 新しいレシートの手がかりから、過去に学習したお店を一致度の高い順に返す。
 * - 登録番号・電話番号・店名の文字が一致 → 強い手がかり（自動入力）
 * - 画像認識の特徴で、1位が2位を EMBEDDING_MARGIN 以上上回る → 見た目だけでも自動入力
 * - それ以外の見た目の近さ → 候補として出すだけ（自動入力しない）
 */
export function matchStores(patterns: PatternsFile, sig: ReceiptSignals, ocrInvoiceNumber: string | null, limit = 3): StoreSuggestion[] {
  const text = normalizeName(sig.text ?? '');

  // 画像認識の特徴で、お店ごとに一番近い1枚との近さを出し、1位と2位の差を見る
  const emb = decodeEmbedding(sig.embedding);
  const embSim = new Map<StorePattern, number>();
  if (emb) {
    for (const p of patterns.stores) {
      let best = -Infinity;
      for (const fp of p.fingerprints) {
        const other = decodeEmbedding(fp.embedding);
        if (other) best = Math.max(best, embeddingSimilarity(emb, other));
      }
      if (best > -Infinity) embSim.set(p, best);
    }
  }
  const embRanked = [...embSim.entries()].sort((a, b) => b[1] - a[1]);
  const embLeader = embRanked.length >= 2 && embRanked[0][1] - embRanked[1][1] >= EMBEDDING_MARGIN ? embRanked[0][0] : null;
  const embNearest = embRanked[0]?.[0] ?? null;

  const scored = patterns.stores.map((p) => {
    let score = 0;
    const reasons: string[] = [];
    if (ocrInvoiceNumber && p.invoiceNumber === ocrInvoiceNumber) {
      score = Math.max(score, 100);
      reasons.push('登録番号が一致');
    }
    if (sig.phones.some((ph) => p.phones.includes(ph))) {
      score = Math.max(score, 95);
      reasons.push('電話番号が一致');
    }
    const name = p.companyName ? normalizeName(p.companyName) : '';
    if (name.length >= 3 && text.includes(name)) {
      score = Math.max(score, 85);
      reasons.push('店名の文字が一致');
    }

    const strongText = score > 0;
    if (p === embLeader) {
      score = strongText ? Math.min(100, score + 5) : 80;
      reasons.push('ロゴ・デザインが一致（画像認識）');
    } else if (p === embNearest && !strongText) {
      score = Math.max(score, 50);
      reasons.push('ロゴ・デザインが似ている');
    } else {
      const hash = hashSimilarity(sig, p.fingerprints);
      if (hash.reason && !strongText) {
        score = Math.max(score, Math.min(AUTO_FILL_SCORE - 15, Math.round(hash.score * 60)));
        reasons.push(hash.reason);
      }
    }
    return { p, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score || b.p.count - a.p.count);

  return scored
    .filter((s) => s.score > 0)
    .slice(0, limit)
    .map(({ p, score, reasons }) => ({
      companyName: p.companyName,
      invoiceNumber: p.invoiceNumber,
      paymentMethod: top(p.paymentMethods),
      category: top(p.categories),
      count: p.count,
      score,
      reasons,
    }));
}

/** よく使うお店（回数の多い順）。同じ情報を何度も入れずに済むよう、ワンタップ入力に使う */
export function frequentStores(patterns: PatternsFile, limit = 6): StoreSuggestion[] {
  return [...patterns.stores]
    .filter((p) => p.count >= 2 && (p.companyName || p.invoiceNumber))
    .sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed))
    .slice(0, limit)
    .map((p) => ({
      companyName: p.companyName,
      invoiceNumber: p.invoiceNumber,
      paymentMethod: top(p.paymentMethods),
      category: top(p.categories),
      count: p.count,
      score: 0,
      reasons: [`${p.count}回`],
    }));
}

/** 1枚のレシートの学習を取り消す（削除・店の訂正のとき） */
export function forget(patterns: PatternsFile, receiptId: string, old: { companyName: string | null; invoiceNumber: string | null; paymentMethod: string | null; category: string | null }): PatternsFile {
  const key = storeKey(old.invoiceNumber, old.companyName);
  const stores = patterns.stores.flatMap((p) => {
    const fingerprints = p.fingerprints.filter((f) => f.receiptId !== receiptId);
    if (p.key !== key) return [{ ...p, fingerprints }];
    const dec = (m: Record<string, number>, k: string | null) => {
      if (!k || !m[k]) return m;
      const n = { ...m, [k]: m[k] - 1 };
      if (n[k] <= 0) delete n[k];
      return n;
    };
    const count = p.count - 1;
    if (count <= 0) return [];
    return [{ ...p, fingerprints, count, paymentMethods: dec(p.paymentMethods, old.paymentMethod), categories: dec(p.categories, old.category) }];
  });
  return { ...patterns, stores };
}

/** 保存された1枚のレシートから、そのお店のパターンを学習する */
export function learn(patterns: PatternsFile, input: LearnInput): PatternsFile {
  const key = storeKey(input.invoiceNumber, input.companyName);
  if (!key) return patterns; // 店名も登録番号も無いレシートは、何のお店か教えられないので学習しない

  // 登録番号が後から分かった場合に、店名だけで学習していた分をまとめる
  const nameKey = input.companyName ? storeKey(null, input.companyName) : null;
  const existing = patterns.stores.find((p) => p.key === key)
    ?? (key.startsWith('inv:') && nameKey ? patterns.stores.find((p) => p.key === nameKey) : undefined);

  const base: StorePattern = existing ?? {
    key, companyName: null, invoiceNumber: null, paymentMethods: {}, categories: {}, phones: [], fingerprints: [], count: 0, lastUsed: input.usedAt,
  };
  const inc = (m: Record<string, number>, k: string | null) => (k ? { ...m, [k]: (m[k] ?? 0) + 1 } : m);

  const fingerprints = [...base.fingerprints.filter((f) => f.receiptId !== input.receiptId)];
  if (input.signals && (input.signals.embedding || input.signals.headerHash || input.signals.wholeHash)) {
    fingerprints.push({
      receiptId: input.receiptId,
      embedding: input.signals.embedding,
      headerHash: input.signals.headerHash,
      wholeHash: input.signals.wholeHash,
      headerHue: input.signals.headerHue,
    });
  }
  const phones = [...new Set([...(input.signals?.phones ?? []), ...base.phones])].slice(0, MAX_PHONES_PER_STORE);

  const updated: StorePattern = {
    ...base,
    key,
    companyName: input.companyName ?? base.companyName,
    invoiceNumber: input.invoiceNumber ?? base.invoiceNumber,
    paymentMethods: inc(base.paymentMethods, input.paymentMethod),
    categories: inc(base.categories, input.category),
    phones,
    fingerprints: fingerprints.slice(-MAX_FINGERPRINTS_PER_STORE),
    count: base.count + 1,
    lastUsed: input.usedAt > base.lastUsed ? input.usedAt : base.lastUsed,
  };

  return { ...patterns, stores: [...patterns.stores.filter((p) => p !== existing), updated] };
}

/** 画面から届いた手がかりを検証・整形する（おかしな値や大きすぎる値でパターンファイルを壊さないため） */
export function sanitizeSignals(raw: unknown): ReceiptSignals | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const hash = (v: unknown) => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : null);
  const hue = Array.isArray(r.headerHue) && r.headerHue.length === 12 && r.headerHue.every((x) => typeof x === 'number' && x >= 0 && x <= 1)
    ? (r.headerHue as number[]).map((x) => Math.round(x * 1000) / 1000)
    : null;
  const phones = Array.isArray(r.phones)
    ? [...new Set(r.phones.filter((p): p is string => typeof p === 'string' && /^0\d{9,10}$/.test(p)))].slice(0, 3)
    : [];
  const text = typeof r.text === 'string' ? r.text.slice(0, 400) : '';
  // 512バイトをbase64にしたもの（684文字、末尾は = 1つ）
  const embedding = typeof r.embedding === 'string' && /^[A-Za-z0-9+/]{683}=$/.test(r.embedding) ? r.embedding : null;
  return { embedding, headerHash: hash(r.headerHash), wholeHash: hash(r.wholeHash), headerHue: hue, phones, text };
}

/** ドライブの「店舗パターン.json」を読む。壊れていたら空から始める */
export function parsePatterns(text: string | null): PatternsFile | null {
  if (!text) return null;
  try {
    const p = JSON.parse(text);
    return p && p.version === 1 && Array.isArray(p.stores) ? p : null;
  } catch {
    return null;
  }
}
