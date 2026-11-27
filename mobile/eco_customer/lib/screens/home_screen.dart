import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Home (design: 12 customer app): greeting, tiles, latest request.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! SignedIn) return const SizedBox.shrink();
    final api = ref.read(apiClientProvider);
    return Scaffold(
      body: SafeArea(
        child: Loader<Map<String, dynamic>>(
          load: () async {
            final me = ((await api.get('/v1/customers/me')) as Map).cast<String, dynamic>();
            final recent = await api.page('/v1/complaints', query: {'limit': 1});
            final notes = await api.page('/v1/notifications', query: {'limit': 1});
            return {'me': me, 'recent': recent.items, 'unread': notes.extra['unread'] ?? 0};
          },
          builder: (context, d, reload) {
            final me = d['me'] as Map<String, dynamic>;
            final recent = (d['recent'] as List).cast<Map<String, dynamic>>();
            final unread = (d['unread'] as num?)?.toInt() ?? 0;
            return ListView(children: [
              Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
                child: Row(children: [
                  const EcoLogo(size: 26),
                  const Spacer(),
                  IconButton(
                    onPressed: () => context.push('/notifications'),
                    icon: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: const Icon(Icons.notifications_outlined, color: EcoColors.blue, size: 28)),
                  ),
                ]),
              ),
              GreetingHeader(name: '${me['name'] ?? auth.user.name}', subtitle: '${me['products'] ?? 0} product(s) registered · ${me['openComplaints'] ?? 0} open request(s)'),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 1.25,
                    children: [
                      IconTile(icon: Icons.add_circle_rounded, label: 'Register Product', color: EcoColors.blueBright, onTap: () => context.push('/products/new')),
                      IconTile(icon: Icons.verified_user_rounded, label: 'My Products & Warranty', color: EcoColors.orange, onTap: () => context.go('/products')),
                      IconTile(icon: Icons.build_rounded, label: 'Raise a Service Request', color: EcoColors.orangeDark, onTap: () => context.push('/complaints/new')),
                      IconTile(icon: Icons.assignment_rounded, label: 'My Requests (Track Status)', color: EcoColors.blue, onTap: () => context.go('/requests')),
                      IconTile(icon: Icons.notifications_active_rounded, label: 'Alerts & Updates', color: EcoColors.violet, badge: unread, onTap: () => context.push('/notifications')),
                      IconTile(icon: Icons.support_agent_rounded, label: 'Support & Contact Us', color: EcoColors.teal, onTap: () => context.push('/support')),
                    ],
                  ),
                  if (recent.isNotEmpty) ...[
                    const SectionTitle('Recent request'),
                    EcoCard(
                      onTap: () async {
                        await context.push('/complaints/${recent.first['id']}');
                        await reload();
                      },
                      child: Row(children: [
                        const CircleAvatar(backgroundColor: Color(0xFFFFF1E6), child: Icon(Icons.build, color: EcoColors.orange)),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${recent.first['complaintNo']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                            Text('${words(recent.first['category'])} · ${recent.first['model']}', style: const TextStyle(color: EcoColors.muted)),
                            Text(inDate(recent.first['createdAt']), style: const TextStyle(color: EcoColors.muted, fontSize: 12)),
                          ]),
                        ),
                        StatusChip('${recent.first['status']}'),
                      ]),
                    ),
                  ],
                ]),
              ),
            ]);
          },
        ),
      ),
    );
  }
}
