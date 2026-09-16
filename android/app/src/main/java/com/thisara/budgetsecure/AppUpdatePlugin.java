package com.thisara.budgetsecure;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "AppUpdatePlugin")
public class AppUpdatePlugin extends Plugin {
    private static final String TAG = "AppUpdatePlugin";
    private static final String APK_FILE_NAME = "budget-secure-update.apk";

    private DownloadManager downloadManager;
    private long activeDownloadId = -1;
    private ScheduledExecutorService progressExecutor;
    private ScheduledFuture<?> progressFuture;

    @Override
    public void load() {
        super.load();
        downloadManager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        cleanupOldApks();
    }

    private void cleanupOldApks() {
        try {
            File downloadDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (downloadDir != null && downloadDir.exists()) {
                File[] files = downloadDir.listFiles();
                if (files != null) {
                    for (File file : files) {
                        if (file.getName().endsWith(".apk")) {
                            boolean deleted = file.delete();
                            Log.d(TAG, "Cleanup old APK: " + file.getName() + " -> deleted: " + deleted);
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error cleaning up old APK files", e);
        }
    }

    @PluginMethod
    public void startDownload(PluginCall call) {
        String url = call.getString("url");
        String version = call.getString("version", "");

        if (url == null || url.trim().isEmpty()) {
            call.reject("Download URL is required");
            return;
        }

        cleanupOldApks();
        stopProgressTracking();

        try {
            Uri downloadUri = Uri.parse(url);
            DownloadManager.Request request = new DownloadManager.Request(downloadUri);
            request.setTitle("Budget Secure Update");
            request.setDescription(version.isEmpty() ? "Downloading update..." : "Downloading v" + version + "...");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            request.setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI | DownloadManager.Request.NETWORK_MOBILE);
            request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, APK_FILE_NAME);

            activeDownloadId = downloadManager.enqueue(request);

            JSObject ret = new JSObject();
            ret.put("downloadId", activeDownloadId);
            ret.put("status", "enqueued");
            call.resolve(ret);

            startProgressTracking();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start download", e);
            call.reject("Failed to enqueue download: " + e.getMessage());
        }
    }

    private void startProgressTracking() {
        if (progressExecutor == null || progressExecutor.isShutdown()) {
            progressExecutor = Executors.newSingleThreadScheduledExecutor();
        }

        progressFuture = progressExecutor.scheduleAtFixedRate(() -> {
            if (activeDownloadId == -1) return;

            DownloadManager.Query query = new DownloadManager.Query();
            query.setFilterById(activeDownloadId);

            Cursor cursor = null;
            try {
                cursor = downloadManager.query(query);
                if (cursor != null && cursor.moveToFirst()) {
                    int statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                    int totalBytesIdx = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
                    int downloadedBytesIdx = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
                    int reasonIdx = cursor.getColumnIndex(DownloadManager.COLUMN_REASON);

                    int status = cursor.getInt(statusIdx);
                    long totalBytes = cursor.getLong(totalBytesIdx);
                    long downloadedBytes = cursor.getLong(downloadedBytesIdx);
                    int reason = cursor.getInt(reasonIdx);

                    if (status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PAUSED) {
                        float progress = (totalBytes > 0) ? ((float) downloadedBytes / totalBytes) * 100f : 0f;
                        JSObject data = new JSObject();
                        data.put("status", "downloading");
                        data.put("progress", Math.round(progress));
                        data.put("bytesDownloaded", downloadedBytes);
                        data.put("totalBytes", totalBytes);
                        notifyListeners("downloadProgress", data);
                    } else if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        stopProgressTracking();
                        JSObject data = new JSObject();
                        data.put("status", "downloaded");
                        data.put("progress", 100);
                        data.put("bytesDownloaded", totalBytes);
                        data.put("totalBytes", totalBytes);
                        notifyListeners("downloadProgress", data);
                    } else if (status == DownloadManager.STATUS_FAILED) {
                        stopProgressTracking();
                        String errorReason = getReadableReason(reason);
                        JSObject data = new JSObject();
                        data.put("status", "failed");
                        data.put("error", errorReason);
                        notifyListeners("downloadProgress", data);
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Error querying download progress", e);
            } finally {
                if (cursor != null) {
                    cursor.close();
                }
            }
        }, 0, 500, TimeUnit.MILLISECONDS);
    }

    private void stopProgressTracking() {
        if (progressFuture != null && !progressFuture.isDone()) {
            progressFuture.cancel(true);
        }
    }

    private String getReadableReason(int reason) {
        switch (reason) {
            case DownloadManager.ERROR_CANNOT_RESUME: return "Cannot resume download";
            case DownloadManager.ERROR_DEVICE_NOT_FOUND: return "External storage device not found";
            case DownloadManager.ERROR_FILE_ALREADY_EXISTS: return "Destination file already exists";
            case DownloadManager.ERROR_FILE_ERROR: return "Storage file error";
            case DownloadManager.ERROR_HTTP_DATA_ERROR: return "HTTP data transfer error";
            case DownloadManager.ERROR_INSUFFICIENT_SPACE: return "Insufficient device storage space";
            case DownloadManager.ERROR_TOO_MANY_REDIRECTS: return "Too many redirects";
            case DownloadManager.ERROR_UNHANDLED_HTTP_CODE: return "Unhandled HTTP error";
            default: return "Download failed (code " + reason + ")";
        }
    }

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        boolean canInstall = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            canInstall = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("canInstall", canInstall);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Failed to open unknown app sources settings", e);
                call.reject("Could not open settings: " + e.getMessage());
            }
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        Context context = getContext();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.getPackageManager().canRequestPackageInstalls()) {
                JSObject ret = new JSObject();
                ret.put("requiresPermission", true);
                call.resolve(ret);
                return;
            }
        }

        File downloadDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File apkFile = new File(downloadDir, APK_FILE_NAME);

        if (!apkFile.exists() || apkFile.length() == 0) {
            call.reject("Downloaded update APK does not exist or is empty");
            return;
        }

        try {
            Uri apkUri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                apkFile
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            context.startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("launched", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch package installer", e);
            call.reject("Failed to open installer: " + e.getMessage());
        }
    }
}
