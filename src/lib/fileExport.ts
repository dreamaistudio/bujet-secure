import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface ExportFileOptions {
  filename: string;
  blob: Blob;
  base64Data: string;
  cleanupPattern?: RegExp;
}

/**
 * Utility to convert string to UTF-8 base64 without deprecated unescape
 */
export function stringToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Clear out the app's own leftover export files.
 *
 * Only the cache is swept. This used to clear the phone's Documents folder as
 * well, which is not the app's to tidy: a statement saved there is something
 * the user chose to keep, and a file of their own that happened to match the
 * pattern — a "transactions_2024.csv" downloaded from a bank, say — would have
 * been deleted without a word. The cache is scratch space and safe to clear;
 * Documents belongs to the user, and is now left alone.
 */
async function cleanupOldExports(pattern: RegExp): Promise<void> {
  const targetDirs = [Directory.Cache];

  for (const dir of targetDirs) {
    try {
      const dirResult = await Filesystem.readdir({
        directory: dir,
        path: '',
      });

      if (!dirResult || !dirResult.files) continue;

      for (const file of dirResult.files) {
        if (file && file.name && pattern.test(file.name)) {
          try {
            await Filesystem.deleteFile({
              directory: dir,
              path: file.name,
            });
            console.log(`[Export] Cleaned up previous export: ${file.name}`);
          } catch (delErr) {
            console.warn(`[Export] Failed to delete previous export ${file.name}:`, delErr);
          }
        }
      }
    } catch (err) {
      // Directory may be empty or uninitialized, which is safe to ignore
      console.debug('[Export] Cleanup check completed or skipped:', err);
    }
  }
}

/**
 * Universal platform-aware file export handler:
 * - On Native Android (Capacitor):
 *   1. Cleans up old exports matching pattern
 *   2. Writes file via Filesystem.writeFile() to Directory.Documents (fallback to Directory.Cache)
 *   3. Triggers native Android Share sheet via Share.share() with the file URI
 * - On Web / Electron:
 *   Standard browser blob download via <a> element
 */
export async function exportFile({
  filename,
  blob,
  base64Data,
  cleanupPattern,
}: ExportFileOptions): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    // Check & request permissions if necessary
    try {
      const status = await Filesystem.checkPermissions();
      if (status.publicStorage !== 'granted') {
        await Filesystem.requestPermissions();
      }
    } catch (permErr) {
      console.warn('[Export] Permission check/request error (continuing):', permErr);
    }

    // Clean up previous export files matching the pattern
    if (cleanupPattern) {
      await cleanupOldExports(cleanupPattern);
    }

    // Strip any Data URL prefix if present (e.g. data:application/pdf;base64,)
    const cleanBase64 = base64Data.includes(',')
      ? base64Data.split(',')[1]
      : base64Data;

    // Write file to Directory.Documents with fallback to Directory.Cache
    let writeResult;
    try {
      writeResult = await Filesystem.writeFile({
        path: filename,
        data: cleanBase64,
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (docErr) {
      console.warn('[Export] Writing to Directory.Documents failed, falling back to Directory.Cache:', docErr);
      writeResult = await Filesystem.writeFile({
        path: filename,
        data: cleanBase64,
        directory: Directory.Cache,
        recursive: true,
      });
    }

    console.log(`[Export] File written successfully: ${writeResult.uri}`);

    // Open native Android Share sheet
    try {
      await Share.share({
        title: filename,
        text: `Exported statement: ${filename}`,
        url: writeResult.uri,
        files: [writeResult.uri],
        dialogTitle: 'Save or Share Statement',
      });
    } catch (shareErr: any) {
      // If user dismisses/cancels the share sheet, do not treat it as an error
      if (shareErr?.message && /cancel|dismiss/i.test(shareErr.message)) {
        console.log('[Export] Share sheet dismissed by user');
      } else {
        // Fallback: try sharing with files array only
        try {
          await Share.share({
            title: filename,
            files: [writeResult.uri],
            dialogTitle: 'Save or Share Statement',
          });
        } catch (retryErr: any) {
          if (retryErr?.message && /cancel|dismiss/i.test(retryErr.message)) {
            console.log('[Export] Share sheet dismissed by user on retry');
          } else {
            console.error('[Export] Native share failed:', retryErr);
            throw retryErr;
          }
        }
      }
    }
  } else {
    // Desktop Web / Electron fallback
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
