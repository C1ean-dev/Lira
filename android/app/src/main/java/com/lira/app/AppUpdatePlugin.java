package com.lira.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppUpdatePlugin")
public class AppUpdatePlugin extends Plugin {
    private static final String TAG = "AppUpdatePlugin";
    private static final String APK_FILE_NAME = "Lira-update.apk";

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();
        boolean canInstall = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && context != null) {
            canInstall = context.getPackageManager().canRequestPackageInstalls();
        }
        ret.put("canInstall", canInstall);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && context != null) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        }
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        String downloadUrl = call.getString("downloadUrl");
        if (downloadUrl == null || downloadUrl.trim().isEmpty()) {
            call.reject("URL de download inválida ou ausente.");
            return;
        }

        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível.");
            return;
        }

        // Executar download em thread separada
        new Thread(() -> {
            try {
                File dir = context.getExternalCacheDir() != null ? context.getExternalCacheDir() : context.getCacheDir();
                File apkFile = new File(dir, APK_FILE_NAME);
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                URL url = new URL(downloadUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("User-Agent", "Lira-Android-App");

                int responseCode = conn.getResponseCode();
                // Seguir redirecionamentos comuns do GitHub para AWS S3
                if (responseCode == HttpURLConnection.HTTP_MOVED_TEMP ||
                    responseCode == HttpURLConnection.HTTP_MOVED_PERM ||
                    responseCode == 307 || responseCode == 308) {
                    String redirectUrl = conn.getHeaderField("Location");
                    if (redirectUrl != null) {
                        conn.disconnect();
                        url = new URL(redirectUrl);
                        conn = (HttpURLConnection) url.openConnection();
                        conn.setInstanceFollowRedirects(true);
                        conn.setConnectTimeout(15000);
                        conn.setReadTimeout(30000);
                        conn.setRequestProperty("User-Agent", "Lira-Android-App");
                        responseCode = conn.getResponseCode();
                    }
                }

                if (responseCode != HttpURLConnection.HTTP_OK) {
                    throw new Exception("Falha no servidor: código HTTP " + responseCode);
                }

                long fileLength = conn.getContentLengthLong();
                InputStream input = conn.getInputStream();
                FileOutputStream output = new FileOutputStream(apkFile);

                byte[] buffer = new byte[8192];
                long totalDownloaded = 0;
                int count;
                long lastProgressTime = 0;

                while ((count = input.read(buffer)) != -1) {
                    totalDownloaded += count;
                    output.write(buffer, 0, count);

                    long now = System.currentTimeMillis();
                    if (now - lastProgressTime > 80 || totalDownloaded == fileLength) {
                        lastProgressTime = now;
                        int percent = fileLength > 0 ? (int) ((totalDownloaded * 100) / fileLength) : 0;

                        JSObject progressObj = new JSObject();
                        progressObj.put("percent", percent);
                        progressObj.put("downloaded", totalDownloaded);
                        progressObj.put("total", fileLength);
                        notifyListeners("onUpdateProgress", progressObj);
                    }
                }

                output.flush();
                output.close();
                input.close();
                conn.disconnect();

                Log.d(TAG, "Download do APK concluído com sucesso: " + apkFile.getAbsolutePath());

                // Disparar instalador nativo na UI thread
                getActivity().runOnUiThread(() -> {
                    boolean triggered = triggerApkInstallation(context, apkFile);
                    JSObject ret = new JSObject();
                    ret.put("success", triggered);
                    ret.put("path", apkFile.getAbsolutePath());
                    call.resolve(ret);
                });

            } catch (Exception e) {
                Log.e(TAG, "Erro ao baixar ou instalar APK", e);
                call.reject("Falha no download da atualização: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto indisponível.");
            return;
        }

        File dir = context.getExternalCacheDir() != null ? context.getExternalCacheDir() : context.getCacheDir();
        File apkFile = new File(dir, APK_FILE_NAME);
        if (!apkFile.exists() || apkFile.length() == 0) {
            call.reject("Arquivo APK não encontrado em cache.");
            return;
        }

        boolean success = triggerApkInstallation(context, apkFile);
        JSObject ret = new JSObject();
        ret.put("success", success);
        call.resolve(ret);
    }

    private boolean triggerApkInstallation(Context context, File apkFile) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!context.getPackageManager().canRequestPackageInstalls()) {
                    Log.w(TAG, "Permissão REQUEST_INSTALL_PACKAGES necessária. Abrindo configurações.");
                    Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    settingsIntent.setData(Uri.parse("package:" + context.getPackageName()));
                    settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(settingsIntent);
                    // Não encerra aqui, prossegue para tentar acionar o intent assim que o usuário retornar
                }
            }

            Uri apkUri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                apkFile
            );

            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            context.startActivity(installIntent);
            Log.d(TAG, "Intent do instalador de pacotes disparado com sucesso!");
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Erro ao disparar instalador de pacotes", e);
            return false;
        }
    }
}
