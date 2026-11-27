import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/token_store.dart';

/// The signed-in user, as GET /api/v1/auth/me returns them.
class EcoUser {
  EcoUser(this.raw);

  final Map<String, dynamic> raw;

  String get id => raw['id'] as String;
  String get name => (raw['name'] as String?) ?? '';
  String get phone => (raw['phone'] as String?) ?? '';
  String get email => (raw['email'] as String?) ?? '';
  String get role => (raw['role'] as String?) ?? '';
  String? get employeeId => raw['employeeId'] as String?;
  String? get customerId => raw['customerId'] as String?;
  String get companyName => ((raw['company'] as Map?)?['name'] as String?) ?? '';
  List<String> get permissions => ((raw['permissions'] as List?) ?? []).map((e) => e.toString()).toList();

  bool can(String permission) => permissions.contains('*') || permissions.contains(permission);
}

sealed class AuthState {
  const AuthState();
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

class SignedOut extends AuthState {
  const SignedOut([this.message]);
  final String? message;
}

class SignedIn extends AuthState {
  const SignedIn(this.user);
  final EcoUser user;
}

/// Which roles may use this app, and what to tell everyone else. Each app overrides it.
class AuthConfig {
  const AuthConfig({required this.allowedRoles, required this.wrongAppMessage, this.tokenKey = 'eco_token'});

  final Set<String> allowedRoles;
  final String wrongAppMessage;
  final String tokenKey;
}

final authConfigProvider = Provider<AuthConfig>((ref) => throw UnimplementedError('Override authConfigProvider in main()'));

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore(key: ref.watch(authConfigProvider).tokenKey));

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(ref.watch(tokenStoreProvider)));

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>((ref) {
  final controller = AuthController(ref.watch(apiClientProvider), ref.watch(authConfigProvider));
  controller.restore();
  return controller;
});

/// Sign-in, sign-out and the session lifetime. A rejected or expired token signs the user out.
class AuthController extends StateNotifier<AuthState> {
  AuthController(this._api, this._config) : super(const AuthLoading()) {
    _api.onUnauthorized = () => _end('Your session has ended. Please sign in again.');
  }

  final ApiClient _api;
  final AuthConfig _config;
  Timer? _expiry;

  EcoUser? get user => state is SignedIn ? (state as SignedIn).user : null;

  Future<void> restore() async {
    final token = await _api.tokens.read();
    if (token == null) {
      state = const SignedOut();
      return;
    }
    try {
      await _loadMe(token);
    } on ApiException catch (e) {
      // Offline at start-up: keep the user out until the server confirms the session.
      // A rejected token (401) needs no message; other errors (e.g. "this app is for staff") are shown.
      state = SignedOut(e.offline ? 'No internet connection. Connect and open the app again.' : (e.status == 401 ? null : e.message));
    } catch (_) {
      // Anything unexpected (e.g. a malformed response) must not leave the splash screen spinning.
      await _api.tokens.clear();
      state = const SignedOut();
    }
  }

  Future<void> _loadMe(String token) async {
    final me = EcoUser(((await _api.get('/v1/auth/me')) as Map).cast<String, dynamic>());
    if (!_config.allowedRoles.contains(me.role)) {
      await _api.tokens.clear();
      throw ApiException(_config.wrongAppMessage);
    }
    _scheduleExpiry(token);
    state = SignedIn(me);
  }

  /// [identifier] is the 10-digit mobile number (or email).
  Future<void> login(String identifier, String password) async {
    final res = (await _api.post('/v1/auth/login', body: {'identifier': identifier.trim(), 'password': password}, auth: false)) as Map;
    final token = res['token'] as String;
    final role = ((res['user'] as Map?)?['role'] as String?) ?? '';
    if (!_config.allowedRoles.contains(role)) throw ApiException(_config.wrongAppMessage);
    await _api.tokens.write(token);
    await _loadMe(token);
  }

  Future<void> logout() async {
    try {
      await _api.post('/v1/auth/logout');
    } catch (_) {
      // Signing out locally is enough when offline.
    }
    await _end(null);
  }

  /// Stores a new token after a password change (other sessions were ended).
  Future<void> replaceToken(String token) async {
    await _api.tokens.write(token);
    await _loadMe(token);
  }

  Future<void> refreshUser() async {
    final token = await _api.tokens.read();
    if (token != null) await _loadMe(token);
  }

  void _scheduleExpiry(String token) {
    _expiry?.cancel();
    final exp = TokenStore.expiryOf(token);
    if (exp == null) return;
    final left = exp.difference(DateTime.now());
    _expiry = Timer(left.isNegative ? Duration.zero : left, () => _end('Your session has expired. Please sign in again.'));
  }

  Future<void> _end(String? message) async {
    _expiry?.cancel();
    await _api.tokens.clear();
    if (mounted) state = SignedOut(message);
  }

  @override
  void dispose() {
    _expiry?.cancel();
    super.dispose();
  }
}
