import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

interface ExportFileOptions {
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
 * Clean up old export files matching the given pattern from Directory.Documents
 */
async function cleanupOldExports(pattern: RegExp): Promise<void> {
  try {
    const dirResult = await Filesystem.readdir({
      directory: Directory.Documents,
      path: '',
    });

    if (!dirResult || !dirResult.files) return;

    for (const file of dirResult.files) {
      if (file && file.name && pattern.test(file.name)) {
        try {
          await Filesystem.deleteFile({
            directory: Directory.Documents,
            path: file.name,
          });
          console.log(`[Export] Cleaned up previous export: ${file.name}`);
        } catch (delErr) {
          console.warn(`[Export] Failed to delete previous export ${file.name}:`, delErr);
        }
      }
    }
  } catch (err) {
    // Directory might be empty or uninitialized, which is safe to ignore
    console.debug('[Export] Cleanup check completed or skipped:', err);
  }
}

/**
 * Universal file export handler:
 * - On Native Android: cleans up old exports, writes to Directory.Documents as base64, and opens native Share sheet
 * - On Web / Electron: triggers standard browser blob download via <a> element
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

    // Write file to Directory.Documents
    const writeResult = await Filesystem.writeFile({
      path: filename,
      data: cleanBase64,
      directory: Directory.Documents,
      recursive: true,
    });

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
        throw shareErr;
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
