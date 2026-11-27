import 'dart:async';

import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// My distributors (only those assigned to me), with call and order actions.
class DistributorsScreen extends ConsumerStatefulWidget {
  const DistributorsScreen({super.key});

  @override
  ConsumerState<DistributorsScreen> createState() => _DistributorsScreenState();
}

class _DistributorsScreenState extends ConsumerState<DistributorsScreen> {
  final _loader = GlobalKey<LoaderState<Paged>>();
  String _search = '';
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('My distributors')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
          child: TextField(
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search by firm, contact, mobile or city'),
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 400), () {
                _search = v.trim();
                _loader.currentState?.reload();
              });
            },
          ),
        ),
        Expanded(
          child: Loader<Paged>(
            key: _loader,
            load: () => api.page('/v1/distributors', query: {'limit': 100, 'active': 'true', 'search': _search, 'sort': 'firmName', 'order': 'asc'}),
            isEmpty: (p) => p.items.isEmpty,
            empty: const EmptyView(text: 'No distributors found', hint: 'Only distributors assigned to you are shown.', icon: Icons.storefront_outlined),
            builder: (context, p, reload) => ListView(padding: const EdgeInsets.all(14), children: [
              for (final d in p.items)
                EcoCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      CircleAvatar(backgroundColor: const Color(0xFFFFF1E6), child: Text('${d['firmName']}'.isEmpty ? '?' : '${d['firmName']}'[0], style: const TextStyle(color: EcoColors.orange, fontWeight: FontWeight.w800))),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${d['firmName']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                          Text('${d['contactPerson']} · ${[d['city'], d['state']].where((x) => x != null && '$x'.isNotEmpty).join(', ')}', style: const TextStyle(color: EcoColors.muted)),
                        ]),
                      ),
                    ]),
                    const SizedBox(height: 10),
                    Row(children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            await openPhone('${d['mobile']}');
                            if (context.mounted) await showModalBottomSheet(context: context, isScrollControlled: true, builder: (_) => CallLogSheet(distributor: d));
                          },
                          icon: const Icon(Icons.call),
                          label: const Text('Call'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                          onPressed: () => context.push('/requests/new?distributor=${d['id']}'),
                          icon: const Icon(Icons.add_shopping_cart),
                          label: const Text('Order'),
                        ),
                      ),
                    ]),
                  ]),
                ),
            ]),
          ),
        ),
      ]),
    );
  }
}

/// After a call: outcome, notes and an optional next follow-up (creates the follow-up).
class CallLogSheet extends ConsumerStatefulWidget {
  const CallLogSheet({super.key, required this.distributor});

  final Map<String, dynamic> distributor;

  @override
  ConsumerState<CallLogSheet> createState() => _CallLogSheetState();
}

class _CallLogSheetState extends ConsumerState<CallLogSheet> {
  static const outcomes = ['Interested', 'Order expected', 'Call back later', 'Not reachable', 'Not interested'];
  final _notes = TextEditingController();
  final _key = SubmitKey();
  String _outcome = outcomes.first;
  String _direction = 'out';
  DateTime? _next;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Log call · ${widget.distributor['firmName']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
        const SizedBox(height: 10),
        SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'out', label: Text('Outgoing')), ButtonSegment(value: 'in', label: Text('Incoming'))],
          selected: {_direction},
          onSelectionChanged: (s) => setState(() => _direction = s.first),
        ),
        const SizedBox(height: 10),
        Wrap(spacing: 6, children: [for (final o in outcomes) ChoiceChip(label: Text(o), selected: _outcome == o, onSelected: (_) => setState(() => _outcome = o))]),
        const SizedBox(height: 10),
        TextField(controller: _notes, maxLines: 3, maxLength: 2000, decoration: const InputDecoration(labelText: 'Discussion notes')),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.event, color: EcoColors.blue),
          title: const Text('Next follow-up'),
          subtitle: Text(_next == null ? 'None' : inDate(apiDay(_next!))),
          onTap: () async {
            final d = await showDatePicker(context: context, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 180)), initialDate: DateTime.now().add(const Duration(days: 2)));
            if (d != null) setState(() => _next = d);
          },
        ),
        ElevatedButton(
          onPressed: _busy
              ? null
              : () async {
                  setState(() => _busy = true);
                  final ok = await runSubmit(context, () async {
                    await ref.read(apiClientProvider).post('/v1/sales/call-logs', headers: {'Idempotency-Key': _key.value}, body: {
                      'distributorId': widget.distributor['id'],
                      'direction': _direction,
                      'outcome': _outcome,
                      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
                      if (_next != null) 'nextFollowupDate': apiDay(_next!),
                    });
                  }, success: 'Call logged');
                  if (!context.mounted) return;
                  setState(() => _busy = false);
                  if (ok) Navigator.pop(context);
                },
          child: Text(_busy ? 'Saving…' : 'Save call'),
        ),
      ]),
    );
  }
}
