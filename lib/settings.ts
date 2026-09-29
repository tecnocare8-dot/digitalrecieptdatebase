import { prisma } from '@/lib/prisma';
import { DriveAuthError, DriveFolderMissingError, driveForUser } from '@/lib/drive';

export const MAX_FREE_RECEIPTS = 5;

export interface SubscriptionStatus {
  isPro: boolean;
  isExpired: boolean;
  proExpiresAt: string | null;
  receiptCount: number;
  maxFreeReceipts: number;
  canAddReceipt: boolean;
  reason?: string;
  drive: {
    connected: boolean;
    folder: { id: string; name: string; url: string } | null;
    folderExists: boolean;
    ledgerUrl: string | null;
  };
}

export function planStatus(proExpiresAt: Date | null) {
  const hasPurchased = proExpiresAt !== null;
  const isPro = hasPurchased && proExpiresAt! > new Date();
  return { isPro, isExpired: hasPurchased && !isPro };
}

/** 件数を踏まえて、新しい領収書を追加できるかと、できない理由 */
export function addPermission(proExpiresAt: Date | null, receiptCount: number) {
  const { isPro, isExpired } = planStatus(proExpiresAt);
  if (isExpired) {
    return { canAdd: false, reason: 'Proプランの有効期限（1年間）が切れています。過去の領収書データの閲覧・編集は可能ですが、新しい領収書を登録するにはProプランの再購入が必要です。' };
  }
  if (!isPro && receiptCount >= MAX_FREE_RECEIPTS) {
    return { canAdd: false, reason: `無料プランで登録できる領収書は${MAX_FREE_RECEIPTS}件までです。新しい領収書を登録するにはProプラン（1,500円/年）にアップグレードしてください。` };
  }
  return { canAdd: true, reason: '' };
}

// DBに接続できないときは例外をそのまま投げる（以前は「追加可」で返していたため、障害時に5件制限が外れていた）
export async function getSubscriptionStatus(userId: string): Promise<SubscriptionStatus> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const drive = await driveForUser(userId);

  // 件数は本人のドライブの一覧CSVが正。連携やフォルダがまだ無ければ0件
  let receiptCount = 0;
  let folderExists = false;
  let ledgerUrl: string | null = null;
  let driveNeedsAttention = false;
  let driveAuthFailed = false;
  if (drive.connected && drive.folder) {
    try {
      receiptCount = (await drive.listReceipts()).length;
      ledgerUrl = await drive.ledgerUrl();
      folderExists = true;
    } catch (e) {
      if (e instanceof DriveAuthError) driveAuthFailed = true;
      else if (!(e instanceof DriveFolderMissingError)) throw e;
      driveNeedsAttention = true;
    }
  }

  const { isPro, isExpired } = planStatus(user.proExpiresAt);
  const permission = addPermission(user.proExpiresAt, receiptCount);
  let { canAdd: canAddReceipt, reason } = permission;
  const connected = drive.connected && !driveAuthFailed;
  if (canAddReceipt && (!connected || !folderExists || driveNeedsAttention)) {
    canAddReceipt = false;
    reason = !connected
      ? 'Googleドライブと連携すると、領収書を保存できるようになります。'
      : '領収書を保存するGoogleドライブのフォルダを作成してください。';
  }

  return {
    isPro,
    isExpired,
    proExpiresAt: user.proExpiresAt ? user.proExpiresAt.toISOString() : null,
    receiptCount,
    maxFreeReceipts: MAX_FREE_RECEIPTS,
    canAddReceipt,
    reason,
    drive: {
      connected,
      folder: drive.folder,
      folderExists,
      ledgerUrl,
    },
  };
}
