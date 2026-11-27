import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'screens/attendance_screen.dart';
import 'screens/expenses_screen.dart';
import 'screens/home_screen.dart';
import 'screens/leave_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/sales/distributors_screen.dart';
import 'screens/sales/followups_screen.dart';
import 'screens/sales/purchase_screens.dart';
import 'screens/sales/visits_screens.dart';
import 'screens/support/ticket_screens.dart';

/// Bottom navigation per role, like the design (Home · Visits · Orders · Profile for sales;
/// Home · Tickets · Attendance · Profile for engineers).
List<({String path, String label, IconData icon})> navFor(String role) {
  const home = (path: '/', label: 'Home', icon: Icons.home_rounded);
  const profile = (path: '/profile', label: 'Profile', icon: Icons.person_outline);
  const attendance = (path: '/attendance', label: 'Attendance', icon: Icons.event_available_outlined);
  switch (role) {
    case 'field_sales':
    case 'tele_sales':
      return [home, (path: '/visits', label: 'Visits', icon: Icons.location_on_outlined), (path: '/requests', label: 'Orders', icon: Icons.shopping_cart_outlined), profile];
    case 'field_support':
      return [home, (path: '/tickets', label: 'Tickets', icon: Icons.confirmation_number_outlined), attendance, profile];
    default:
      return [home, attendance, (path: '/notifications', label: 'Alerts', icon: Icons.notifications_none), profile];
  }
}

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
      final open = at == '/login' || at == '/forgot';
      if (auth is AuthLoading) return at == '/splash' ? null : '/splash';
      if (auth is SignedOut) return open ? null : '/login';
      if (at == '/splash' || open) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, __) => const SplashScreen(tagline: 'Employee app')),
      GoRoute(
        path: '/login',
        builder: (context, __) {
          final auth = ref.read(authControllerProvider);
          return LoginScreen(title: 'Employee sign in', message: auth is SignedOut ? auth.message : null, onForgot: () => context.push('/forgot'));
        },
      ),
      GoRoute(path: '/forgot', builder: (_, __) => const ForgotPasswordScreen()),
      ShellRoute(
        // state.uri is the current location; a ShellRoute's own matchedLocation is not the tab's.
        builder: (context, state, child) => _Shell(location: state.uri.path, child: child),
        routes: [
          GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
          GoRoute(path: '/attendance', builder: (_, __) => const AttendanceScreen()),
          GoRoute(path: '/profile', builder: (_, __) => const ProfileScreen()),
          GoRoute(path: '/visits', builder: (_, __) => const VisitsScreen()),
          GoRoute(path: '/requests', builder: (_, __) => const RequestsScreen()),
          GoRoute(path: '/tickets', builder: (_, __) => const TicketsScreen()),
          GoRoute(path: '/notifications', builder: (_, __) => const NotificationsScreen()),
        ],
      ),
      GoRoute(path: '/expenses', builder: (_, __) => const ExpensesScreen()),
      GoRoute(path: '/expenses/new', builder: (_, __) => const NewExpenseScreen()),
      GoRoute(path: '/leaves', builder: (_, __) => const LeaveScreen()),
      GoRoute(path: '/leaves/new', builder: (_, __) => const NewLeaveScreen()),
      GoRoute(path: '/alerts', builder: (_, __) => const NotificationsScreen()),
      GoRoute(path: '/distributors', builder: (_, __) => const DistributorsScreen()),
      GoRoute(path: '/visits/:id', builder: (_, s) => VisitDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/followups', builder: (_, __) => const FollowupsScreen()),
      GoRoute(path: '/requests/new', builder: (_, s) => NewRequestScreen(distributorId: s.uri.queryParameters['distributor'])),
      GoRoute(path: '/requests/:id', builder: (_, s) => RequestDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/requests/:id/correct', builder: (_, s) => NewRequestScreen(correctId: s.pathParameters['id'])),
      GoRoute(path: '/requests/:id/done', builder: (_, s) => RequestDoneScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/tickets/:id', builder: (_, s) => TicketDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/tickets-done', builder: (_, __) => const TicketsScreen(completed: true)),
    ],
  );
});

class _Shell extends ConsumerWidget {
  const _Shell({required this.location, required this.child});

  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final role = auth is SignedIn ? auth.user.role : '';
    final items = navFor(role);
    var index = items.indexWhere((i) => i.path == location);
    if (index < 0) index = 0;
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => context.go(items[i].path),
        destinations: [for (final i in items) NavigationDestination(icon: Icon(i.icon), label: i.label)],
      ),
    );
  }
}
