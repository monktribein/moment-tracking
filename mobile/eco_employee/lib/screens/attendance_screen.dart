import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../util/location.dart';

/// Daily attendance (design: "Attendance" screen): GPS check-in/out card, work hours, history.
class AttendanceScreen extends ConsumerStatefulWidget {
  const AttendanceScreen({super.key});

  @override
  ConsumerState<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends ConsumerState<AttendanceScreen> {
  final _loader = GlobalKey<LoaderState<Map<String, dynamic>>>();
  bool _busy = false;

  Future<void> _mark(bool checkIn) async {
    setState(() => _busy = true);
    final api = ref.read(apiClientProvider);
    await runSubmit(context, () async {
      final fix = await currentFix(context);
      try {
        await api.post('/v1/attendance/${checkIn ? 'check-in' : 'check-out'}', body: {'lat': fix.latitude, 'lng': fix.longitude, 'accuracy': fix.accuracy, 'mode': 'field'});
      } on ApiException catch (e) {
        // Already done (e.g. a retry after a lost response): nothing to repeat.
        if (e.status != 409 || !e.message.toLowerCase().contains('already')) rethrow;
      }
    }, success: checkIn ? 'Checked in' : 'Checked out');
    if (mounted) setState(() => _busy = false);
    await _loader.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance')),
      body: Loader<Map<String, dynamic>>(
        key: _loader,
        load: () async => {
          'today': await api.get('/v1/attendance/today'),
          'history': await api.page('/v1/attendance/history', query: {'limit': 30}),
        },
        builder: (context, d, reload) {
          final today = d['today'] as Map?;
          final history = (d['history'] as Paged).items;
          final checkedIn = today?['checkedIn'] == true;
          final checkedOut = today?['checkedOut'] == true;
          final start = DateTime.tryParse('${today?['checkInTime'] ?? ''}');
          final minutes = checkedOut ? (today?['totalWorkingMinutes'] as num?) : (start == null ? null : DateTime.now().difference(start.toLocal()).inMinutes);
          return ListView(padding: const EdgeInsets.all(14), children: [
            EcoCard(
              color: checkedIn ? const Color(0xFFEFFAF3) : null,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Icon(checkedIn ? Icons.check_circle : Icons.radio_button_unchecked, color: checkedIn ? EcoColors.green : EcoColors.muted, size: 30),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(checkedOut ? 'Checked out' : (checkedIn ? 'Checked in' : 'Not checked in'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: EcoColors.green)),
                      Text(checkedIn ? 'Today, ${inTime(today?['checkInTime'])}' : inDate(todayIst()), style: const TextStyle(color: EcoColors.muted)),
                    ]),
                  ),
                  const Icon(Icons.location_on, color: EcoColors.blue),
                ]),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: StatTile(label: 'Work hours', value: hoursText(minutes), icon: Icons.schedule, color: EcoColors.blue)),
                  const SizedBox(width: 8),
                  Expanded(child: StatTile(label: 'Check-out', value: checkedOut ? inTime(today?['checkOutTime']) : '—', icon: Icons.logout, color: EcoColors.orange)),
                ]),
                const SizedBox(height: 8),
                if (!checkedIn)
                  ElevatedButton.icon(onPressed: _busy ? null : () => _mark(true), icon: const Icon(Icons.login), label: Text(_busy ? 'Getting location…' : 'Check-in (GPS)'))
                else if (!checkedOut)
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(foregroundColor: EcoColors.red, side: const BorderSide(color: EcoColors.red)),
                    onPressed: _busy ? null : () => _mark(false),
                    icon: const Icon(Icons.logout),
                    label: Text(_busy ? 'Getting location…' : 'Check-out'),
                  )
                else
                  const Text('Attendance complete for today.', style: TextStyle(color: EcoColors.muted)),
                const SizedBox(height: 4),
                const Text('Your location is recorded only at check-in and check-out.', style: TextStyle(fontSize: 12, color: EcoColors.muted)),
              ]),
            ),
            const SectionTitle('History'),
            if (history.isEmpty) const EmptyView(text: 'No attendance yet'),
            for (final a in history)
              EcoCard(
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(inDate(a['date']), style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text('In ${inTime(a['checkInTime'])} · Out ${a['checkOutTime'] == null ? '—' : inTime(a['checkOutTime'])}', style: const TextStyle(color: EcoColors.muted)),
                    ]),
                  ),
                  Text(a['totalWorkingMinutes'] == null ? '' : hoursText(a['totalWorkingMinutes'] as num), style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(width: 8),
                  StatusChip('${a['status']}'),
                ]),
              ),
          ]);
        },
      ),
    );
  }
}
