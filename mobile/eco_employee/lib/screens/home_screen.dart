import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

const roleNames = {
  'field_sales': 'Field Sales Executive',
  'tele_sales': 'Tele-Sales Executive',
  'sales_manager': 'Sales Manager',
  'field_support': 'Field Support Executive',
  'support_manager': 'Support Manager',
  'hr': 'HR',
};

/// Home (design: 08 field sales app / 11 field support app): greeting, today's figures, icon tiles.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! SignedIn) return const SizedBox.shrink();
    final user = auth.user;
    final api = ref.read(apiClientProvider);
    final sales = user.role == 'field_sales' || user.role == 'tele_sales';
    final support = user.role == 'field_support';

    Future<Map<String, dynamic>> load() async {
      final out = <String, dynamic>{};
      out['today'] = await api.get('/v1/attendance/today');
      if (sales) out['dash'] = await api.get('/v1/dashboard/tele-sales');
      if (support) {
        final all = await api.page('/v1/complaints', query: {'limit': 1});
        final progress = await api.page('/v1/complaints', query: {'limit': 1, 'status': 'in_progress'});
        final today = await api.page('/v1/complaints', query: {'limit': 1, 'scheduledDate': todayIst()});
        final done = await api.page('/v1/complaints', query: {'limit': 1, 'status': 'closed'});
        out['tickets'] = {'all': all.total, 'progress': progress.total, 'today': today.total, 'done': done.total};
      }
      final notes = await api.page('/v1/notifications', query: {'limit': 1});
      out['unread'] = notes.extra['unread'] ?? 0;
      return out;
    }

    return Scaffold(
      body: SafeArea(
        child: Loader<Map<String, dynamic>>(
          load: load,
          builder: (context, d, reload) {
            final today = d['today'] as Map?;
            final dash = (d['dash'] as Map?) ?? {};
            final t = (d['tickets'] as Map?) ?? {};
            return ListView(children: [
              GreetingHeader(
                name: user.name,
                subtitle: roleNames[user.role] ?? words(user.role),
                trailing: IconButton(
                  onPressed: () => context.push('/alerts'),
                  icon: Badge(isLabelVisible: (d['unread'] as num? ?? 0) > 0, label: Text('${d['unread']}'), child: const Icon(Icons.notifications_outlined, color: Colors.white, size: 28)),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  _TodayCard(today: today, onTap: () => context.go('/attendance')),
                  if (sales)
                    GridView.count(crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), childAspectRatio: 2.3, mainAxisSpacing: 4, crossAxisSpacing: 8, children: [
                      StatTile(label: 'My distributors', value: '${dash['assignedDistributors'] ?? 0}', icon: Icons.groups_outlined, color: EcoColors.blue, onTap: () => context.push('/distributors')),
                      StatTile(label: "Today's visits", value: '${dash['visitsToday'] ?? 0}', icon: Icons.location_on_outlined, color: EcoColors.green, onTap: () => context.go('/visits')),
                      StatTile(label: 'Follow-ups due', value: '${dash['followupsDueToday'] ?? 0}', icon: Icons.event_note_outlined, color: EcoColors.violet, onTap: () => context.push('/followups')),
                      StatTile(label: 'Calls (7 days)', value: '${dash['callsLast7Days'] ?? 0}', icon: Icons.call_outlined, color: EcoColors.orange),
                    ]),
                  if (support)
                    GridView.count(crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), childAspectRatio: 2.3, mainAxisSpacing: 4, crossAxisSpacing: 8, children: [
                      StatTile(label: 'Assigned', value: '${t['all'] ?? 0}', icon: Icons.assignment_outlined, color: EcoColors.blue, onTap: () => context.go('/tickets')),
                      StatTile(label: 'In progress', value: '${t['progress'] ?? 0}', icon: Icons.build_outlined, color: EcoColors.orange, onTap: () => context.go('/tickets')),
                      StatTile(label: 'Today', value: '${t['today'] ?? 0}', icon: Icons.today_outlined, color: EcoColors.violet, onTap: () => context.go('/tickets')),
                      StatTile(label: 'Completed', value: '${t['done'] ?? 0}', icon: Icons.check_circle_outline, color: EcoColors.green, onTap: () => context.push('/tickets-done')),
                    ]),
                  const SizedBox(height: 6),
                  GridView.count(
                    crossAxisCount: 3,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                    childAspectRatio: 0.95,
                    children: [
                      if (sales) ...[
                        IconTile(icon: Icons.groups_rounded, label: 'My Distributors', color: EcoColors.blue, onTap: () => context.push('/distributors')),
                        IconTile(icon: Icons.location_on_rounded, label: 'Field Visit', color: EcoColors.green, onTap: () => context.go('/visits')),
                        IconTile(icon: Icons.event_note_rounded, label: 'Follow-ups', color: EcoColors.violet, onTap: () => context.push('/followups')),
                        IconTile(icon: Icons.shopping_cart_rounded, label: 'Order Request', color: EcoColors.blueBright, onTap: () => context.push('/requests/new')),
                        IconTile(icon: Icons.receipt_long_rounded, label: 'My Orders', color: EcoColors.teal, onTap: () => context.go('/requests')),
                      ],
                      if (support) ...[
                        IconTile(icon: Icons.confirmation_number_rounded, label: 'My Tickets', color: EcoColors.blue, onTap: () => context.go('/tickets')),
                        IconTile(icon: Icons.build_rounded, label: 'Service Visit', color: EcoColors.orange, onTap: () => context.go('/tickets')),
                        IconTile(icon: Icons.task_alt_rounded, label: 'Completed', color: EcoColors.green, onTap: () => context.push('/tickets-done')),
                      ],
                      IconTile(icon: Icons.event_available_rounded, label: 'Attendance', color: EcoColors.blue, onTap: () => context.go('/attendance')),
                      IconTile(icon: Icons.account_balance_wallet_rounded, label: 'Expenses', color: EcoColors.violet, onTap: () => context.push('/expenses')),
                      IconTile(icon: Icons.beach_access_rounded, label: 'Leave', color: EcoColors.orange, onTap: () => context.push('/leaves')),
                      IconTile(icon: Icons.notifications_rounded, label: 'Notifications', color: EcoColors.red, badge: (d['unread'] as num?)?.toInt(), onTap: () => context.push('/alerts')),
                    ],
                  ),
                ]),
              ),
            ]);
          },
        ),
      ),
    );
  }
}

class _TodayCard extends StatelessWidget {
  const _TodayCard({required this.today, required this.onTap});

  final Map? today;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final checkIn = today?['checkInTime'];
    final checkOut = today?['checkOutTime'];
    final checkedIn = today?['checkedIn'] == true;
    return EcoCard(
      onTap: onTap,
      child: Row(children: [
        Icon(checkedIn ? Icons.check_circle : Icons.login_rounded, color: checkedIn ? EcoColors.green : EcoColors.orange, size: 34),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(checkedIn ? (checkOut != null ? 'Checked out' : 'Checked in') : 'Not checked in yet', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            Text(checkedIn ? 'In: ${inTime(checkIn)}${checkOut != null ? '   Out: ${inTime(checkOut)}' : ''}' : 'Tap to mark attendance', style: const TextStyle(color: EcoColors.muted)),
          ]),
        ),
        const Icon(Icons.chevron_right),
      ]),
    );
  }
}
