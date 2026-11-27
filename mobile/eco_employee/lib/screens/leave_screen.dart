import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

const leaveTypes = {'casual': 'Casual leave', 'sick': 'Sick leave', 'earned': 'Earned leave', 'unpaid': 'Unpaid leave', 'other': 'Other'};

/// Leave history and upcoming holidays.
class LeaveScreen extends ConsumerStatefulWidget {
  const LeaveScreen({super.key});

  @override
  ConsumerState<LeaveScreen> createState() => _LeaveScreenState();
}

class _LeaveScreenState extends ConsumerState<LeaveScreen> {
  final key = GlobalKey<LoaderState<Map<String, dynamic>>>();

  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('My leave')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: EcoColors.orange,
        foregroundColor: Colors.white,
        onPressed: () async {
          await context.push('/leaves/new');
          await key.currentState?.reload();
        },
        icon: const Icon(Icons.add),
        label: const Text('Apply for leave'),
      ),
      body: Loader<Map<String, dynamic>>(
        key: key,
        load: () async => {
          'leaves': await api.page('/v1/leaves', query: {'limit': 50, 'sort': 'fromDate'}),
          'holidays': await api.get('/v1/holidays', query: {'year': DateTime.now().year.toString()}),
        },
        builder: (context, d, reload) {
          final leaves = (d['leaves'] as Paged).items;
          final today = todayIst();
          final holidays = ((d['holidays'] as List?) ?? []).cast<Map>().where((h) => '${h['holidayDate']}'.compareTo(today) >= 0).toList();
          return ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 90), children: [
            if (leaves.isEmpty) const EmptyView(text: 'No leave applied yet', icon: Icons.beach_access_outlined),
            for (final l in leaves)
              EcoCard(
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(leaveTypes[l['leaveType']] ?? words(l['leaveType']), style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text(l['fromDate'] == l['toDate'] ? inDate(l['fromDate']) : '${inDate(l['fromDate'])} – ${inDate(l['toDate'])}', style: const TextStyle(color: EcoColors.muted)),
                      if (l['decisionNote'] != null) Text('${l['decisionNote']}', style: const TextStyle(fontSize: 12)),
                    ]),
                  ),
                  StatusChip('${l['status']}'),
                ]),
              ),
            if (holidays.isNotEmpty) ...[
              const SectionTitle('Upcoming holidays'),
              for (final h in holidays)
                ListTile(leading: const Icon(Icons.celebration_outlined, color: EcoColors.orange), title: Text('${h['name']}'), trailing: Text(inDate(h['holidayDate']))),
            ],
          ]);
        },
      ),
    );
  }
}

class NewLeaveScreen extends ConsumerStatefulWidget {
  const NewLeaveScreen({super.key});

  @override
  ConsumerState<NewLeaveScreen> createState() => _NewLeaveScreenState();
}

class _NewLeaveScreenState extends ConsumerState<NewLeaveScreen> {
  final _reason = TextEditingController();
  String _type = 'casual';
  DateTimeRange? _range;
  bool _busy = false;

  Future<void> _submit() async {
    if (_range == null) {
      showSnack(context, 'Choose the dates', error: true);
      return;
    }
    setState(() => _busy = true);
    final ok = await runSubmit(context, () async {
      await ref.read(apiClientProvider).post('/v1/leaves', body: {
        'fromDate': apiDay(_range!.start),
        'toDate': apiDay(_range!.end),
        'leaveType': _type,
        if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim(),
      });
    }, success: 'Leave applied. Your manager or HR will approve it.');
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Apply for leave')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        DropdownButtonFormField<String>(
          value: _type,
          decoration: const InputDecoration(labelText: 'Leave type'),
          items: [for (final e in leaveTypes.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
          onChanged: (v) => setState(() => _type = v ?? _type),
        ),
        const SizedBox(height: 14),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.date_range, color: EcoColors.blue),
          title: const Text('Dates'),
          subtitle: Text(_range == null ? 'Choose' : '${inDate(apiDay(_range!.start))} – ${inDate(apiDay(_range!.end))}'),
          onTap: () async {
            final now = DateTime.now();
            // Sick leave can be applied for days already passed.
            final r = await showDateRangePicker(context: context, firstDate: _type == 'sick' ? now.subtract(const Duration(days: 30)) : now, lastDate: now.add(const Duration(days: 365)));
            if (r != null) setState(() => _range = r);
          },
        ),
        TextField(controller: _reason, maxLength: 500, maxLines: 3, decoration: const InputDecoration(labelText: 'Reason')),
        const SizedBox(height: 16),
        ElevatedButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Sending…' : 'Apply')),
      ]),
    );
  }
}
