import 'dart:io';

import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Issue categories (SRS section 10). No installation complaints.
const issueCategories = {
  'inverter_not_working': 'Inverter not working',
  'inverter_error_code': 'Error code on the display',
  'inverter_power_or_charging': 'Power output or charging issue',
  'battery_not_charging': 'Battery not charging',
  'battery_low_backup': 'Low backup',
  'battery_discharge_or_not_working': 'Battery discharging / not working',
  'other_inverter_battery': 'Other inverter / battery issue',
};

List<MapEntry<String, String>> _categoriesFor(String productCategory) =>
    issueCategories.entries.where((e) => e.key == 'other_inverter_battery' || e.key.startsWith('${productCategory}_')).toList();

/// Raise a service request for one of my registered products.
class RaiseComplaintScreen extends ConsumerStatefulWidget {
  const RaiseComplaintScreen({super.key, this.productId});

  final String? productId;

  @override
  ConsumerState<RaiseComplaintScreen> createState() => _RaiseComplaintScreenState();
}

class _RaiseComplaintScreenState extends ConsumerState<RaiseComplaintScreen> {
  final _form = GlobalKey<FormState>();
  final _description = TextEditingController();
  final _address = TextEditingController();
  final _contact = TextEditingController();
  final _key = SubmitKey();
  final Map<String, String> _uploaded = {};
  List<Map<String, dynamic>> _products = [];
  String? _productId;
  String? _category;
  List<File> _photos = [];
  bool _loading = true;
  bool _busy = false;
  Object? _error;

  ApiClient get _api => ref.read(apiClientProvider);

  Map<String, dynamic>? get _product => _products.where((p) => p['id'] == _productId).firstOrNull;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final products = await _api.page('/v1/customer-products', query: {'limit': 100});
      final me = ((await _api.get('/v1/customers/me')) as Map).cast<String, dynamic>();
      _products = products.items;
      _productId = widget.productId ?? (_products.length == 1 ? _products.first['id'] as String : null);
      _address.text = [me['address'], me['city'], me['state'], me['pin']].where((x) => x != null && '$x'.isNotEmpty).join(', ');
      _contact.text = '${me['mobile'] ?? ''}';
    } catch (e) {
      _error = e;
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    String? id;
    await runSubmit(context, () async {
      for (final f in _photos) {
        if (!_uploaded.containsKey(f.path)) _uploaded[f.path] = await _api.uploadPrivate(f, 'photo');
      }
      // The same Idempotency-Key on a retry returns the complaint already created.
      final c = (await _api.post('/v1/complaints', headers: {'Idempotency-Key': _key.value}, body: {
        'customerProductId': _productId,
        'category': _category,
        'description': _description.text.trim(),
        'photos': [for (final f in _photos) _uploaded[f.path]],
        'serviceAddress': _address.text.trim(),
        'contact': _contact.text.trim(),
      })) as Map;
      id = c['id'] as String;
    });
    if (!mounted) return;
    setState(() => _busy = false);
    if (id != null) {
      _key.reset();
      context.pushReplacement('/complaints/$id/done');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (_error != null) return Scaffold(appBar: AppBar(), body: ErrorView(error: _error!, onRetry: () => setState(() {
          _loading = true;
          _error = null;
          _load();
        })));
    if (_products.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Raise service request')),
        body: EmptyView(text: 'Register your product first', hint: 'Service requests are raised for a registered Eco Sor product.', icon: Icons.inventory_2_outlined),
        bottomNavigationBar: Padding(padding: const EdgeInsets.all(16), child: ElevatedButton(onPressed: () => context.pushReplacement('/products/new'), child: const Text('Register product'))),
      );
    }
    final p = _product;
    return Scaffold(
      appBar: AppBar(title: const Text('Raise service request')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          DropdownButtonFormField<String>(
            value: _productId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Select product *'),
            items: [
              for (final x in _products)
                DropdownMenuItem(value: x['id'] as String, child: Text('${words(x['category'])} ${x['model']} (S/N: ${x['serialNo']})', overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) => setState(() {
              _productId = v;
              _category = null;
            }),
            validator: (v) => v == null ? 'Choose the product' : null,
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            value: _category,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Issue type *'),
            items: [for (final e in _categoriesFor('${p?['category'] ?? 'inverter'}')) DropdownMenuItem(value: e.key, child: Text(e.value))],
            onChanged: p == null ? null : (v) => setState(() => _category = v),
            validator: (v) => v == null ? 'Choose the issue' : null,
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _description,
            maxLines: 4,
            maxLength: 2000,
            decoration: const InputDecoration(labelText: 'Issue description *', hintText: 'What happens? Any error code or sound?'),
            validator: (v) => (v ?? '').trim().length < 5 ? 'Describe the issue' : null,
          ),
          const Text('Photos (optional)', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          PhotoStrip(files: _photos, max: 5, onChanged: (f) => setState(() => _photos = f)),
          const SizedBox(height: 14),
          TextFormField(controller: _address, maxLines: 2, decoration: const InputDecoration(labelText: 'Service address *'), validator: (v) => (v ?? '').trim().isEmpty ? 'Where should the engineer come?' : null),
          const SizedBox(height: 12),
          TextFormField(controller: _contact, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Contact number *', prefixText: '+91 '), validator: validateMobile),
          const SizedBox(height: 8),
          const Text('Installation requests are not handled here.', style: TextStyle(fontSize: 12, color: EcoColors.muted)),
          const SizedBox(height: 16),
          ElevatedButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Submitting…' : 'Submit request')),
        ]),
      ),
    );
  }
}

/// Confirmation with the complaint number.
class ComplaintDoneScreen extends ConsumerWidget {
  const ComplaintDoneScreen({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Request submitted'), automaticallyImplyLeading: false),
      body: Loader<Map>(
        load: () async => (await api.get('/v1/complaints/$id')) as Map,
        builder: (context, c, _) => ListView(padding: const EdgeInsets.all(24), children: [
          const Icon(Icons.check_circle, color: EcoColors.green, size: 84),
          const SizedBox(height: 12),
          const Text('Your service request is registered', textAlign: TextAlign.center, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          Text('${c['complaintNo']}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: EcoColors.blue)),
          const SizedBox(height: 8),
          const Text('Keep this number. We assign an engineer and keep you updated on WhatsApp.', textAlign: TextAlign.center, style: TextStyle(color: EcoColors.muted)),
          const SizedBox(height: 24),
          ElevatedButton(onPressed: () => context.pushReplacement('/complaints/$id'), child: const Text('Track request')),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: () => context.go('/'), child: const Text('Back to home')),
        ]),
      ),
    );
  }
}

const _openStatuses = ['open', 'assigned', 'reopened'];
const _progressStatuses = ['in_progress', 'pending', 'resolved'];

/// My requests with status tabs (design: All / Open / In Progress / Closed).
class MyRequestsScreen extends ConsumerWidget {
  const MyRequestsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(apiClientProvider);
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('My requests'),
          bottom: const TabBar(labelColor: Colors.white, unselectedLabelColor: Colors.white70, indicatorColor: EcoColors.orange, tabs: [Tab(text: 'All'), Tab(text: 'Open'), Tab(text: 'In Progress'), Tab(text: 'Closed')]),
        ),
        floatingActionButton: FloatingActionButton.extended(
          backgroundColor: EcoColors.orange,
          foregroundColor: Colors.white,
          onPressed: () => context.push('/complaints/new'),
          icon: const Icon(Icons.add),
          label: const Text('New request'),
        ),
        body: TabBarView(children: [
          for (final keep in <bool Function(String)>[(_) => true, _openStatuses.contains, _progressStatuses.contains, (s) => s == 'closed'])
            Loader<Paged>(
              load: () => api.page('/v1/complaints', query: {'limit': 100}),
              isEmpty: (p) => p.items.where((c) => keep('${c['status']}')).isEmpty,
              empty: const EmptyView(text: 'No requests here', icon: Icons.assignment_outlined),
              builder: (context, p, reload) => ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 90), children: [
                for (final c in p.items.where((c) => keep('${c['status']}')))
                  EcoCard(
                    onTap: () async {
                      await context.push('/complaints/${c['id']}');
                      await reload();
                    },
                    child: Row(children: [
                      CircleAvatar(
                        backgroundColor: c['status'] == 'closed' ? const Color(0xFFE8F5EC) : const Color(0xFFFFF1E6),
                        child: Icon(c['status'] == 'closed' ? Icons.check : Icons.build, color: c['status'] == 'closed' ? EcoColors.green : EcoColors.orange),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${c['complaintNo']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                          Text(issueCategories[c['category']] ?? words(c['category']), style: const TextStyle(fontWeight: FontWeight.w600)),
                          Text('${words(c['productCategory'])} ${c['model']} · ${inDate(c['createdAt'])}', style: const TextStyle(color: EcoColors.muted, fontSize: 12)),
                        ]),
                      ),
                      StatusChip('${c['status']}'),
                    ]),
                  ),
              ]),
            ),
        ]),
      ),
    );
  }
}

/// Complaint detail with the timeline, the engineer, and how the job is closed (customer OTP).
class ComplaintDetailScreen extends ConsumerWidget {
  const ComplaintDetailScreen({super.key, required this.id});

  final String id;

  String _title(Map t) {
    switch (t['type']) {
      case 'status':
        return t['from'] == null ? 'Request registered' : words(t['to']);
      case 'assigned':
        return 'Engineer assigned: ${t['engineer']}';
      case 'engineer_check_in':
        return 'Engineer reached your site';
      case 'service_report':
        return 'Service report by ${t['engineer']}';
      default:
        return words(t['type']);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Request details')),
      body: Loader<Map<String, dynamic>>(
        load: () async => ((await api.get('/v1/complaints/$id')) as Map).cast<String, dynamic>(),
        builder: (context, c, reload) {
          final status = '${c['status']}';
          final timeline = (c['timeline'] as List? ?? []).cast<Map>();
          return ListView(padding: const EdgeInsets.all(14), children: [
            EcoCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [Expanded(child: Text('${c['complaintNo']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900))), StatusChip(status)]),
                const SizedBox(height: 4),
                Text(issueCategories[c['category']] ?? words(c['category']), style: const TextStyle(fontWeight: FontWeight.w700)),
                Text('${words(c['productCategory'])} ${c['model']} · S/N ${c['serialNo']}', style: const TextStyle(color: EcoColors.muted)),
                Text('Raised ${inDateTime(c['createdAt'])}', style: const TextStyle(color: EcoColors.muted, fontSize: 12)),
              ]),
            ),
            if (status == 'resolved')
              const EcoCard(
                color: Color(0xFFFFF7ED),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Icon(Icons.password, color: EcoColors.orange),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'The engineer has marked the service done. To close it, share the 6-digit OTP you receive on WhatsApp — only with the engineer at your site, and only if you are satisfied.',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ]),
              ),
            if (status == 'closed')
              EcoCard(
                color: const Color(0xFFEFFAF3),
                child: Row(children: [
                  const Icon(Icons.verified, color: EcoColors.green),
                  const SizedBox(width: 10),
                  Expanded(child: Text('Service completed and closed with your OTP on ${inDateTime(c['closedAt'])}.', style: const TextStyle(fontWeight: FontWeight.w600))),
                ]),
              ),
            if (c['engineerName'] != null && status != 'closed')
              EcoCard(
                child: Row(children: [
                  const CircleAvatar(backgroundColor: Color(0xFFEAF0FF), child: Icon(Icons.engineering, color: EcoColors.blue)),
                  const SizedBox(width: 10),
                  Expanded(child: Text('Your engineer: ${c['engineerName']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                  if (c['engineerMobile'] != null) IconButton.filledTonal(onPressed: () => openPhone('${c['engineerMobile']}'), icon: const Icon(Icons.call, color: EcoColors.green)),
                ]),
              ),
            const SectionTitle('Timeline'),
            EcoCard(
              child: TimelineList(items: [
                for (final t in timeline)
                  (
                    title: _title(t),
                    subtitle: '${inDateTime(t['at'])}${t['reason'] != null && t['type'] == 'status' ? ' · ${t['reason']}' : ''}',
                    done: true,
                    warn: t['to'] == 'reopened',
                  ),
                if (status != 'closed') (title: 'Closed with your OTP', subtitle: 'Waiting', done: false, warn: false),
              ]),
            ),
            const SectionTitle('Issue'),
            EcoCard(child: Text('${c['description']}')),
            if (status == 'resolved' || status == 'closed')
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: EcoColors.red, side: const BorderSide(color: EcoColors.red)),
                  onPressed: () async {
                    final reason = await _askReason(context);
                    if (reason == null || !context.mounted) return;
                    final ok = await runSubmit(context, () => api.post('/v1/complaints/$id/reopen', body: {'reason': reason}), success: 'Request reopened');
                    if (ok) await reload();
                  },
                  icon: const Icon(Icons.replay),
                  label: const Text('Problem is back — reopen'),
                ),
              ),
          ]);
        },
      ),
    );
  }

  Future<String?> _askReason(BuildContext context) {
    final text = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Reopen request'),
        content: TextField(controller: text, maxLines: 3, maxLength: 500, decoration: const InputDecoration(labelText: 'What is wrong?')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (text.text.trim().isNotEmpty) Navigator.pop(c, text.text.trim());
            },
            child: const Text('Reopen'),
          ),
        ],
      ),
    );
  }
}
