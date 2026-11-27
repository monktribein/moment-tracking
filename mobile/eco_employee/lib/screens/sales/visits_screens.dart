import 'dart:io';

import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../util/location.dart';
import '../../widgets/voice_field.dart';

/// My visits: today, upcoming and done.
class VisitsScreen extends ConsumerStatefulWidget {
  const VisitsScreen({super.key});

  @override
  ConsumerState<VisitsScreen> createState() => _VisitsScreenState();
}

class _VisitsScreenState extends ConsumerState<VisitsScreen> {
  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiClientProvider);
    final today = todayIst();
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Field visits'),
          bottom: const TabBar(labelColor: Colors.white, unselectedLabelColor: Colors.white70, indicatorColor: EcoColors.orange, tabs: [Tab(text: 'Today'), Tab(text: 'Upcoming'), Tab(text: 'Done')]),
        ),
        body: TabBarView(children: [
          _VisitList(load: () => api.page('/v1/sales/visits', query: {'from': today, 'to': today, 'limit': 50, 'sort': 'visitDate', 'order': 'asc'})),
          _VisitList(load: () => api.page('/v1/sales/visits', query: {'status': 'scheduled', 'limit': 50, 'sort': 'visitDate', 'order': 'asc'})),
          _VisitList(load: () => api.page('/v1/sales/visits', query: {'to': today, 'limit': 50, 'sort': 'visitDate', 'order': 'desc'}), doneOnly: true),
        ]),
      ),
    );
  }
}

class _VisitList extends StatelessWidget {
  const _VisitList({required this.load, this.doneOnly = false});

  final Future<Paged> Function() load;
  final bool doneOnly;

  @override
  Widget build(BuildContext context) {
    return Loader<Paged>(
      load: load,
      isEmpty: (p) => p.items.where(_keep).isEmpty,
      empty: const EmptyView(text: 'No visits here', hint: 'Your manager assigns visits from the dashboard.', icon: Icons.location_off_outlined),
      builder: (context, p, reload) => ListView(padding: const EdgeInsets.all(14), children: [
        for (final v in p.items.where(_keep))
          EcoCard(
            onTap: () async {
              await context.push('/visits/${v['id']}');
              await reload();
            },
            child: Row(children: [
              const CircleAvatar(backgroundColor: Color(0xFFE8F5EC), child: Icon(Icons.location_on, color: EcoColors.green)),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${v['distributorName']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text('${inDate(v['visitDate'])} · ${v['purpose'] ?? 'Visit'}', style: const TextStyle(color: EcoColors.muted)),
                ]),
              ),
              StatusChip('${v['status']}'),
            ]),
          ),
      ]),
    );
  }

  bool _keep(Map<String, dynamic> v) => !doneOnly || ['report_submitted', 'completed'].contains(v['status']);
}

/// Visit detail: GPS check-in (once, at the distributor) and the visit report.
class VisitDetailScreen extends ConsumerStatefulWidget {
  const VisitDetailScreen({super.key, required this.id});

  final String id;

  @override
  ConsumerState<VisitDetailScreen> createState() => _VisitDetailScreenState();
}

class _VisitDetailScreenState extends ConsumerState<VisitDetailScreen> {
  final _loader = GlobalKey<LoaderState<Map<String, dynamic>>>();
  final _form = GlobalKey<FormState>();
  final _notes = TextEditingController();
  String _lang = 'hi';
  List<File> _photos = [];
  final Map<String, String> _uploaded = {};
  final List<({String productId, String name, int qty})> _needs = [];
  DateTime? _next;
  bool _busy = false;

  Future<void> _checkIn() async {
    setState(() => _busy = true);
    final api = ref.read(apiClientProvider);
    await runSubmit(context, () async {
      final fix = await currentFix(context);
      try {
        await api.post('/v1/sales/visits/${widget.id}/check-in', body: {'lat': fix.latitude, 'lng': fix.longitude, 'accuracy': fix.accuracy, 'timestamp': DateTime.now().toUtc().toIso8601String()});
      } on ApiException catch (e) {
        if (e.status != 409 || !e.message.toLowerCase().contains('checked in')) rethrow; // a retry of a check-in that already worked
      }
    }, success: 'Check-in verified');
    if (mounted) setState(() => _busy = false);
    await _loader.currentState?.reload();
  }

  Future<void> _report() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final api = ref.read(apiClientProvider);
    final ok = await runSubmit(context, () async {
      // Photos already uploaded on an earlier try are not sent again.
      for (final f in _photos) {
        if (!_uploaded.containsKey(f.path)) _uploaded[f.path] = await api.uploadPrivate(f, 'photo');
      }
      try {
        await api.post('/v1/sales/visits/${widget.id}/report', body: {
          'notes': _notes.text.trim(),
          'transcriptLang': _lang,
          'photos': [for (final f in _photos) _uploaded[f.path]],
          'productRequirements': [for (final n in _needs) {'productId': n.productId, 'productName': n.name, 'quantity': n.qty}],
          if (_next != null) 'nextFollowupDate': apiDay(_next!),
        });
      } on ApiException catch (e) {
        // A retry after a lost response: the first try already saved the report.
        if (e.status != 409 || !e.message.contains('report submitted')) rethrow;
      }
    }, success: 'Visit report submitted');
    if (mounted) setState(() => _busy = false);
    if (ok) await _loader.currentState?.reload();
  }

  Future<void> _addNeed() async {
    final api = ref.read(apiClientProvider);
    final products = await api.page('/v1/products', query: {'limit': 100, 'sort': 'name', 'order': 'asc'});
    if (!mounted) return;
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      builder: (c) => ListView(children: [
        const ListTile(title: Text('Product requirement', style: TextStyle(fontWeight: FontWeight.w700))),
        for (final p in products.items) ListTile(title: Text('${p['name']}'), subtitle: Text('${p['model']} · ${p['sku']}'), onTap: () => Navigator.pop(c, p)),
      ]),
    );
    if (picked == null || !mounted) return;
    final qty = TextEditingController(text: '1');
    final n = await showDialog<int>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('${picked['name']}'),
        content: TextField(controller: qty, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Quantity')),
        actions: [FilledButton(onPressed: () => Navigator.pop(c, int.tryParse(qty.text)), child: const Text('Add'))],
      ),
    );
    if (n != null && n > 0) setState(() => _needs.add((productId: picked['id'] as String, name: picked['name'] as String, qty: n)));
  }

  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Field visit')),
      body: Loader<Map<String, dynamic>>(
        key: _loader,
        load: () async => ((await api.get('/v1/sales/visits/${widget.id}')) as Map).cast<String, dynamic>(),
        builder: (context, v, reload) {
          final status = '${v['status']}';
          final report = v['report'] as Map?;
          final isToday = v['visitDate'] == todayIst();
          return ListView(padding: const EdgeInsets.all(14), children: [
            EcoCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [Expanded(child: Text('${v['distributorName']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))), StatusChip(status)]),
                InfoRow('Date', inDate(v['visitDate']), icon: Icons.calendar_today),
                InfoRow('Purpose', '${v['purpose'] ?? ''}', icon: Icons.flag_outlined),
                InfoRow('Priority', words(v['priority']), icon: Icons.priority_high),
                if ((v['instructions'] ?? '').toString().isNotEmpty) InfoRow('Instructions', '${v['instructions']}', icon: Icons.info_outline),
              ]),
            ),
            EcoCard(
              color: v['checkinAt'] != null ? const Color(0xFFEFFAF3) : null,
              child: v['checkinAt'] != null
                  ? Row(children: [
                      const Icon(Icons.verified, color: EcoColors.green, size: 30),
                      const SizedBox(width: 10),
                      Expanded(child: Text('Check-in verified\n${inDateTime(v['checkinAt'])} · ±${(v['checkinAccuracy'] as num? ?? 0).round()} m', style: const TextStyle(fontWeight: FontWeight.w600))),
                    ])
                  : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      const Text('Check in when you reach the distributor. Your location is taken once.', style: TextStyle(color: EcoColors.muted)),
                      const SizedBox(height: 10),
                      ElevatedButton.icon(
                        onPressed: status == 'scheduled' && isToday && !_busy ? _checkIn : null,
                        icon: const Icon(Icons.my_location),
                        label: Text(_busy ? 'Getting location…' : (isToday ? 'Check-in (GPS)' : 'Check-in opens on ${inDate(v['visitDate'])}')),
                      ),
                    ]),
            ),
            if (report != null) ...[
              const SectionTitle('Visit report'),
              EcoCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${report['notes']}'),
                  const SizedBox(height: 6),
                  InfoRow('Next follow-up', inDate(report['nextFollowupDate'])),
                  InfoRow('Photos', '${(report['photos'] as List?)?.length ?? 0}'),
                  for (final n in (report['productRequirements'] as List? ?? [])) Text('• ${n['productName'] ?? 'Product'} × ${n['quantity'] ?? ''}'),
                ]),
              ),
            ],
            if (status == 'checked_in')
              Form(
                key: _form,
                child: EcoCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    const Text('Visit report', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 10),
                    VoiceTextField(controller: _notes, label: 'Visit notes', onLanguage: (l) => _lang = l, validator: (s) => (s ?? '').trim().isEmpty ? 'Write or speak the meeting notes' : null),
                    const SizedBox(height: 6),
                    const Text('Photos (site / product / visit)', style: TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    PhotoStrip(files: _photos, max: 10, onChanged: (f) => setState(() => _photos = f)),
                    const SizedBox(height: 12),
                    Row(children: [
                      const Expanded(child: Text('Product requirements', style: TextStyle(fontWeight: FontWeight.w600))),
                      TextButton.icon(onPressed: _addNeed, icon: const Icon(Icons.add), label: const Text('Add')),
                    ]),
                    for (var i = 0; i < _needs.length; i++)
                      ListTile(dense: true, title: Text(_needs[i].name), subtitle: Text('Qty ${_needs[i].qty}'), trailing: IconButton(icon: const Icon(Icons.delete_outline), onPressed: () => setState(() => _needs.removeAt(i)))),
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.event, color: EcoColors.blue),
                      title: const Text('Next follow-up'),
                      subtitle: Text(_next == null ? 'None' : inDate(apiDay(_next!))),
                      onTap: () async {
                        final d = await showDatePicker(context: context, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 180)), initialDate: DateTime.now().add(const Duration(days: 3)));
                        if (d != null) setState(() => _next = d);
                      },
                    ),
                    const SizedBox(height: 8),
                    ElevatedButton(onPressed: _busy ? null : _report, child: Text(_busy ? 'Submitting…' : 'Submit report')),
                  ]),
                ),
              ),
            if (status != 'cancelled')
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: OutlinedButton.icon(onPressed: () => context.push('/requests/new?distributor=${v['distributorId']}'), icon: const Icon(Icons.add_shopping_cart), label: const Text('Create purchase request')),
              ),
          ]);
        },
      ),
    );
  }
}
