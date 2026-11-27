import 'dart:io';

import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../util/location.dart';
import '../../widgets/voice_field.dart';

/// My tickets (design: tabs All / New / In Progress / Today), or the completed history.
class TicketsScreen extends ConsumerWidget {
  const TicketsScreen({super.key, this.completed = false});

  final bool completed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(apiClientProvider);
    if (completed) {
      return Scaffold(
        appBar: AppBar(title: const Text('Completed jobs')),
        body: _TicketList(load: () => api.page('/v1/complaints', query: {'status': 'closed', 'limit': 50})),
      );
    }
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('My tickets'),
          bottom: const TabBar(
            isScrollable: true,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white70,
            indicatorColor: EcoColors.orange,
            tabs: [Tab(text: 'All'), Tab(text: 'New'), Tab(text: 'In Progress'), Tab(text: 'Today')],
          ),
        ),
        body: TabBarView(children: [
          _TicketList(load: () => api.page('/v1/complaints', query: {'limit': 50}), hideClosed: true),
          _TicketList(load: () => api.page('/v1/complaints', query: {'status': 'assigned', 'limit': 50})),
          _TicketList(load: () => api.page('/v1/complaints', query: {'status': 'in_progress', 'limit': 50})),
          _TicketList(load: () => api.page('/v1/complaints', query: {'scheduledDate': todayIst(), 'limit': 50}), hideClosed: true),
        ]),
      ),
    );
  }
}

class _TicketList extends StatelessWidget {
  const _TicketList({required this.load, this.hideClosed = false});

  final Future<Paged> Function() load;
  final bool hideClosed;

  bool _keep(Map<String, dynamic> t) => !hideClosed || t['status'] != 'closed';

  @override
  Widget build(BuildContext context) {
    return Loader<Paged>(
      load: load,
      isEmpty: (p) => p.items.where(_keep).isEmpty,
      empty: const EmptyView(text: 'No tickets here', hint: 'Your support manager assigns complaints to you.', icon: Icons.assignment_turned_in_outlined),
      builder: (context, p, reload) => ListView(padding: const EdgeInsets.all(14), children: [
        for (final t in p.items.where(_keep))
          EcoCard(
            onTap: () async {
              await context.push('/tickets/${t['id']}');
              await reload();
            },
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              CircleAvatar(
                backgroundColor: const Color(0xFFEAF0FF),
                child: Icon(t['productCategory'] == 'battery' ? Icons.battery_alert : Icons.electrical_services, color: EcoColors.blue),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(words(t['category']), style: const TextStyle(fontWeight: FontWeight.w700))),
                    Text('#${t['complaintNo']}', style: const TextStyle(fontSize: 11, color: EcoColors.muted)),
                  ]),
                  Text('${t['customerName']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  Row(children: [
                    const Icon(Icons.location_on_outlined, size: 14, color: EcoColors.muted),
                    Expanded(child: Text('${t['city'] ?? t['serviceAddress'] ?? ''}', style: const TextStyle(color: EcoColors.muted, fontSize: 12), overflow: TextOverflow.ellipsis)),
                    if (t['scheduledDate'] != null) Text(inDate(t['scheduledDate']), style: const TextStyle(color: EcoColors.muted, fontSize: 12)),
                  ]),
                ]),
              ),
              const SizedBox(width: 6),
              StatusChip('${t['status']}'),
            ]),
          ),
      ]),
    );
  }
}

/// Ticket detail: customer, product, address and call; GPS check-in; service report;
/// customer OTP to complete the service.
class TicketDetailScreen extends ConsumerStatefulWidget {
  const TicketDetailScreen({super.key, required this.id});

  final String id;

  @override
  ConsumerState<TicketDetailScreen> createState() => _TicketDetailScreenState();
}

class _TicketDetailScreenState extends ConsumerState<TicketDetailScreen> {
  final _loader = GlobalKey<LoaderState<Map<String, dynamic>>>();
  final _form = GlobalKey<FormState>();
  final _diagnosis = TextEditingController();
  final _action = TextEditingController();
  final _notes = TextEditingController();
  final _further = TextEditingController();
  final _otp = TextEditingController();
  String _lang = 'hi';
  String _outcome = 'resolved';
  List<File> _photos = [];
  final Map<String, String> _uploaded = {};
  bool _busy = false;
  bool _otpSent = false;
  bool _otpVerified = false;

  ApiClient get _api => ref.read(apiClientProvider);

  Future<void> _do(Future<void> Function() work, String success) async {
    setState(() => _busy = true);
    await runSubmit(context, work, success: success);
    if (mounted) setState(() => _busy = false);
    await _loader.currentState?.reload();
  }

  Future<void> _checkIn() => _do(() async {
        final fix = await currentFix(context);
        try {
          await _api.post('/v1/complaints/${widget.id}/check-in', body: {'lat': fix.latitude, 'lng': fix.longitude, 'accuracy': fix.accuracy, 'timestamp': DateTime.now().toUtc().toIso8601String()});
        } on ApiException catch (e) {
          // A retry after a lost response: the first check-in already started the job.
          if (e.status != 409 || !e.message.contains('is in progress and cannot be checked in')) rethrow;
        }
      }, 'Checked in at the customer site');

  Future<void> _report() async {
    if (!_form.currentState!.validate()) return;
    await _do(() async {
      for (final f in _photos) {
        if (!_uploaded.containsKey(f.path)) _uploaded[f.path] = await _api.uploadPrivate(f, 'photo');
      }
      try {
        await _api.post('/v1/complaints/${widget.id}/service-report', body: {
          'diagnosis': _diagnosis.text.trim(),
          'actionTaken': _action.text.trim(),
          if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
          'transcriptLang': _lang,
          'photos': [for (final f in _photos) _uploaded[f.path]],
          'outcome': _outcome,
          if (_further.text.trim().isNotEmpty) 'furtherAction': _further.text.trim(),
        });
      } on ApiException catch (e) {
        // A retry after a lost response: the first try already moved the job to resolved / pending.
        // Any other state (e.g. reassigned meanwhile) is a real error and is shown.
        final alreadyReported = e.message.contains('is resolved and cannot be reported') || e.message.contains('is pending and cannot be reported');
        if (e.status != 409 || !alreadyReported) rethrow;
      }
    }, _outcome == 'resolved' ? 'Report submitted. Now request the customer OTP.' : 'Report submitted. The job stays pending.');
  }

  Future<void> _sendOtp() async {
    setState(() => _busy = true);
    final ok = await runSubmit(context, () => _api.post('/v1/complaints/${widget.id}/send-otp'), success: 'OTP sent to the customer on WhatsApp');
    if (mounted) setState(() {
          _busy = false;
          if (ok) _otpSent = true;
        });
  }

  Future<void> _verifyAndClose() async {
    if (!RegExp(r'^\d{6}$').hasMatch(_otp.text.trim())) {
      showSnack(context, 'Enter the 6-digit OTP from the customer', error: true);
      return;
    }
    setState(() => _busy = true);
    final ok = await runSubmit(context, () async {
      if (!_otpVerified) {
        await _api.post('/v1/complaints/${widget.id}/verify-otp', body: {'otp': _otp.text.trim()});
        _otpVerified = true;
      }
      await _api.post('/v1/complaints/${widget.id}/close');
    }, success: 'Service completed');
    if (mounted) setState(() => _busy = false);
    if (ok) await _loader.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ticket details')),
      body: Loader<Map<String, dynamic>>(
        key: _loader,
        load: () async => ((await _api.get('/v1/complaints/${widget.id}')) as Map).cast<String, dynamic>(),
        builder: (context, c, reload) {
          final status = '${c['status']}';
          final reports = (c['reports'] as List? ?? []).cast<Map>();
          return ListView(padding: const EdgeInsets.all(14), children: [
            EcoCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Text('#${c['complaintNo']}', style: const TextStyle(fontWeight: FontWeight.w800, color: EcoColors.blue)),
                  const Spacer(),
                  StatusChip(status),
                ]),
                const SizedBox(height: 4),
                Text(words(c['category']), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                const Divider(height: 20),
                Row(children: [
                  const Icon(Icons.person_outline, color: EcoColors.blue),
                  const SizedBox(width: 8),
                  Expanded(child: Text('${c['customerName']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                  IconButton.filledTonal(onPressed: () => openPhone('${c['contact'] ?? c['customerMobile']}'), icon: const Icon(Icons.call, color: EcoColors.green)),
                  IconButton.filledTonal(onPressed: () => openWhatsApp('91${c['customerMobile']}'), icon: const Icon(Icons.chat, color: EcoColors.green)),
                ]),
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Icon(Icons.location_on_outlined, color: EcoColors.blue),
                  const SizedBox(width: 8),
                  Expanded(child: Text('${c['serviceAddress']}')),
                  TextButton.icon(onPressed: () => openMaps('${c['serviceAddress']}'), icon: const Icon(Icons.map_outlined), label: const Text('Map')),
                ]),
                InfoRow('Product', '${words(c['productCategory'])} · ${c['model']}', icon: Icons.inventory_2_outlined),
                InfoRow('Serial no.', '${c['serialNo']}', icon: Icons.qr_code),
                InfoRow('Warranty', words(c['warrantyStatus']), icon: Icons.verified_user_outlined),
                InfoRow('Created on', inDateTime(c['createdAt']), icon: Icons.event),
                const SizedBox(height: 6),
                const Text('Issue details', style: TextStyle(fontWeight: FontWeight.w700)),
                Text('${c['description']}'),
              ]),
            ),
            if (status == 'assigned' || status == 'pending')
              ElevatedButton.icon(onPressed: _busy ? null : _checkIn, icon: const Icon(Icons.my_location), label: Text(_busy ? 'Getting location…' : 'Check-in (GPS) & start service')),
            if (status == 'in_progress') _reportForm(),
            if (status == 'resolved') _otpCard(),
            if (status == 'closed')
              const EcoCard(color: Color(0xFFEFFAF3), child: Row(children: [Icon(Icons.verified, color: EcoColors.green), SizedBox(width: 8), Text('Service completed with customer OTP', style: TextStyle(fontWeight: FontWeight.w700))])),
            if (reports.isNotEmpty) ...[
              const SectionTitle('Service reports'),
              for (final r in reports)
                EcoCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(inDateTime(r['submittedAt']), style: const TextStyle(color: EcoColors.muted, fontSize: 12)),
                    InfoRow('Diagnosis', '${r['diagnosis']}'),
                    InfoRow('Action taken', '${r['actionTaken']}'),
                    if (r['furtherAction'] != null) InfoRow('Further action', '${r['furtherAction']}'),
                  ]),
                ),
            ],
          ]);
        },
      ),
    );
  }

  Widget _reportForm() {
    return Form(
      key: _form,
      child: EcoCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Service update', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          TextFormField(controller: _diagnosis, maxLength: 2000, decoration: const InputDecoration(labelText: 'Diagnosis *'), validator: (v) => (v ?? '').trim().isEmpty ? 'Required' : null),
          TextFormField(controller: _action, maxLength: 2000, maxLines: 2, decoration: const InputDecoration(labelText: 'Work done / action taken *'), validator: (v) => (v ?? '').trim().isEmpty ? 'Required' : null),
          VoiceTextField(controller: _notes, label: 'Notes', onLanguage: (l) => _lang = l),
          const Text('Photos', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          PhotoStrip(files: _photos, max: 10, onChanged: (f) => setState(() => _photos = f)),
          const SizedBox(height: 12),
          SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'resolved', label: Text('Resolved'), icon: Icon(Icons.check)), ButtonSegment(value: 'pending', label: Text('Needs more work'), icon: Icon(Icons.hourglass_bottom))],
            selected: {_outcome},
            onSelectionChanged: (s) => setState(() => _outcome = s.first),
          ),
          const SizedBox(height: 10),
          TextFormField(
            controller: _further,
            maxLength: 1000,
            decoration: InputDecoration(labelText: _outcome == 'pending' ? 'Further action required *' : 'Further action (optional)'),
            validator: (v) => _outcome == 'pending' && (v ?? '').trim().isEmpty ? 'Say what is still needed' : null,
          ),
          ElevatedButton(onPressed: _busy ? null : _report, child: Text(_busy ? 'Submitting…' : 'Submit report')),
        ]),
      ),
    );
  }

  Widget _otpCard() {
    return EcoCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Collect customer confirmation (OTP)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        const Text('The customer receives a 6-digit code on WhatsApp and reads it to you. It is valid for 10 minutes; 5 wrong tries lock it.', style: TextStyle(color: EcoColors.muted)),
        const SizedBox(height: 10),
        OutlinedButton.icon(onPressed: _busy ? null : _sendOtp, icon: const Icon(Icons.sms_outlined), label: Text(_otpSent ? 'Send OTP again' : 'Request customer OTP')),
        const SizedBox(height: 10),
        TextField(controller: _otp, keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(labelText: 'Enter OTP', prefixIcon: Icon(Icons.password))),
        ElevatedButton.icon(onPressed: _busy ? null : _verifyAndClose, icon: const Icon(Icons.task_alt), label: Text(_busy ? 'Checking…' : 'Complete service')),
      ]),
    );
  }
}
