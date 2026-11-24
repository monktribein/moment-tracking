import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_service.dart';
import '../models/user.dart';

class AuthService extends ChangeNotifier {
  final ApiService apiService;
  UserSession? _session;
  bool _initialized = false;
  String? _signOutReason;

  AuthService(this.apiService) {
    // An expired or revoked login signs the agent out with an explanation.
    apiService.client.onUnauthorized = () {
      if (_session != null) {
        logout(reason: 'Your session has expired. Please sign in again.');
      }
    };
  }

  UserSession? get session => _session;
  bool get isAuthenticated => _session != null;
  bool get isInitialized => _initialized;

  /// Why the agent was signed out automatically, shown once on the login
  /// screen. Null for a normal sign-out.
  String? takeSignOutReason() {
    final reason = _signOutReason;
    _signOutReason = null;
    return reason;
  }

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('auth_token');
    final sessionJson = prefs.getString('auth_session');

    if (token != null && sessionJson != null) {
      try {
        final Map<String, dynamic> data = jsonDecode(sessionJson);
        if (data['kind']?.toString() == 'field') {
          _session = UserSession.fromFieldJson(data, token);
          apiService.setToken(token);
        } else {
          // A Super Admin login saved by an older version: the app is now for
          // field staff only, so sign it out.
          await prefs.remove('auth_token');
          await prefs.remove('auth_session');
        }
      } catch (_) {
        await prefs.remove('auth_token');
        await prefs.remove('auth_session');
      }
    }
    _initialized = true;
    notifyListeners();
  }

  Future<void> loginField(String phone, String password) async {
    final res = await apiService.fieldLogin(phone, password);
    final token = res['token']?.toString() ?? '';
    final session = UserSession.fromFieldJson(res, token);

    _session = session;
    apiService.setToken(token);

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('auth_token', token);
    await prefs.setString(
      'auth_session',
      jsonEncode({
        'kind': 'field',
        'role': session.role,
        'user': {
          'id': session.id,
          'name': session.name,
          'phone': session.phone,
          'district': session.district,
          'state': session.state,
          'role': session.role,
          'employeeCode': session.employeeCode,
          'email': session.email,
        },
      }),
    );

    notifyListeners();
  }

  Future<void> logout({String? reason}) async {
    _signOutReason = reason;
    _session = null;
    apiService.setToken(null);

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');
    await prefs.remove('auth_session');

    notifyListeners();
  }
}
