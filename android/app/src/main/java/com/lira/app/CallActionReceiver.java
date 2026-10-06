package com.lira.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationManagerCompat;

public class CallActionReceiver extends BroadcastReceiver {
    public static final String ACTION_TOGGLE_MUTE = "com.lira.app.ACTION_TOGGLE_MUTE";
    public static final String ACTION_TOGGLE_DEAFEN = "com.lira.app.ACTION_TOGGLE_DEAFEN";
    public static final String ACTION_LEAVE_ROOM = "com.lira.app.ACTION_LEAVE_ROOM";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();

        if (ACTION_LEAVE_ROOM.equals(action)) {
            // Garante que a notificação é removida imediatamente mesmo se a activity estiver congelada
            try {
                NotificationManagerCompat.from(context).cancel(CallNotificationPlugin.NOTIFICATION_ID);
            } catch (Exception ignored) {}
        }

        if (CallNotificationPlugin.instance != null) {
            if (ACTION_TOGGLE_MUTE.equals(action)) {
                CallNotificationPlugin.instance.handleNotificationAction("toggleMute");
            } else if (ACTION_TOGGLE_DEAFEN.equals(action)) {
                CallNotificationPlugin.instance.handleNotificationAction("toggleDeafen");
            } else if (ACTION_LEAVE_ROOM.equals(action)) {
                CallNotificationPlugin.instance.handleNotificationAction("leaveRoom");
            }
        }
    }
}
