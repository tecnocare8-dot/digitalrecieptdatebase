import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from './prisma';
import { decryptSecret } from './crypto';
import {
  emptyPatterns, forget, frequentStores, learn, matchStores, parsePatterns, sanitizeSignals,
  type LearnInput, type PatternsFile, type ReceiptSignals,
} from './stores';

// 領収書は利用者本人の Google ドライブ（このアプリが作ったフォルダ）に保存する。
//   フォルダ/
//     領収書一覧.csv   … 記録の本体。アプリはこのCSVを読み書きする（Excelでそのまま開ける）
//     2026-09-29_株式会社〇〇_1540円.jpg … 領収書の画像
// アプリが無くなってもドライブに記録と画像が残ることが目的。
// 画像の説明欄にも同じ内容を持たせており、CSVが削除されたときはそこから作り直す。
// 権限は drive.file（このアプリが作ったファイルだけ触れる）なので、利用者のほかのファイルは見えない。
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const APP_TAG = 'digital-receipt';
export const LEDGER_NAME = '領収書一覧.csv';
export const PATTERNS_NAME = '店舗パターン.json';

export interface ReceiptMeta {
  date: string | null; // YYYY-MM-DD
  invoiceNumber: string | null;
  companyName: string | null;
  totalAmount: number | null;
  paymentMethod: string | null;
  category: string | null; // 分類（勘定科目）。お店ごとに学習して自動入力する
  createdAt: string; // ISO
}

export interface ReceiptRecord extends ReceiptMeta {
  id: string; // 画像ファイルのドライブID
  imageName: string;
}

/** ドライブ連携がない・切れている（再ログインで直る） */
export class DriveAuthError extends Error {}
/** 保存用フォルダが未作成、またはドライブで削除された */
export class DriveFolderMissingError extends Error {}

export function folderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}
export function fileUrl(fileId: string) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

// ---------------------------------------------------------------------------
// CSV（Excelで文字化けしないよう BOM 付き UTF-8）

const CSV_HEADER = ['ID', '日付', '会社名', '登録番号', '金額', '支払い方法', '分類', '画像ファイル名', '画像リンク', '登録日時'];

function csvField(v: string | number | null) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(records: ReceiptRecord[]): string {
  const lines = [CSV_HEADER, ...records.map((r) => [
    r.id, r.date, r.companyName, r.invoiceNumber, r.totalAmount, r.paymentMethod, r.category, r.imageName, fileUrl(r.id), r.createdAt,
  ])];
  return '﻿' + lines.map((l) => l.map(csvField).join(',')).join('\r\n') + '\r\n';
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

export function fromCsv(text: string): ReceiptRecord[] {
  const [header, ...rows] = parseCsvRows(text);
  if (!header) return [];
  // 利用者がExcelで列を並べ替えても読めるよう、見出し名で列を探す
  const col = (name: string) => header.indexOf(name);
  const get = (r: string[], name: string) => {
    const i = col(name);
    return i >= 0 && r[i] !== undefined && r[i] !== '' ? r[i] : null;
  };
  return rows.flatMap((r) => {
    const id = get(r, 'ID');
    if (!id) return [];
    const amount = get(r, '金額');
    const n = amount === null ? null : Number(amount.replace(/[,円¥\s]/g, ''));
    return [{
      id,
      date: get(r, '日付'),
      companyName: get(r, '会社名'),
      invoiceNumber: get(r, '登録番号'),
      totalAmount: n === null || isNaN(n) ? null : n,
      paymentMethod: get(r, '支払い方法'),
      category: get(r, '分類'),
      imageName: get(r, '画像ファイル名') ?? '',
      createdAt: get(r, '登録日時') ?? '',
    }];
  });
}

// ---------------------------------------------------------------------------
// ドライブ操作（本物の Google Drive API と、テスト用の擬似ドライブ）

interface RawFile {
  id: string;
  name: string;
  description?: string;
  parents?: string[];
  trashed?: boolean;
  appProperties?: Record<string, string>;
}

interface Backend {
  createFolder(name: string): Promise<{ id: string; name: string }>;
  getFile(id: string): Promise<RawFile | null>;
  /** フォルダ内の、appProperties.kind が一致するファイル */
  listByKind(folderId: string, kind: string): Promise<RawFile[]>;
  create(folderId: string, name: string, mimeType: string, description: string, kind: string, data: Buffer): Promise<string>;
  updateMedia(id: string, mimeType: string, data: Buffer): Promise<void>;
  updateMeta(id: string, name: string, description: string): Promise<void>;
  trash(id: string): Promise<void>;
  download(id: string): Promise<Buffer | null>;
}

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessTokenFor(userId: string, encryptedRefreshToken: string | null): Promise<string> {
  const cached = accessTokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const refreshToken = encryptedRefreshToken ? decryptSecret(encryptedRefreshToken) : null;
  if (!refreshToken) throw new DriveAuthError('Googleドライブと連携されていません。');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    // invalid_grant = 利用者が連携を解除した／トークン失効。保存済みトークンを消して再連携してもらう
    if (data?.error === 'invalid_grant') {
      await prisma.user.update({ where: { id: userId }, data: { googleRefreshToken: null } });
      throw new DriveAuthError('Googleドライブとの連携が切れました。');
    }
    throw new Error(`Google token refresh failed: ${res.status} ${JSON.stringify(data)}`);
  }
  accessTokenCache.set(userId, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

function multipart(metadata: object, mimeType: string, data: Buffer) {
  const boundary = `receipt-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

function googleBackend(userId: string, encryptedRefreshToken: string | null): Backend {
  const api = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const token = await accessTokenFor(userId, encryptedRefreshToken);
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      accessTokenCache.delete(userId);
      throw new DriveAuthError('Googleドライブの認証が切れました。');
    }
    return res;
  };
  const fail = async (res: Response, what: string): Promise<never> => {
    const body = await res.text();
    if (res.status === 403 && body.includes('accessNotConfigured')) {
      throw new Error('Google Cloud で Google Drive API が有効になっていません。');
    }
    throw new Error(`Drive ${what} failed: ${res.status} ${body}`);
  };
  const FILES = 'https://www.googleapis.com/drive/v3/files';
  const FIELDS = 'id,name,description,parents,trashed,appProperties';

  return {
    async createFolder(name) {
      const res = await api(`${FILES}?fields=id,name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, appProperties: { app: APP_TAG, kind: 'folder' } }),
      });
      if (!res.ok) await fail(res, 'create folder');
      return res.json();
    },
    async getFile(id) {
      const res = await api(`${FILES}/${encodeURIComponent(id)}?fields=${FIELDS}`);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, 'get');
      return res.json();
    },
    async listByKind(folderId, kind) {
      const files: RawFile[] = [];
      let pageToken: string | undefined;
      do {
        const url = new URL(FILES);
        url.searchParams.set('q', `'${folderId}' in parents and trashed = false and appProperties has { key='kind' and value='${kind}' }`);
        url.searchParams.set('fields', `nextPageToken,files(${FIELDS})`);
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const res = await api(url.toString());
        if (!res.ok) await fail(res, 'list');
        const data = await res.json();
        files.push(...data.files);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return files;
    },
    async create(folderId, name, mimeType, description, kind, data) {
      const { body, contentType } = multipart(
        { name, description, parents: [folderId], mimeType, appProperties: { app: APP_TAG, kind } },
        mimeType,
        data,
      );
      const res = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(body),
      });
      if (!res.ok) await fail(res, 'upload');
      return (await res.json()).id;
    },
    async updateMedia(id, mimeType, data) {
      const res = await api(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': mimeType },
        body: new Uint8Array(data),
      });
      if (!res.ok) await fail(res, 'update media');
    },
    async updateMeta(id, name, description) {
      const res = await api(`${FILES}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) await fail(res, 'update');
    },
    async trash(id) {
      // 完全削除ではなくゴミ箱へ（ドライブ側で30日間は戻せる）
      const res = await api(`${FILES}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
      if (!res.ok) await fail(res, 'trash');
    },
    async download(id) {
      const res = await api(`${FILES}/${encodeURIComponent(id)}?alt=media`);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, 'download');
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

// テスト用の擬似ドライブ（DRIVE_FAKE_DIR 指定時、Vercel 以外でのみ）。
// 利用者ごとのディレクトリにファイルとメタ情報を置き、本物と同じ振る舞いを再現する
function fakeBackend(userId: string, encryptedRefreshToken: string | null): Backend {
  const root = path.join(process.env.DRIVE_FAKE_DIR!, userId);
  type FakeFile = RawFile & { mimeType: string };
  const metaPath = (id: string) => path.join(root, `${id}.json`);
  const read = async (id: string): Promise<FakeFile | null> => {
    if (!/^[\w-]+$/.test(id)) return null;
    return fs.readFile(metaPath(id), 'utf8').then(JSON.parse, () => null);
  };
  const write = async (f: FakeFile) => {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(metaPath(f.id), JSON.stringify(f));
  };
  const auth = () => {
    if (!encryptedRefreshToken || !decryptSecret(encryptedRefreshToken)) {
      throw new DriveAuthError('Googleドライブと連携されていません。');
    }
  };
  const newId = () => randomUUID().replace(/-/g, '');

  return {
    async createFolder(name) {
      auth();
      const id = newId();
      await write({ id, name, mimeType: FOLDER_MIME, trashed: false, appProperties: { app: APP_TAG, kind: 'folder' } });
      return { id, name };
    },
    async getFile(id) { auth(); return read(id); },
    async listByKind(folderId, kind) {
      auth();
      const names = await fs.readdir(root).catch(() => [] as string[]);
      const all = await Promise.all(names.filter((n) => n.endsWith('.json')).map((n) => read(n.slice(0, -5))));
      return all.filter((f): f is FakeFile => !!f && !f.trashed && !!f.parents?.includes(folderId) && f.appProperties?.kind === kind);
    },
    async create(folderId, name, mimeType, description, kind, data) {
      auth();
      const id = newId();
      await write({ id, name, mimeType, description, parents: [folderId], trashed: false, appProperties: { app: APP_TAG, kind } });
      await fs.writeFile(path.join(root, `${id}.bin`), data);
      return id;
    },
    async updateMedia(id, _mimeType, data) {
      auth();
      if (await read(id)) await fs.writeFile(path.join(root, `${id}.bin`), data);
    },
    async updateMeta(id, name, description) {
      auth();
      const f = await read(id);
      if (f) await write({ ...f, name, description });
    },
    async trash(id) {
      auth();
      const f = await read(id);
      if (f) await write({ ...f, trashed: true });
    },
    async download(id) {
      auth();
      const f = await read(id);
      if (!f || f.trashed) return null;
      return fs.readFile(path.join(root, `${id}.bin`)).catch(() => null);
    },
  };
}

// ---------------------------------------------------------------------------

// 画像の説明欄には、CSVと同じ内容に加えて、お店の学習に使う手がかり（見た目の指紋など）も持たせる
function describe(meta: ReceiptMeta, signals: ReceiptSignals | null) {
  return JSON.stringify({ app: APP_TAG, receipt: meta, signals });
}

function parseDescription(f: RawFile): { meta: ReceiptMeta; signals: ReceiptSignals | null } | null {
  try {
    const m = JSON.parse(f.description ?? '');
    if (m?.app !== APP_TAG || !m.receipt) return null;
    return { meta: { category: null, ...m.receipt }, signals: sanitizeSignals(m.signals) };
  } catch {
    return null;
  }
}

function metaFromDescription(f: RawFile): ReceiptMeta | null {
  return parseDescription(f)?.meta ?? null;
}

function learnInput(record: ReceiptRecord, signals: ReceiptSignals | null): LearnInput {
  return {
    receiptId: record.id,
    companyName: record.companyName,
    invoiceNumber: record.invoiceNumber,
    paymentMethod: record.paymentMethod,
    category: record.category,
    usedAt: record.createdAt,
    signals,
  };
}

/** ドライブ上の画像ファイル名。ドライブを直接開いたときに中身が分かる名前にする */
function imageName(meta: ReceiptMeta) {
  const date = meta.date ?? '日付なし';
  const company = (meta.companyName || '会社名なし').replace(/[\\/:*?"<>|]/g, '_');
  const amount = meta.totalAmount != null ? `${meta.totalAmount}円` : '金額なし';
  return `${date}_${company}_${amount}.jpg`;
}

function sortRecords(records: ReceiptRecord[]) {
  return [...records].sort((a, b) =>
    (b.date ?? '').localeCompare(a.date ?? '') || b.createdAt.localeCompare(a.createdAt));
}

export async function driveForUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const useFake = Boolean(process.env.DRIVE_FAKE_DIR) && !process.env.VERCEL;
  const backend = useFake ? fakeBackend(userId, user.googleRefreshToken) : googleBackend(userId, user.googleRefreshToken);
  const connected = Boolean(user.googleRefreshToken);

  async function requireFolder(): Promise<string> {
    if (!connected) throw new DriveAuthError('Googleドライブと連携されていません。');
    if (!user.driveFolderId) throw new DriveFolderMissingError('保存用フォルダがまだありません。');
    const folder = await backend.getFile(user.driveFolderId);
    if (!folder || folder.trashed) throw new DriveFolderMissingError('保存用フォルダがドライブで削除されています。');
    return user.driveFolderId;
  }

  /** 一覧CSVを探す。無ければ（削除された場合も）画像の説明欄から作り直す */
  async function loadLedger(folderId: string): Promise<{ id: string; records: ReceiptRecord[] }> {
    const [ledger] = await backend.listByKind(folderId, 'ledger');
    if (ledger) {
      const data = await backend.download(ledger.id);
      return { id: ledger.id, records: fromCsv(data ? data.toString('utf8') : '') };
    }
    const images = await backend.listByKind(folderId, 'receipt');
    const records = images.flatMap((f) => {
      const meta = metaFromDescription(f);
      return meta ? [{ ...meta, id: f.id, imageName: f.name }] : [];
    });
    const id = await backend.create(folderId, LEDGER_NAME, 'text/csv', '', 'ledger', Buffer.from(toCsv(sortRecords(records)), 'utf8'));
    return { id, records };
  }

  async function saveLedger(ledgerId: string, records: ReceiptRecord[]) {
    await backend.updateMedia(ledgerId, 'text/csv', Buffer.from(toCsv(sortRecords(records)), 'utf8'));
  }

  /**
   * 一覧CSVの読み→書きを、利用者ごとに1つずつ順番に行う（同時に2件保存しても行が消えないように）。
   * PostgreSQL のトランザクション内アドバイザリロックを使う
   */
  async function withLedgerLock<T>(fn: () => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ledger:${userId}`}))`;
      return fn();
    }, { timeout: 60_000, maxWait: 60_000 });
  }

  /**
   * お店の学習ファイル（店舗パターン.json）を読む。
   * 無い・壊れている場合は、ドライブに残っている領収書（CSVの記録と画像の説明欄の手がかり）から学習し直す
   */
  async function loadPatterns(folderId: string): Promise<PatternsFile> {
    const [file] = await backend.listByKind(folderId, 'patterns');
    if (file) {
      const data = await backend.download(file.id);
      const parsed = parsePatterns(data ? data.toString('utf8') : null);
      if (parsed) return parsed;
    }
    const { records } = await loadLedger(folderId);
    const images = await backend.listByKind(folderId, 'receipt');
    const signalsById = new Map(images.map((f) => [f.id, parseDescription(f)?.signals ?? null]));
    return [...records]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .reduce((p, r) => learn(p, learnInput(r, signalsById.get(r.id) ?? null)), emptyPatterns());
  }

  async function savePatterns(folderId: string, patterns: PatternsFile) {
    const data = Buffer.from(JSON.stringify(patterns, null, 1), 'utf8');
    const [file] = await backend.listByKind(folderId, 'patterns');
    if (file) await backend.updateMedia(file.id, 'application/json', data);
    else await backend.create(folderId, PATTERNS_NAME, 'application/json', '', 'patterns', data);
  }

  /** 学習の更新。失敗しても領収書の保存自体は成功させる（記録が正、学習は作り直せる） */
  async function updatePatterns(folderId: string, fn: (p: PatternsFile) => PatternsFile) {
    try {
      await savePatterns(folderId, fn(await loadPatterns(folderId)));
    } catch (e) {
      console.error('Failed to update store patterns:', e);
    }
  }

  async function findOwn(fileId: string) {
    const folderId = await requireFolder();
    const { id: ledgerId, records } = await loadLedger(folderId);
    const record = records.find((r) => r.id === fileId) ?? null;
    return { ledgerId, records, record };
  }

  return {
    connected,
    folder: user.driveFolderId ? { id: user.driveFolderId, name: user.driveFolderName ?? '', url: folderUrl(user.driveFolderId) } : null,

    /** 新しい保存用フォルダを作り、利用者に紐づける（空の一覧CSVも作る） */
    async createFolder(name: string) {
      if (!connected) throw new DriveAuthError('Googleドライブと連携されていません。');
      const folder = await backend.createFolder(name);
      await backend.create(folder.id, LEDGER_NAME, 'text/csv', '', 'ledger', Buffer.from(toCsv([]), 'utf8'));
      await prisma.user.update({ where: { id: userId }, data: { driveFolderId: folder.id, driveFolderName: folder.name } });
      return { id: folder.id, name: folder.name, url: folderUrl(folder.id) };
    },

    /** フォルダがドライブ上に実在するか */
    async folderExists() {
      try {
        await requireFolder();
        return true;
      } catch (e) {
        if (e instanceof DriveFolderMissingError) return false;
        throw e;
      }
    },

    /** 一覧CSVへのリンク */
    async ledgerUrl() {
      const folderId = await requireFolder();
      const { id } = await loadLedger(folderId);
      return fileUrl(id);
    },

    async listReceipts(): Promise<ReceiptRecord[]> {
      const folderId = await requireFolder();
      return sortRecords((await loadLedger(folderId)).records);
    },

    async ledgerCsv(): Promise<string> {
      const folderId = await requireFolder();
      return toCsv(sortRecords((await loadLedger(folderId)).records));
    },

    /**
     * 画像を保存して一覧CSVに1行追加する。
     * canAdd は一覧を読んだ後・書く前に呼ぶ（5件制限の判定をロックの中で行うため）
     */
    async addReceipt(meta: ReceiptMeta, image: Buffer, canAdd: (count: number) => boolean, signals: ReceiptSignals | null = null): Promise<ReceiptRecord | null> {
      const folderId = await requireFolder();
      return withLedgerLock(async () => {
        const { id: ledgerId, records } = await loadLedger(folderId);
        if (!canAdd(records.length)) return null;
        const name = imageName(meta);
        const id = await backend.create(folderId, name, 'image/jpeg', describe(meta, signals), 'receipt', image);
        const record = { ...meta, id, imageName: name };
        await saveLedger(ledgerId, [...records, record]);
        await updatePatterns(folderId, (p) => learn(p, learnInput(record, signals)));
        return record;
      });
    },

    async updateReceipt(fileId: string, patch: Omit<ReceiptMeta, 'createdAt'>): Promise<ReceiptRecord | null> {
      const folderId = await requireFolder();
      return withLedgerLock(async () => {
        const { ledgerId, records, record } = await findOwn(fileId);
        if (!record) return null;
        const updated = { ...record, ...patch };
        const { id: _id, imageName: _name, ...meta } = updated;
        updated.imageName = imageName(meta);
        const image = await backend.getFile(fileId);
        const signals = image ? parseDescription(image)?.signals ?? null : null;
        await backend.updateMeta(fileId, updated.imageName, describe(meta, signals));
        await saveLedger(ledgerId, records.map((r) => (r.id === fileId ? updated : r)));
        // 店名などを直した場合は、古いお店から学習を外して、正しいお店として学び直す
        await updatePatterns(folderId, (p) => learn(forget(p, fileId, record), learnInput(updated, signals)));
        return updated;
      });
    },

    async trashReceipt(fileId: string): Promise<boolean> {
      const folderId = await requireFolder();
      return withLedgerLock(async () => {
        const { ledgerId, records, record } = await findOwn(fileId);
        if (!record) return false;
        await saveLedger(ledgerId, records.filter((r) => r.id !== fileId));
        await backend.trash(fileId);
        await updatePatterns(folderId, (p) => forget(p, fileId, record));
        return true;
      });
    },

    /** 新しいレシートの手がかりから、学習済みのお店を一致度の高い順に返す */
    async matchStores(signals: ReceiptSignals, ocrInvoiceNumber: string | null) {
      const folderId = await requireFolder();
      return matchStores(await loadPatterns(folderId), signals, ocrInvoiceNumber);
    },

    /** よく使うお店 */
    async frequentStores() {
      const folderId = await requireFolder();
      return frequentStores(await loadPatterns(folderId));
    },

    /** 一覧CSVに載っている本人の領収書の画像だけを返す */
    async downloadReceipt(fileId: string): Promise<Buffer | null> {
      const { record } = await findOwn(fileId);
      if (!record) return null;
      return backend.download(fileId);
    },
  };
}
