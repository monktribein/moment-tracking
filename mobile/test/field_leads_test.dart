import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:movement_tracking/api/api_client.dart';
import 'package:movement_tracking/api/api_service.dart';
import 'package:movement_tracking/models/lead.dart';
import 'package:movement_tracking/screens/field/field_leads_screen.dart';
import 'package:movement_tracking/services/voice_note_service.dart';
import 'package:movement_tracking/theme/app_theme.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _capturedUtc = DateTime.now().toUtc().subtract(
  const Duration(minutes: 5),
);

class _FakeApi extends ApiService {
  _FakeApi() : super(ApiClient());

  @override
  Future<List<Lead>> fieldGetLeads({String? search, String? status}) async => [
    Lead.fromJson({
      '_id': 'lead-1',
      'name': 'Radhe Guest House',
      'contact': {'ownerName': 'Shyam', 'phone': '9876500000'},
      'location': {'city': 'Mathura', 'district': 'Mathura'},
      'status': 'pending',
      'capturedAt': _capturedUtc.toIso8601String(),
    }),
  ];
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    VoiceNoteStore.instance.resetForTest();
  });

  test('lead times are converted from the server\'s UTC to local time', () {
    final lead = Lead.fromJson({
      '_id': 'x',
      'capturedAt': '2026-11-24T05:17:00.000Z',
    });
    expect(lead.capturedAt.isUtc, isFalse);
    expect(lead.capturedAt, DateTime.utc(2026, 11, 24, 5, 17).toLocal());
  });

  testWidgets('My Leads shows local times and opens lead details', (
    tester,
  ) async {
    final messenger = tester.binding.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('moment/voice_notes'),
      (call) async => call.method == 'listFiles' ? <Object>[] : null,
    );
    messenger.setMockStreamHandler(
      const EventChannel('moment/voice_notes/events'),
      MockStreamHandler.inline(onListen: (args, events) {}),
    );
    tester.view.physicalSize = const Size(400 * 3, 900 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      Provider<ApiService>.value(
        value: _FakeApi(),
        child: MaterialApp(
          theme: AppTheme.light,
          home: const FieldLeadsScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final localTime = DateFormat('hh:mm a').format(_capturedUtc.toLocal());
    expect(find.textContaining(localTime), findsOneWidget);

    // Lead details: used to fail with "Trailing widget consumes the entire
    // tile width" because the Call button inherited a full-width style.
    await tester.tap(find.text('Radhe Guest House'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Call'), findsOneWidget);
    expect(find.text('Voice Notes'), findsOneWidget);
  });
}
