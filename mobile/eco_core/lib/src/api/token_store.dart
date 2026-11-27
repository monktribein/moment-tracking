import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The sign-in token, kept in the platform's secure storage (Keystore / Keychain).
class TokenStore {
  TokenStore({String key = 'eco_token'}) : _key = key;

  final String _key;
  static const _storage = FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));
  String? _cache;

  Future<String?> read() async => _cache ??= await _storage.read(key: _key);

  Future<void> write(String token) async {
    _cache = token;
    await _storage.write(key: _key, value: token);
  }

  Future<void> clear() async {
    _cache = null;
    await _storage.delete(key: _key);
  }

  /// When the token expires (from its `exp` claim), or null if it cannot be read.
  static DateTime? expiryOf(String token) {
    try {
      final parts = token.split('.');
      if (parts.length != 3) return null;
      final payload = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1])))) as Map<String, dynamic>;
      final exp = payload['exp'];
      return exp is num ? DateTime.fromMillisecondsSinceEpoch(exp.toInt() * 1000) : null;
    } catch (_) {
      return null;
    }
  }
}
