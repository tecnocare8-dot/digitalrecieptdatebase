import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { driveForUser } from '@/lib/drive';
import { errorResponse } from '@/lib/api-errors';

export const dynamic = 'force-dynamic';

const DEFAULT_FOLDER_NAME = '領収書（デジタル経費記録）';

/**
 * 本人のGoogleドライブに、領収書を保存するフォルダを作る（ドライブを使ったことがない人でもボタン1つで作れるように）。
 * 既にフォルダがあってドライブ上に残っている場合は、作り直さずにそのフォルダを返す。
 * 削除されていた場合、または { replace: true } の場合は新しく作る
 */
export async function POST(request: NextRequest) {
  try {
    const { ownerId: userId } = await requireOwner();
    const body = await request.json().catch(() => ({}));
    const rawName = typeof body.name === 'string' ? body.name.trim() : '';
    const name = (rawName || DEFAULT_FOLDER_NAME).slice(0, 100);

    const drive = await driveForUser(userId);
    if (drive.folder && !body.replace && (await drive.folderExists())) {
      return NextResponse.json({ folder: drive.folder, created: false });
    }

    const folder = await drive.createFolder(name);
    return NextResponse.json({ folder, created: true });
  } catch (error) {
    return errorResponse(error, 'Error creating Drive folder');
  }
}
