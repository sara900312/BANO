// Registers the device for FCM push notifications on Capacitor (Android/iOS).
// No-op on plain web. Persists the token to Supabase `customer_devices` when a phone is known.
import { supabase } from "@/integrations/supabase/client";
import { getLastPhone } from "@/lib/orders";

let started = false;

function isCapacitor(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
}

function openOrder(code: unknown) {
  if (typeof code === "string" && code && typeof window !== "undefined") {
    window.location.href = `/orders/${code}`;
  }
}

async function saveToken(token: string, platform: string) {
  const phone = getLastPhone();
  if (typeof window !== "undefined") {
    localStorage.setItem("neo_fcm_token", token);
  }
  if (!phone) return; // Store locally; will be attached after first order.
  try {
    await supabase.from("customer_devices").upsert(
      { phone, device_token: token, platform, updated_at: new Date().toISOString() },
      { onConflict: "device_token" },
    );
  } catch (e) {
    console.error("saveToken error", e);
  }
}

export async function attachPhoneToDevice(phone: string) {
  if (typeof window === "undefined" || !phone) return;
  const token = localStorage.getItem("neo_fcm_token");
  if (!token) return;
  const platform = isCapacitor() ? "android" : "web";
  try {
    await supabase.from("customer_devices").upsert(
      { phone, device_token: token, platform, updated_at: new Date().toISOString() },
      { onConflict: "device_token" },
    );
  } catch (e) {
    console.error("attachPhoneToDevice error", e);
  }
}

export async function initPushNotifications() {
  if (started) return;
  started = true;
  if (!isCapacitor()) return;

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const { LocalNotifications } = await import("@capacitor/local-notifications");

    // Notification channel (also created natively in MainActivity for FCM defaults).
    try {
      await PushNotifications.createChannel({
        id: "orders",
        name: "Order updates",
        description: "Notifications about your NEOMART orders",
        importance: 5,
        visibility: 1,
        vibration: true,
      });
    } catch {
      /* channels are Android-only */
    }

    // Android 13+ POST_NOTIFICATIONS — the OS shows the dialog only once per install.
    let perm;
    try {
      perm = await PushNotifications.checkPermissions();
    } catch {
      return;
    }
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      try {
        perm = await PushNotifications.requestPermissions();
      } catch {
        return;
      }
    }
    if (perm.receive !== "granted") return;

    try {
      const localPerm = await LocalNotifications.checkPermissions();
      if (localPerm.display !== "granted") await LocalNotifications.requestPermissions();
    } catch {
      /* ignore */
    }

    // Listeners must be registered before register() so cold-start events are not lost.
    await PushNotifications.addListener("registration", (t) => {
      void saveToken(t.value, "android");
    });
    await PushNotifications.addListener("registrationError", (err) => {
      console.error("push registration error", err);
      // Retry once — transient Play Services failures are common on first launch.
      window.setTimeout(() => {
        void PushNotifications.register().catch(() => {});
      }, 4000);
    });

    // Foreground: Android does not display FCM notifications while the app is open,
    // so mirror it with a local notification on the same channel.
    await PushNotifications.addListener("pushNotificationReceived", (notification) => {
      const data = (notification.data ?? {}) as Record<string, string>;
      void LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() % 2147483647),
            title: notification.title ?? "NEOMART",
            body: notification.body ?? "",
            channelId: "orders",
            smallIcon: "ic_stat_notify",
            extra: data,
          },
        ],
      }).catch(() => {});
    });

    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      openOrder(action.notification?.data?.order_code);
    });

    await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
      openOrder((action.notification?.extra as Record<string, string> | undefined)?.order_code);
    });

    await PushNotifications.register();
  } catch (e) {
    console.error("initPushNotifications error", e);
  }
}
