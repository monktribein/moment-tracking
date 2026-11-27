import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// My pending follow-ups, overdue first; mark them done.
class FollowupsScreen extends ConsumerStatefulWidget {
  const FollowupsScreen({super.key});

  @override
  ConsumerState<FollowupsScreen> createState() => _FollowupsScreenState();
}

class _FollowupsScreenState extends ConsumerState<FollowupsScreen> {
  final _loader = GlobalKey<LoaderState<Paged>>();

  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiClientProvider);
    final today = todayIst();
    return Scaffold(
      appBar: AppBar(title: const Text('Follow-ups')),
      body: Loader<Paged>(
        key: _loader,
        load: () => api.page('/v1/sales/followups', query: {'status': 'pending', 'limit': 100, 'sort': 'dueDate', 'order': 'asc'}),
        isEmpty: (p) => p.items.isEmpty,
        empty: const EmptyView(text: 'No pending follow-ups', hint: 'Follow-ups are created from visit reports and calls.', icon: Icons.event_available_outlined),
        builder: (context, p, reload) => ListView(padding: const EdgeInsets.all(14), children: [
          for (final f in p.items)
            EcoCard(
              child: Row(children: [
                Icon(Icons.event_note, color: '${f['dueDate']}'.compareTo(today) < 0 ? EcoColors.red : EcoColors.violet),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${f['distributorName']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text('${f['notes'] ?? words(f['source'])}', style: const TextStyle(color: EcoColors.muted), maxLines: 2),
                    Text('${'${f['dueDate']}'.compareTo(today) < 0 ? 'Overdue · ' : ''}${inDate(f['dueDate'])}', style: TextStyle(color: '${f['dueDate']}'.compareTo(today) < 0 ? EcoColors.red : EcoColors.muted, fontSize: 12, fontWeight: FontWeight.w600)),
                  ]),
                ),
                IconButton(
                  tooltip: 'Done',
                  icon: const Icon(Icons.check_circle_outline, color: EcoColors.green, size: 30),
                  onPressed: () async {
                    final ok = await runSubmit(context, () => api.post('/v1/sales/followups/${f['id']}/complete'), success: 'Follow-up done');
                    if (ok) await reload();
                  },
                ),
              ]),
            ),
        ]),
      ),
    );
  }
}
