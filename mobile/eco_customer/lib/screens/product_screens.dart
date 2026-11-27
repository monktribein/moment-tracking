import 'dart:io';

import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Warranty labels. The warranty is reviewed by hand from the purchase proof (no end date is
/// stored), so the tabs are "Under warranty / Review pending / Not covered" rather than dates.
const warrantyLabels = {'eligible': 'Under warranty', 'pending': 'Warranty review pending', 'not_eligible': 'Not covered'};

/// My products with their warranty status (design: tabs and product cards).
class MyProductsScreen extends ConsumerWidget {
  const MyProductsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(apiClientProvider);
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('My products'),
          bottom: const TabBar(
            isScrollable: true,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white70,
            indicatorColor: EcoColors.orange,
            tabs: [Tab(text: 'All'), Tab(text: 'Under warranty'), Tab(text: 'Review pending'), Tab(text: 'Not covered')],
          ),
        ),
        floatingActionButton: FloatingActionButton.extended(
          backgroundColor: EcoColors.orange,
          foregroundColor: Colors.white,
          onPressed: () => context.push('/products/new'),
          icon: const Icon(Icons.add),
          label: const Text('Register product'),
        ),
        body: TabBarView(children: [
          for (final status in [null, 'eligible', 'pending', 'not_eligible']) _ProductList(load: () => api.page('/v1/customer-products', query: {'limit': 100, 'warrantyStatus': status})),
        ]),
      ),
    );
  }
}

class _ProductList extends StatelessWidget {
  const _ProductList({required this.load});

  final Future<Paged> Function() load;

  @override
  Widget build(BuildContext context) {
    return Loader<Paged>(
      load: load,
      isEmpty: (p) => p.items.isEmpty,
      empty: const EmptyView(text: 'No products here', hint: 'Register your Eco Sor inverter or battery to raise service requests.', icon: Icons.inventory_2_outlined),
      builder: (context, p, reload) => ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 90), children: [
        for (final x in p.items)
          EcoCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(color: const Color(0xFFEAF0FF), borderRadius: BorderRadius.circular(12)),
                  child: Icon(x['category'] == 'battery' ? Icons.battery_charging_full : Icons.electrical_services, color: EcoColors.blue, size: 30),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${words(x['category'])} · ${x['model']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    Text('S/N: ${x['serialNo']}', style: const TextStyle(color: EcoColors.muted)),
                    if (x['purchaseDate'] != null) Text('Purchased: ${inDate(x['purchaseDate'])}', style: const TextStyle(color: EcoColors.muted)),
                    const SizedBox(height: 6),
                    StatusChip('${x['warrantyStatus']}', label: warrantyLabels['${x['warrantyStatus']}']),
                  ]),
                ),
              ]),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(onPressed: () => context.push('/complaints/new?product=${x['id']}'), icon: const Icon(Icons.build_outlined), label: const Text('Raise service request')),
              ),
            ]),
          ),
      ]),
    );
  }
}

/// Register a product: type, model, serial number (typed or scanned), purchase date, seller, proof.
class RegisterProductScreen extends ConsumerStatefulWidget {
  const RegisterProductScreen({super.key});

  @override
  ConsumerState<RegisterProductScreen> createState() => _RegisterProductScreenState();
}

class _RegisterProductScreenState extends ConsumerState<RegisterProductScreen> {
  final _form = GlobalKey<FormState>();
  final _model = TextEditingController();
  final _serial = TextEditingController();
  String _category = 'inverter';
  DateTime? _purchased;
  String? _distributorId;
  List<Map<String, dynamic>> _distributors = [];
  List<File> _proof = [];
  String? _proofKey;
  bool _busy = false;

  ApiClient get _api => ref.read(apiClientProvider);

  @override
  void initState() {
    super.initState();
    _api.get('/v1/customer-products/distributors').then((r) {
      if (mounted) setState(() => _distributors = ((r as List?) ?? []).map((e) => (e as Map).cast<String, dynamic>()).toList());
    }).catchError((_) {});
  }

  Future<void> _scan() async {
    if (!await askCameraPermission(context, why: 'The camera scans the serial number barcode or QR code on your product.')) return;
    if (!mounted) return;
    final code = await context.push<String>('/scan');
    if (code != null && code.isNotEmpty && mounted) setState(() => _serial.text = code.trim());
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final ok = await runSubmit(context, () async {
      if (_proof.isNotEmpty && _proofKey == null) _proofKey = await _api.uploadPrivate(_proof.first, 'warranty');
      await _api.post('/v1/customer-products', body: {
        'category': _category,
        'model': _model.text.trim(),
        'serialNo': _serial.text.trim(),
        if (_purchased != null) 'purchaseDate': apiDay(_purchased!),
        if (_distributorId != null) 'distributorId': _distributorId,
        if (_proofKey != null) 'proofKey': _proofKey,
      });
    }, success: 'Product registered. Warranty is reviewed from your proof.');
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Register product')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          const Text('Register your Eco Sor product', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'inverter', label: Text('Inverter'), icon: Icon(Icons.electrical_services)),
              ButtonSegment(value: 'battery', label: Text('Battery'), icon: Icon(Icons.battery_charging_full)),
            ],
            selected: {_category},
            onSelectionChanged: (s) => setState(() => _category = s.first),
          ),
          const SizedBox(height: 14),
          TextFormField(controller: _model, decoration: const InputDecoration(labelText: 'Model *', hintText: 'As printed on the product'), validator: (v) => (v ?? '').trim().isEmpty ? 'Enter the model' : null),
          const SizedBox(height: 12),
          TextFormField(
            controller: _serial,
            decoration: const InputDecoration(labelText: 'Serial number *'),
            validator: (v) => (v ?? '').trim().isEmpty ? 'Enter or scan the serial number' : null,
          ),
          const SizedBox(height: 6),
          OutlinedButton.icon(onPressed: _scan, icon: const Icon(Icons.qr_code_scanner), label: const Text('Scan serial / QR code')),
          const SizedBox(height: 6),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.calendar_today, color: EcoColors.blue),
            title: const Text('Purchase / installation date'),
            subtitle: Text(_purchased == null ? 'Choose' : inDate(apiDay(_purchased!))),
            onTap: () async {
              final d = await showDatePicker(context: context, initialDate: DateTime.now(), firstDate: DateTime(2010), lastDate: DateTime.now());
              if (d != null) setState(() => _purchased = d);
            },
          ),
          DropdownButtonFormField<String?>(
            value: _distributorId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Dealer / distributor (optional)'),
            items: [
              const DropdownMenuItem<String?>(value: null, child: Text('Not sure')),
              for (final d in _distributors) DropdownMenuItem<String?>(value: d['id'] as String, child: Text('${d['firmName']}${d['city'] != null ? ', ${d['city']}' : ''}', overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (v) => setState(() => _distributorId = v),
          ),
          const SizedBox(height: 14),
          const Text('Warranty card / purchase bill photo', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          PhotoStrip(files: _proof, max: 1, label: 'Proof', onChanged: (f) => setState(() {
                _proof = f;
                _proofKey = null;
              })),
          const SizedBox(height: 4),
          const Text('Eco Sor checks your proof by hand and confirms the warranty.', style: TextStyle(fontSize: 12, color: EcoColors.muted)),
          const SizedBox(height: 20),
          ElevatedButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Registering…' : 'Register product')),
        ]),
      ),
    );
  }
}

/// Full-screen barcode / QR scanner; returns the first code read.
class ScanSerialScreen extends StatefulWidget {
  const ScanSerialScreen({super.key});

  @override
  State<ScanSerialScreen> createState() => _ScanSerialScreenState();
}

class _ScanSerialScreenState extends State<ScanSerialScreen> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan serial / QR code')),
      body: Stack(children: [
        MobileScanner(
          onDetect: (capture) {
            if (_done) return;
            final codes = capture.barcodes.map((b) => b.rawValue).whereType<String>().where((v) => v.trim().isNotEmpty);
            if (codes.isEmpty) return;
            _done = true;
            context.pop(codes.first);
          },
        ),
        Center(
          child: Container(
            width: 260,
            height: 160,
            decoration: BoxDecoration(border: Border.all(color: EcoColors.orange, width: 3), borderRadius: BorderRadius.circular(14)),
          ),
        ),
        const Positioned(
          left: 0,
          right: 0,
          bottom: 40,
          child: Text('Point the camera at the barcode or QR code on the product label', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, shadows: [Shadow(blurRadius: 6)])),
        ),
      ]),
    );
  }
}
