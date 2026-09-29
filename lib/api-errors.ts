import { NextResponse } from 'next/server';
import { UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { DriveAuthError, DriveFolderMissingError } from '@/lib/drive';

/** APIルート共通のエラー応答。画面側は code を見て「ドライブ連携」「フォルダ作成」へ案内する */
export function errorResponse(error: unknown, context: string) {
  if (error instanceof UnauthorizedError) return unauthorizedResponse();
  if (error instanceof DriveAuthError) {
    return NextResponse.json(
      { error: 'Googleドライブとの連携が必要です。設定画面から「Googleドライブと連携する」を押してください。', code: 'DRIVE_AUTH' },
      { status: 409 }
    );
  }
  if (error instanceof DriveFolderMissingError) {
    return NextResponse.json(
      { error: '領収書を保存するフォルダがありません。設定画面からフォルダを作成してください。', code: 'DRIVE_FOLDER_MISSING' },
      { status: 409 }
    );
  }
  console.error(`${context}:`, error);
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
}
