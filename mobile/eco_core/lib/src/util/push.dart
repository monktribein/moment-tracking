import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

/// Firebase Cloud Messaging set-up. It runs only when the Firebase config files are in the app
/// (android/app/google-services.json, ios/Runner/GoogleService-Info.plist; see mobile/README.md).
/// Without them the app works normally and simply has no push notifications.
class PushSetup {
  PushSetup._();

  static String? token;

  static Future<void> init({void Function(RemoteMessage message)? onMessage}) async {
    try {
      await Firebase.initializeApp();
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission(alert: true, badge: true, sound: true);
      token = await messaging.getToken();
      debugPrint('FCM token: $token');
      if (onMessage != null) FirebaseMessaging.onMessage.listen(onMessage);
    } catch (e) {
      debugPrint('Push notifications are not configured: $e');
    }
  }
}
