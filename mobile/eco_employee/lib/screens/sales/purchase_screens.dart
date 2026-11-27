import 'dart:io';

import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

const paymentMethods = {'upi': 'UPI', 'neft': 'NEFT', 'rtgs': 'RTGS', 'imps': 'IMPS', 'bank_transfer': 'Bank transfer', 'cheque': 'Cheque', 'cash': 'Cash deposit'};

/// My purchase requests.
class RequestsScreen extends ConsumerStatefulWidget {
  const RequestsScreen({super.key});

  @override
  ConsumerState<RequestsScreen> createState() => _RequestsScreenState();
}

class _RequestsScreenState extends ConsumerState<RequestsScreen> {
  final _loader = GlobalKey<LoaderState<Paged>>();

  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('My orders')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: EcoColors.orange,
        foregroundColor: Colors.white,
        onPressed: () async {
          await context.push('/requests/new');
          await _loader.currentState?.reload();
        },
        icon: const Icon(Icons.add_shopping_cart),
        label: const Text('New request'),
      ),
      body: Loader<Paged>(
        key: _loader,
        load: () => api.page('/v1/purchase-requests', query: {'limit': 50}),
        isEmpty: (p) => p.items.isEmpty,
        empty: const EmptyView(text: 'No purchase requests yet', icon: Icons.shopping_cart_outlined),
        builder: (context, p, reload) => ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 90), children: [
          for (final r in p.items)
            EcoCard(
              onTap: () async {
                await context.push('/requests/${r['id']}');
                await reload();
              },
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${r['requestNo']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                    Text('${r['distributorName']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text('${inDateTime(r['createdAt'])} · ${r['totalQuantity'] ?? 0} unit(s)', style: const TextStyle(color: EcoColors.muted, fontSize: 12)),
                  ]),
                ),
                Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  StatusChip('${r['status']}'),
                  const SizedBox(height: 4),
                  Text('Payment: ${words(r['paymentStatus'])}', style: const TextStyle(fontSize: 11, color: EcoColors.muted)),
                ]),
              ]),
            ),
        ]),
      ),
    );
  }
}

class _Line {
  _Line(this.product, this.qty);
  final Map<String, dynamic> product;
  int qty;
}

/// New purchase request (or a correction): distributor → products → payment & proof → submit.
/// Each step that already reached the server is not repeated on retry, and the same
/// Idempotency-Key is sent, so a retry after "no internet" never creates a second request.
class NewRequestScreen extends ConsumerStatefulWidget {
  const NewRequestScreen({super.key, this.distributorId, this.correctId});

  final String? distributorId;
  final String? correctId;

  @override
  ConsumerState<NewRequestScreen> createState() => _NewRequestScreenState();
}

class _NewRequestScreenState extends ConsumerState<NewRequestScreen> {
  final _key = SubmitKey();
  int _step = 0;
  Map<String, dynamic>? _distributor;
  List<Map<String, dynamic>> _products = [];
  final List<_Line> _lines = [];
  final _amount = TextEditingController();
  final _utr = TextEditingController();
  final _remarks = TextEditingController();
  String _method = 'upi';
  DateTime _paidOn = DateTime.now();
  File? _proof;
  String? _createdId;
  bool _paid = false;
  bool _busy = false;
  bool _loading = true;
  String? _loadError;
  String? _rejection;

  ApiClient get _api => ref.read(apiClientProvider);
  bool get _correcting => widget.correctId != null;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final products = await _api.page('/v1/products', query: {'limit': 100, 'sort': 'name', 'order': 'asc'});
      _products = products.items.where((p) => p['isActive'] == true).toList();
      if (_correcting) {
        final r = ((await _api.get('/v1/purchase-requests/${widget.correctId}')) as Map).cast<String, dynamic>();
        _createdId = r['id'] as String;
        _distributor = {'id': r['distributorId'], 'firmName': r['distributorName']};
        _rejection = (r['payment'] as Map?)?['rejectionReason'] as String?;
        _remarks.text = (r['remarks'] ?? '').toString();
        for (final i in (r['items'] as List)) {
          final p = _products.firstWhere((p) => p['id'] == i['productId'], orElse: () => {'id': i['productId'], 'name': (i['productSnapshot'] as Map?)?['name'] ?? 'Product', 'model': '', 'sku': ''});
          _lines.add(_Line(p, (i['quantity'] as num).toInt()));
        }
        _step = 1;
      } else if (widget.distributorId != null) {
        _distributor = ((await _api.get('/v1/distributors/${widget.distributorId}')) as Map).cast<String, dynamic>();
        _step = 1;
      }
    } catch (e) {
      _loadError = e.toString();
    }
    if (mounted) setState(() => _loading = false);
  }

  int get _units => _lines.fold(0, (s, l) => s + l.qty);

  Future<void> _pickDistributor() async {
    final list = await _api.page('/v1/distributors', query: {'limit': 100, 'active': 'true', 'sort': 'firmName', 'order': 'asc'});
    if (!mounted) return;
    final d = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (c) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.8,
        builder: (_, scroll) => ListView(controller: scroll, children: [
          const ListTile(title: Text('Choose distributor', style: TextStyle(fontWeight: FontWeight.w700)), subtitle: Text('Only distributors assigned to you')),
          for (final x in list.items) ListTile(title: Text('${x['firmName']}'), subtitle: Text('${x['city'] ?? ''}'), onTap: () => Navigator.pop(c, x)),
        ]),
      ),
    );
    if (d != null) setState(() => _distributor = d);
  }

  Future<void> _addProduct() async {
    final p = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (c) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.8,
        builder: (_, scroll) => ListView(controller: scroll, children: [
          const ListTile(title: Text('Add product', style: TextStyle(fontWeight: FontWeight.w700))),
          for (final x in _products.where((x) => !_lines.any((l) => l.product['id'] == x['id'])))
            ListTile(
              leading: Icon(x['category'] == 'battery' ? Icons.battery_charging_full : Icons.electrical_services, color: EcoColors.blue),
              title: Text('${x['name']}'),
              subtitle: Text('${x['model']} · ${x['sku']}'),
              trailing: const Icon(Icons.add_circle, color: EcoColors.blue),
              onTap: () => Navigator.pop(c, x),
            ),
        ]),
      ),
    );
    if (p != null) setState(() => _lines.add(_Line(p, 1)));
  }

  String? _paymentProblem() {
    final amount = double.tryParse(_amount.text.trim());
    if (amount == null || amount <= 0 || !RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(_amount.text.trim())) return 'Enter the amount paid';
    if (_utr.text.replaceAll(RegExp(r'[^A-Za-z0-9]'), '').length < 6) return 'Enter the transaction ID / UTR (6+ letters or digits)';
    if (_proof == null) return 'Attach the payment proof photo';
    return null;
  }

  Future<void> _submit() async {
    final problem = _paymentProblem();
    if (problem != null) {
      showSnack(context, problem, error: true);
      return;
    }
    setState(() => _busy = true);
    final items = [for (final l in _lines) {'productId': l.product['id'], 'quantity': l.qty}];
    String? doneId;
    await runSubmit(context, () async {
      if (_createdId == null) {
        final r = (await _api.post('/v1/purchase-requests', headers: {'Idempotency-Key': _key.value}, body: {
          'distributorId': _distributor!['id'],
          'items': items,
          'source': 'android',
          if (_remarks.text.trim().isNotEmpty) 'remarks': _remarks.text.trim(),
        })) as Map;
        _createdId = (r['request'] as Map)['id'] as String;
      } else if (_correcting && !_paid) {
        await _api.patch('/v1/purchase-requests/$_createdId/draft', body: {'items': items, 'remarks': _remarks.text.trim()});
      }
      if (!_paid) {
        await _api.upload('/v1/purchase-requests/$_createdId/payment-proof', _proof!, fields: {
          'amount': _amount.text.trim(),
          'method': _method,
          'paymentDate': apiDay(_paidOn),
          'utr': _utr.text.trim(),
        });
        _paid = true;
      }
      try {
        // Submit is a no-op when repeated; resubmit is not, so its retry is recognised here.
        await _api.post('/v1/purchase-requests/$_createdId/${_correcting ? 'resubmit' : 'submit'}', headers: {'Idempotency-Key': _key.value});
      } on ApiException catch (e) {
        final alreadyResubmitted = _correcting && e.status == 409 && e.message.contains('is under review and cannot be resubmitted');
        if (!alreadyResubmitted) rethrow;
      }
      doneId = _createdId;
    });
    if (!mounted) return;
    setState(() => _busy = false);
    if (doneId != null) context.pushReplacement('/requests/$doneId/done');
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (_loadError != null) return Scaffold(appBar: AppBar(), body: ErrorView(error: _loadError!, onRetry: () => setState(() {
          _loading = true;
          _loadError = null;
          _init();
        })));
    return Scaffold(
      appBar: AppBar(title: Text(_correcting ? 'Correct request' : 'Purchase request')),
      body: Stepper(
        currentStep: _step,
        onStepTapped: (s) => setState(() => _step = s.clamp(_correcting ? 1 : 0, 2)),
        controlsBuilder: (context, details) => const SizedBox.shrink(),
        steps: [
          Step(
            title: const Text('Distributor'),
            subtitle: Text(_distributor == null ? 'Choose' : '${_distributor!['firmName']}'),
            isActive: _step >= 0,
            state: _distributor != null ? StepState.complete : StepState.indexed,
            content: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              OutlinedButton.icon(onPressed: _correcting ? null : _pickDistributor, icon: const Icon(Icons.storefront), label: Text(_distributor == null ? 'Choose distributor' : '${_distributor!['firmName']}')),
              const SizedBox(height: 10),
              ElevatedButton(onPressed: _distributor == null ? null : () => setState(() => _step = 1), child: const Text('Next')),
            ]),
          ),
          Step(
            title: const Text('Products'),
            subtitle: Text('${_lines.length} product(s) · $_units unit(s)'),
            isActive: _step >= 1,
            state: _lines.isNotEmpty ? StepState.complete : StepState.indexed,
            content: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (final l in _lines)
                EcoCard(
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${l.product['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text('${l.product['model']} · ${l.product['sku']}', style: const TextStyle(color: EcoColors.muted, fontSize: 12)),
                      ]),
                    ),
                    IconButton(
                      onPressed: () => setState(() {
                        if (l.qty > 1) {
                          l.qty--;
                        } else {
                          _lines.remove(l);
                        }
                      }),
                      icon: Icon(l.qty > 1 ? Icons.remove_circle_outline : Icons.delete_outline),
                    ),
                    Text('${l.qty}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                    IconButton(onPressed: () => setState(() => l.qty++), icon: const Icon(Icons.add_circle, color: EcoColors.blue)),
                  ]),
                ),
              OutlinedButton.icon(onPressed: _addProduct, icon: const Icon(Icons.add), label: const Text('Add product')),
              const SizedBox(height: 8),
              TextField(controller: _remarks, maxLength: 1000, decoration: const InputDecoration(labelText: 'Remarks (optional)')),
              ElevatedButton(onPressed: _lines.isEmpty ? null : () => setState(() => _step = 2), child: const Text('Next')),
            ]),
          ),
          Step(
            title: const Text('Payment & proof'),
            isActive: _step >= 2,
            content: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (_rejection != null)
                Container(
                  padding: const EdgeInsets.all(10),
                  margin: const EdgeInsets.only(bottom: 10),
                  decoration: BoxDecoration(color: EcoColors.red.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
                  child: Text('Previous payment rejected: $_rejection', style: const TextStyle(color: EcoColors.red)),
                ),
              TextField(controller: _amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount paid (₹)', prefixText: '₹ ')),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _method,
                decoration: const InputDecoration(labelText: 'Method'),
                items: [for (final e in paymentMethods.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
                onChanged: (v) => setState(() => _method = v ?? _method),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.calendar_today, color: EcoColors.blue),
                title: const Text('Payment date'),
                subtitle: Text(inDate(apiDay(_paidOn))),
                onTap: () async {
                  final d = await showDatePicker(context: context, initialDate: _paidOn, firstDate: DateTime.now().subtract(const Duration(days: 60)), lastDate: DateTime.now());
                  if (d != null) setState(() => _paidOn = d);
                },
              ),
              TextField(controller: _utr, maxLength: 60, decoration: const InputDecoration(labelText: 'Transaction ID / UTR')),
              const Text('Payment proof (JPG/PNG, up to 5 MB, kept private)', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              PhotoStrip(files: _proof == null ? [] : [_proof!], max: 1, label: 'Proof', onChanged: (f) => setState(() {
                    _proof = f.isEmpty ? null : f.first;
                    _paid = false;
                  })),
              const SizedBox(height: 14),
              ElevatedButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Sending…' : (_correcting ? 'Resubmit request' : 'Submit request'))),
            ]),
          ),
        ],
      ),
    );
  }
}

/// Confirmation with the request ID.
class RequestDoneScreen extends ConsumerWidget {
  const RequestDoneScreen({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Request submitted'), automaticallyImplyLeading: false),
      body: Loader<Map>(
        load: () async => (await api.get('/v1/purchase-requests/$id')) as Map,
        builder: (context, r, _) => ListView(padding: const EdgeInsets.all(24), children: [
          const Icon(Icons.check_circle, color: EcoColors.green, size: 80),
          const SizedBox(height: 12),
          const Text('Purchase request submitted', textAlign: TextAlign.center, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text('${r['requestNo']}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: EcoColors.blue)),
          const SizedBox(height: 8),
          const Text('The payment is verified with the bank before the order is approved.', textAlign: TextAlign.center, style: TextStyle(color: EcoColors.muted)),
          const SizedBox(height: 24),
          ElevatedButton(onPressed: () => context.pushReplacement('/requests/$id'), child: const Text('View request')),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: () => context.go('/'), child: const Text('Back to home')),
        ]),
      ),
    );
  }
}

/// Request detail with payment and status timeline; correction when the payment was rejected.
class RequestDetailScreen extends ConsumerWidget {
  const RequestDetailScreen({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Request detail')),
      body: Loader<Map<String, dynamic>>(
        load: () async => {'r': await api.get('/v1/purchase-requests/$id'), 'h': await api.get('/v1/purchase-requests/$id/history')},
        builder: (context, d, reload) {
          final r = (d['r'] as Map).cast<String, dynamic>();
          final log = ((d['h'] as Map)['statusLog'] as List? ?? []).cast<Map>();
          final p = r['payment'] as Map?;
          final status = '${r['status']}';
          return ListView(padding: const EdgeInsets.all(14), children: [
            EcoCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [Expanded(child: Text('${r['requestNo']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900))), StatusChip(status)]),
                Text('${r['distributorName']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                Text('${inDateTime(r['createdAt'])} · version ${r['version']}', style: const TextStyle(color: EcoColors.muted, fontSize: 12)),
              ]),
            ),
            if (status == 'correction_required') ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: EcoColors.red.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
                child: Text('Correction required${p?['rejectionReason'] != null ? ': ${p!['rejectionReason']}' : ''}', style: const TextStyle(color: EcoColors.red, fontWeight: FontWeight.w600)),
              ),
              const SizedBox(height: 8),
              ElevatedButton.icon(
                onPressed: () async {
                  await context.push('/requests/$id/correct');
                  await reload();
                },
                icon: const Icon(Icons.edit),
                label: const Text('Correct & resubmit'),
              ),
            ],
            const SectionTitle('Track order'),
            EcoCard(
              child: TimelineList(items: [
                for (final l in log) (title: words(l['toStatus']), subtitle: '${inDateTime(l['at'])}${l['reason'] != null ? ' · ${l['reason']}' : ''}', done: true, warn: ['rejected', 'correction_required', 'cancelled'].contains(l['toStatus'])),
                if (!['processed', 'rejected', 'cancelled'].contains(status)) (title: status == 'approved' ? 'Processed' : 'Approved', subtitle: 'Waiting', done: false, warn: false),
              ]),
            ),
            const SectionTitle('Items'),
            for (final i in (r['items'] as List? ?? []))
              ListTile(tileColor: Colors.white, title: Text('${(i['productSnapshot'] as Map?)?['name']}'), subtitle: Text('${(i['productSnapshot'] as Map?)?['model']} · ${(i['productSnapshot'] as Map?)?['sku']}'), trailing: Text('× ${i['quantity']}', style: const TextStyle(fontWeight: FontWeight.w800))),
            const SectionTitle('Payment'),
            EcoCard(
              child: p == null
                  ? const Text('No payment submitted yet.')
                  : Column(children: [
                      InfoRow('Amount', inr(p['amount'])),
                      InfoRow('Method', paymentMethods[p['method']] ?? words(p['method'])),
                      InfoRow('Paid on', inDate(p['paymentDate'])),
                      InfoRow('UTR', '${p['utrRaw']}'),
                      Row(children: [const SizedBox(width: 120, child: Text('Status', style: TextStyle(color: EcoColors.muted))), StatusChip('${p['status']}')]),
                    ]),
            ),
          ]);
        },
      ),
    );
  }
}
