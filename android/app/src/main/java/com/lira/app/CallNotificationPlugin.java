package com.lira.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "CallNotificationPlugin",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class CallNotificationPlugin extends Plugin {
    public static final String TAG = "CallNotificationPlugin";
    public static CallNotificationPlugin instance;
    public static final String CHANNEL_ID = "lira_call_channel_v2";
    public static final int NOTIFICATION_ID = 4099;
    private static final String PREFS_NAME = "lira_call_prefs";
    private static final String KEY_PENDING_LEAVE = "pending_leave_room";

    private String currentRoomName = "Sala";
    private boolean currentIsMuted = false;
    private boolean currentIsDeafened = false;
    private boolean isCallActive = false;
    private boolean isNotificationActive = false;
    private boolean isAppInBackground = false;

    @Override
    public void load() {
        super.load();
        instance = this;
        createNotificationChannel();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Context context = getContext();
            if (context == null) return;
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Lira Chamada em Segundo Plano",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Notificação de status da chamada e ações rápidas no Lira");
            channel.setShowBadge(true);
            channel.setSound(null, null); // Evita bips repetidos ao mutar/desmutar
            channel.enableVibration(false);

            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @PluginMethod
    public void checkNotificationPermission(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();
        if (context == null) {
            ret.put("granted", false);
            ret.put("notificationsEnabled", false);
            ret.put("needRuntimePermission", false);
            call.resolve(ret);
            return;
        }

        boolean enabled = NotificationManagerCompat.from(context).areNotificationsEnabled();
        boolean hasRuntimePerm = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            hasRuntimePerm = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }

        ret.put("granted", enabled && hasRuntimePerm);
        ret.put("notificationsEnabled", enabled);
        ret.put("needRuntimePermission", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !hasRuntimePerm);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            call.resolve(ret);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "Solicitando permissão POST_NOTIFICATIONS...");
                requestPermissionForAlias("notifications", call, "notificationPermCallback");
                return;
            }
        }

        boolean enabled = NotificationManagerCompat.from(context).areNotificationsEnabled();
        JSObject ret = new JSObject();
        ret.put("granted", enabled);
        call.resolve(ret);
    }

    @PermissionCallback
    private void notificationPermCallback(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();
        if (context != null) {
            boolean enabled = NotificationManagerCompat.from(context).areNotificationsEnabled();
            boolean hasRuntimePerm = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                hasRuntimePerm = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            }
            ret.put("granted", enabled && hasRuntimePerm);
        } else {
            ret.put("granted", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context context = getContext();
        if (context != null) {
            Intent intent = new Intent();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
            } else {
                intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.fromParts("package", context.getPackageName(), null));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        }
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkPendingAction(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            boolean pendingLeave = prefs.getBoolean(KEY_PENDING_LEAVE, false);
            if (pendingLeave) {
                prefs.edit().remove(KEY_PENDING_LEAVE).apply();
                ret.put("action", "leaveRoom");
                call.resolve(ret);
                return;
            }
        }
        ret.put("action", null);
        call.resolve(ret);
    }

    @PluginMethod
    public void setCallState(PluginCall call) {
        Boolean inRoom = call.getBoolean("inRoom");
        String roomName = call.getString("roomName");
        Boolean isMuted = call.getBoolean("isMuted");
        Boolean isDeafened = call.getBoolean("isDeafened");

        if (inRoom != null) {
            isCallActive = inRoom;
        }
        if (roomName != null && !roomName.trim().isEmpty()) {
            currentRoomName = roomName;
        }
        if (isMuted != null) {
            currentIsMuted = isMuted;
        }
        if (isDeafened != null) {
            currentIsDeafened = isDeafened;
        }

        if (!isCallActive) {
            clearNotificationInternal();
        } else if (isAppInBackground || isNotificationActive) {
            renderNotification();
        }

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void showCallNotification(PluginCall call) {
        String roomName = call.getString("roomName", currentRoomName);
        Boolean isMuted = call.getBoolean("isMuted", currentIsMuted);
        Boolean isDeafened = call.getBoolean("isDeafened", currentIsDeafened);

        if (roomName != null && !roomName.trim().isEmpty()) {
            currentRoomName = roomName;
        }
        if (isMuted != null) {
            currentIsMuted = isMuted;
        }
        if (isDeafened != null) {
            currentIsDeafened = isDeafened;
        }

        isCallActive = true;
        renderNotification();

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void updateCallState(PluginCall call) {
        String roomName = call.getString("roomName");
        Boolean isMuted = call.getBoolean("isMuted");
        Boolean isDeafened = call.getBoolean("isDeafened");

        if (roomName != null && !roomName.trim().isEmpty()) {
            currentRoomName = roomName;
        }
        if (isMuted != null) {
            currentIsMuted = isMuted;
        }
        if (isDeafened != null) {
            currentIsDeafened = isDeafened;
        }

        if (isNotificationActive) {
            renderNotification();
        }

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearCallNotification(PluginCall call) {
        clearNotificationInternal();
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    private void renderNotification() {
        Context context = getContext();
        if (context == null) return;

        // Se Android 13+, não chamar notify sem permissão para evitar falhas silenciosas
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "Notificações bloqueadas pelo usuário (falta permissão POST_NOTIFICATIONS).");
                return;
            }
        }

        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            Log.w(TAG, "Notificações desativadas para o aplicativo.");
            return;
        }

        createNotificationChannel();

        Intent openAppIntent = new Intent(context, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent openAppPendingIntent = PendingIntent.getActivity(context, 0, openAppIntent, pendingFlags);

        // Mute Action Intent
        Intent muteIntent = new Intent(context, CallActionReceiver.class);
        muteIntent.setAction(CallActionReceiver.ACTION_TOGGLE_MUTE);
        PendingIntent mutePendingIntent = PendingIntent.getBroadcast(context, 101, muteIntent, pendingFlags);

        // Deafen Action Intent
        Intent deafenIntent = new Intent(context, CallActionReceiver.class);
        deafenIntent.setAction(CallActionReceiver.ACTION_TOGGLE_DEAFEN);
        PendingIntent deafenPendingIntent = PendingIntent.getBroadcast(context, 102, deafenIntent, pendingFlags);

        // Leave Room Action Intent
        Intent leaveIntent = new Intent(context, CallActionReceiver.class);
        leaveIntent.setAction(CallActionReceiver.ACTION_LEAVE_ROOM);
        PendingIntent leavePendingIntent = PendingIntent.getBroadcast(context, 103, leaveIntent, pendingFlags);

        int iconRes = R.drawable.ic_launcher_foreground;
        if (iconRes == 0) {
            iconRes = context.getApplicationInfo().icon;
        }
        if (iconRes == 0) {
            iconRes = android.R.drawable.ic_menu_call;
        }

        String muteText = currentIsMuted ? "Desmutar" : "Mutar Mic";
        String deafenText = currentIsDeafened ? "Ouvir" : "Silenciar";
        String statusDetail = (currentIsMuted ? "🎤 Mutado" : "🎤 Microfone Ativo")
            + (currentIsDeafened ? " • 🔇 Silenciado" : " • 🔊 Ouvindo");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(iconRes)
            .setContentTitle("Lira • Em Chamada")
            .setContentText("Sala: " + currentRoomName + " (" + statusDetail + ")")
            .setSubText(currentRoomName)
            .setContentIntent(openAppPendingIntent)
            .setOngoing(true)
            .setAutoCancel(false)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, muteText, mutePendingIntent)
            .addAction(0, deafenText, deafenPendingIntent)
            .addAction(0, "Sair da Sala", leavePendingIntent);

        try {
            builder.setLargeIcon(BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher));
        } catch (Throwable ignored) {}

        try {
            NotificationManagerCompat manager = NotificationManagerCompat.from(context);
            manager.notify(NOTIFICATION_ID, builder.build());
            isNotificationActive = true;
            Log.d(TAG, "Notificação de chamada em background exibida com sucesso para a sala: " + currentRoomName);
        } catch (Exception e) {
            Log.e(TAG, "Erro ao exibir notificação", e);
        }
    }

    private void clearNotificationInternal() {
        Context context = getContext();
        if (context == null) return;
        try {
            NotificationManagerCompat manager = NotificationManagerCompat.from(context);
            manager.cancel(NOTIFICATION_ID);
        } catch (Exception ignored) {}
        isNotificationActive = false;
    }

    public void handleNotificationAction(String action) {
        if ("leaveRoom".equals(action)) {
            isCallActive = false;
            clearNotificationInternal();
            Context context = getContext();
            if (context != null) {
                context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_PENDING_LEAVE, true)
                    .apply();
            }
        } else if ("toggleMute".equals(action)) {
            currentIsMuted = !currentIsMuted;
            if (isNotificationActive) renderNotification();
        } else if ("toggleDeafen".equals(action)) {
            currentIsDeafened = !currentIsDeafened;
            if (isNotificationActive) renderNotification();
        }

        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("onNotificationAction", data);
    }

    public void onActivityPaused() {
        isAppInBackground = true;
        if (isCallActive) {
            renderNotification();
        }
    }

    public void onActivityResumed() {
        isAppInBackground = false;
        clearNotificationInternal();
    }
}
