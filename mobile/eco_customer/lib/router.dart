import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'screens/complaint_screens.dart';
import 'screens/home_screen.dart';
import 'screens/product_screens.dart';
import 'screens/register_screen.dart';
import 'screens/support_profile_screens.dart';

/// Bottom navigation like the design: Home · My Products · Requests · Profile.
const _tabs = [
  (path: '/', label: 'Home', icon: Icons.home_rounded),
  (path: '/products', label: 'My Products', icon: Icons.inventory_2_outlined),
  (path: '/requests', label: 'Requests', icon: Icons.assignment_outlined),
  (path: '/profile', label: 'Profile', icon: Icons.person_outline),
];

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(authControllerProvider, (_, __) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final at = state.matchedLocation;
      final open = at == '/login' || at == '/forgot' || at == '/register';
      if (auth is AuthLoading) return at == '/splash' ? null : '/splash';
      if (auth is SignedOut) return open ? null : '/login';
      if (at == '/splash' || open) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, __) => const SplashScreen(tagline: 'Clean energy · Happy customers')),
      GoRoute(
        path: '/login',
        builder: (context, __) {
          final auth = ref.read(authControllerProvider);
          return LoginScreen(
            title: 'Sign in to your Eco Sor account',
            message: auth is SignedOut ? auth.message : null,
            onForgot: () => context.push('/forgot'),
            footer: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Text('New customer?'),
              TextButton(onPressed: () => context.push('/register'), child: const Text('Create an account')),
            ]),
          );
        },
      ),
      GoRoute(path: '/register', builder: (_, __) => const RegisterScreen()),
      GoRoute(path: '/forgot', builder: (_, __) => const ForgotPasswordScreen()),
      ShellRoute(
        builder: (context, state, child) {
          // state.uri is the current location; a ShellRoute's own matchedLocation is not the tab's.
          var index = _tabs.indexWhere((t) => t.path == state.uri.path);
          if (index < 0) index = 0;
          return Scaffold(
            body: child,
            bottomNavigationBar: NavigationBar(
              selectedIndex: index,
              onDestinationSelected: (i) => context.go(_tabs[i].path),
              destinations: [for (final t in _tabs) NavigationDestination(icon: Icon(t.icon), label: t.label)],
            ),
          );
        },
        routes: [
          GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
          GoRoute(path: '/products', builder: (_, __) => const MyProductsScreen()),
          GoRoute(path: '/requests', builder: (_, __) => const MyRequestsScreen()),
          GoRoute(path: '/profile', builder: (_, __) => const ProfileScreen()),
        ],
      ),
      GoRoute(path: '/products/new', builder: (_, __) => const RegisterProductScreen()),
      GoRoute(path: '/scan', builder: (_, __) => const ScanSerialScreen()),
      GoRoute(path: '/complaints/new', builder: (_, s) => RaiseComplaintScreen(productId: s.uri.queryParameters['product'])),
      GoRoute(path: '/complaints/:id', builder: (_, s) => ComplaintDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/complaints/:id/done', builder: (_, s) => ComplaintDoneScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/notifications', builder: (_, __) => const NotificationsScreen()),
      GoRoute(path: '/support', builder: (_, __) => const ContactSupportScreen()),
    ],
  );
});
