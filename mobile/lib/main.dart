import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'api/api_client.dart';
import 'api/api_service.dart';
import 'screens/auth/login_screen.dart';
import 'screens/field/field_shell.dart';
import 'services/auth_service.dart';
import 'services/tracking_service.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  final apiClient = ApiClient();
  final apiService = ApiService(apiClient);
  final authService = AuthService(apiService);
  final trackingService = TrackingService(apiService, authService);

  runApp(
    MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: apiClient),
        Provider<ApiService>.value(value: apiService),
        ChangeNotifierProvider<AuthService>.value(value: authService),
        ChangeNotifierProvider<TrackingService>.value(value: trackingService),
      ],
      child: const MovementTrackingApp(),
    ),
  );
}

class MovementTrackingApp extends StatefulWidget {
  const MovementTrackingApp({super.key});

  @override
  State<MovementTrackingApp> createState() => _MovementTrackingAppState();
}

class _MovementTrackingAppState extends State<MovementTrackingApp> {
  final _navigatorKey = GlobalKey<NavigatorState>();
  late final AuthService _auth;
  bool _wasSignedIn = false;

  @override
  void initState() {
    super.initState();
    _auth = context.read<AuthService>();
    _auth.addListener(_onAuthChanged);
    _auth.init();
  }

  @override
  void dispose() {
    _auth.removeListener(_onAuthChanged);
    super.dispose();
  }

  /// On sign-out (including an expired login) close any open screens, so the
  /// agent lands on the login screen rather than a form that can't submit.
  void _onAuthChanged() {
    if (_wasSignedIn && !_auth.isAuthenticated) {
      _navigatorKey.currentState?.popUntil((route) => route.isFirst);
    }
    _wasSignedIn = _auth.isAuthenticated;
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: _navigatorKey,
      title: 'Moment Field Executive Management',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      home: Consumer<AuthService>(
        builder: (context, auth, _) {
          if (!auth.isInitialized) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }

          if (!auth.isAuthenticated) {
            return const LoginScreen();
          }

          // The app is for field staff only.
          return const FieldShell();
        },
      ),
    );
  }
}
