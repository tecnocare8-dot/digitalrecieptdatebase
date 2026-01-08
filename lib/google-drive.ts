import { google } from 'googleapis';
import fs from 'fs';

export async function uploadToDrive(file: File, filename: string, accessToken?: string, folderName: string = 'Receipt Scanner'): Promise<boolean> {
    if (!accessToken) {
        console.warn('⚠️ No access token provided. Skipping Google Drive upload (Local only).');
        return false;
    }

    try {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });

        const drive = google.drive({ version: 'v3', auth });

        // 1. Check or Create Folder
        const FOLDER_NAME = folderName; // Use user provided name
        let folderId = '';

        try {
            const q = `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`;
            const folderRes = await drive.files.list({
                q: q,
                fields: 'files(id, name)',
                spaces: 'drive',
            });

            if (folderRes.data.files && folderRes.data.files.length > 0) {
                folderId = folderRes.data.files[0].id!;
                console.log(`✅ Found existing folder: ${FOLDER_NAME} (${folderId})`);
            } else {
                const createRes = await drive.files.create({
                    requestBody: {
                        name: FOLDER_NAME,
                        mimeType: 'application/vnd.google-apps.folder',
                    },
                    fields: 'id',
                });
                folderId = createRes.data.id!;
                console.log(`✅ Created new folder: ${FOLDER_NAME} (${folderId})`);
            }
        } catch (folderError) {
            console.error('⚠️ Failed to check/create folder, uploading to root:', folderError);
        }

        // 2. Upload File
        const buffer = Buffer.from(await file.arrayBuffer());
        const { Readable } = await import('stream');
        const stream = Readable.from(buffer);

        await drive.files.create({
            requestBody: {
                name: filename,
                parents: folderId ? [folderId] : [], // Use folder if available
            },
            media: {
                mimeType: file.type || 'image/jpeg',
                body: stream,
            },
        });

        console.log(`✅ Uploaded to Google Drive (User): ${filename}`);
        return true;

    } catch (error) {
        console.error('❌ Failed to upload to Google Drive:', error);
        return false;
    }
}
