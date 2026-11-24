import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:movement_tracking/models/voice_note.dart';
import 'package:movement_tracking/screens/field/voice_notes_section.dart';
import 'package:movement_tracking/services/voice_note_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _methods = MethodChannel('moment/voice_notes');
const _events = EventChannel('moment/voice_notes/events');

VoiceNote _note(String id, String leadId, DateTime at) => VoiceNote(
  id: id,
  leadId: leadId,
  leadName: 'Radhe Guest House',
  agentId: 'agent-7',
  recordedAt: at,
  durationMs: 4200,
  filePath: '/data/voice_notes/$id.m4a',
  transcript: 'owner is interested in 20 rooms',
  language: 'hi-IN',
);

/// Fake Android side: records the calls and lets the test push events.
class _FakeNative {
  _FakeNative(
    this.audioFile, {
    this.stopTranscript = 'owner is interested in 20 rooms',
    this.stopProblem,
  });

  final File audioFile;
  final String stopTranscript;
  final String? stopProblem;
  final calls = <String>[];
  MockStreamHandlerEventSink? sink;

  void install(WidgetTester tester) {
    final messenger = tester.binding.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(_methods, (call) async {
      calls.add(call.method);
      switch (call.method) {
        case 'permissionStatus':
        case 'requestPermission':
          return 'granted';
        case 'start':
          return {'path': audioFile.path};
        case 'stop':
          return {
            'path': audioFile.path,
            'durationMs': 4200,
            'transcript': stopTranscript,
            'transcriptProblem': stopProblem,
            'saved': true,
          };
        case 'listFiles':
          return <Object>[];
        case 'deleteFile':
          return true;
        case 'play':
          return {'durationMs': 4200};
      }
      return null;
    });
    messenger.setMockStreamHandler(
      _events,
      MockStreamHandler.inline(
        onListen: (args, events) {
          sink = events;
        },
        onCancel: (args) {
          sink = null;
        },
      ),
    );
  }

  void emit(Map<String, Object?> event) => sink?.success(event);
}

Future<void> _pumpSection(WidgetTester tester, Widget section) async {
  tester.view.physicalSize = const Size(400 * 3, 900 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: section,
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  late Directory tmp;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    VoiceNoteStore.instance.resetForTest();
    tmp = Directory.systemTemp.createTempSync('voice_notes_test');
  });

  tearDown(() {
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  test('VoiceNote survives a JSON round trip', () {
    final note = _note('a', 'lead-1', DateTime.utc(2026, 11, 24, 10, 30));
    final back = VoiceNote.fromJson(note.toJson());
    expect(back.id, 'a');
    expect(back.leadId, 'lead-1');
    expect(back.agentId, 'agent-7');
    expect(back.recordedAt, note.recordedAt);
    expect(back.durationMs, 4200);
    expect(back.filePath, note.filePath);
    expect(back.transcript, note.transcript);
    expect(back.language, 'hi-IN');
  });

  test(
    'store keeps notes per lead, newest first, across an app restart',
    () async {
      final store = VoiceNoteStore.instance;
      await store.addAll([
        _note('old', 'lead-1', DateTime(2026, 11, 20)),
        _note('other', 'lead-2', DateTime(2026, 11, 21)),
        _note('new', 'lead-1', DateTime(2026, 11, 23)),
      ]);

      // A fresh start reads the same SharedPreferences.
      store.resetForTest();
      expect(store.isLoaded, isFalse);
      await store.load();

      expect(store.forLead('lead-1').map((n) => n.id), ['new', 'old']);
      expect(store.forLead('lead-2').map((n) => n.id), ['other']);
      expect(store.forLead('lead-3'), isEmpty);
    },
  );

  test(
    'capture-form notes are linked to the lead when it is submitted',
    () async {
      final pending = PendingVoiceNotes();
      pending.add(_note('p1', '', DateTime(2026, 11, 24)));
      expect(pending.hasUnsaved, isTrue);

      final saved = await pending.saveFor(
        leadId: 'lead-9',
        leadName: 'Shyam Ashram',
      );

      expect(saved, 1);
      expect(pending.hasUnsaved, isFalse);
      final stored = VoiceNoteStore.instance.forLead('lead-9');
      expect(stored.single.id, 'p1');
      expect(stored.single.leadName, 'Shyam Ashram');
    },
  );

  testWidgets('records with live text, saves to the lead, plays back', (
    tester,
  ) async {
    final audio = File('${tmp.path}/vn.m4a')..writeAsBytesSync([0, 1, 2]);
    final native = _FakeNative(audio)..install(tester);
    await _pumpSection(
      tester,
      const VoiceNotesSection(leadId: 'lead-1', leadName: 'Radhe Guest House'),
    );

    expect(find.text('Start Recording'), findsOneWidget);
    expect(find.text('No voice notes for this lead yet.'), findsOneWidget);

    await tester.tap(find.text('Start Recording'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(native.calls, containsAllInOrder(['permissionStatus', 'start']));
    expect(find.text('Stop Recording'), findsOneWidget);
    expect(find.textContaining('Listening'), findsOneWidget);

    // Live text arrives while the agent speaks; it only ever grows.
    native.emit({'event': 'level', 'level': 0.7});
    native.emit({
      'event': 'transcript',
      'committed': '',
      'partial': 'owner is',
    });
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.textContaining('owner is'), findsOneWidget);
    native.emit({
      'event': 'transcript',
      'committed': 'owner is interested',
      'partial': 'in 20 rooms',
    });
    await tester.pump(const Duration(milliseconds: 50));
    expect(
      find.textContaining('owner is interested in 20 rooms'),
      findsOneWidget,
    );

    await tester.tap(find.text('Stop Recording'));
    await tester.pumpAndSettle();
    expect(native.calls, contains('stop'));
    expect(find.text('Start Recording'), findsOneWidget);
    expect(find.text('Voice note saved on this phone.'), findsOneWidget);
    expect(find.text('Saved Recordings'), findsOneWidget);

    // Saved under the right lead, with the full transcript, on the phone.
    final stored = VoiceNoteStore.instance.forLead('lead-1');
    expect(stored, hasLength(1));
    expect(stored.single.transcript, 'owner is interested in 20 rooms');
    expect(stored.single.filePath, audio.path);
    expect(stored.single.durationMs, 4200);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('voice_notes.v1'), contains('lead-1'));

    // Playback.
    await tester.tap(find.bySemanticsLabel('Play'));
    await tester.pump();
    expect(native.calls, contains('play'));
    native.emit({
      'event': 'playback',
      'path': audio.path,
      'state': 'playing',
      'positionMs': 1000,
      'durationMs': 4200,
    });
    await tester.pump();
    expect(find.text('00:01 / 00:04'), findsOneWidget);
    expect(find.byType(Slider), findsOneWidget);
    native.emit({
      'event': 'playback',
      'path': audio.path,
      'state': 'completed',
      'positionMs': 4200,
      'durationMs': 4200,
    });
    await tester.pump();
    expect(find.byType(Slider), findsNothing);
  });

  testWidgets('stop keeps the live text if the final result comes back empty', (
    tester,
  ) async {
    final audio = File('${tmp.path}/vn2.m4a')..writeAsBytesSync([0]);
    final native = _FakeNative(audio, stopTranscript: '')..install(tester);
    await _pumpSection(
      tester,
      const VoiceNotesSection(leadId: 'lead-2', leadName: 'Shyam Ashram'),
    );

    await tester.tap(find.text('Start Recording'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    native.emit({
      'event': 'transcript',
      'committed': 'call him next week',
      'partial': 'about pricing',
    });
    await tester.pump(const Duration(milliseconds: 50));

    await tester.tap(find.text('Stop Recording'));
    await tester.pumpAndSettle();

    final stored = VoiceNoteStore.instance.forLead('lead-2');
    expect(stored.single.transcript, 'call him next week about pricing');
    // Still shown under Live Transcription after stopping.
    expect(
      find.textContaining('call him next week about pricing'),
      findsWidgets,
    );
  });

  testWidgets('Hindi speech is shown and saved in Hinglish', (tester) async {
    final audio = File('${tmp.path}/vn3.m4a')..writeAsBytesSync([0]);
    final native = _FakeNative(
      audio,
      stopTranscript: 'कमरा कितने का है होटल में 20 रूम हैं',
    )..install(tester);
    await _pumpSection(
      tester,
      const VoiceNotesSection(leadId: 'lead-3', leadName: 'Radhe Guest House'),
    );
    expect(find.text('Hindi'), findsOneWidget);
    expect(find.text('हिंदी'), findsNothing);

    await tester.tap(find.text('Start Recording'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    native.emit({
      'event': 'transcript',
      'committed': 'कमरा कितने का है',
      'partial': 'होटल में',
    });
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.textContaining('kamra kitne ka hai'), findsOneWidget);
    expect(find.textContaining('कमरा'), findsNothing);

    await tester.tap(find.text('Stop Recording'));
    await tester.pumpAndSettle();
    final stored = VoiceNoteStore.instance.forLead('lead-3');
    expect(
      stored.single.transcript,
      'kamra kitne ka hai hotel mein 20 room hain',
    );
    expect(find.textContaining('Hinglish'), findsWidgets);
  });

  test('notes saved earlier in Devanagari are converted to Hinglish', () async {
    SharedPreferences.setMockInitialValues({
      'voice_notes.v1':
          '[{"id":"old","leadId":"lead-9","leadName":"","recordedAt":'
          '"2026-11-20T10:00:00.000","durationMs":3000,"filePath":"",'
          '"transcript":"कट किसको","language":"hi-IN"}]',
    });
    VoiceNoteStore.instance.resetForTest();
    await VoiceNoteStore.instance.load();
    expect(
      VoiceNoteStore.instance.forLead('lead-9').single.transcript,
      'kat kisko',
    );
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('voice_notes.v1'), contains('kat kisko'));
  });

  testWidgets('capture form keeps recordings pending until submit', (
    tester,
  ) async {
    final audio = File('${tmp.path}/vn3.m4a')..writeAsBytesSync([0]);
    final native = _FakeNative(audio)..install(tester);
    final pending = PendingVoiceNotes();
    await _pumpSection(tester, VoiceNotesSection(pending: pending));

    await tester.tap(find.text('Start Recording'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(pending.isRecording, isTrue);

    await tester.tap(find.text('Stop Recording'));
    await tester.pumpAndSettle();
    expect(native.calls, contains('stop'));
    expect(pending.isRecording, isFalse);
    expect(pending.notes, hasLength(1));
    expect(find.text('Recorded for this lead'), findsOneWidget);
    // Not in the store until the lead exists.
    expect(VoiceNoteStore.instance.forLead(''), isEmpty);
  });

  testWidgets('the recording sits under the button, its text under it', (
    tester,
  ) async {
    final first = File('${tmp.path}/a.m4a')..writeAsBytesSync([0]);
    final native = _FakeNative(first, stopTranscript: 'first visit')
      ..install(tester);
    final pending = PendingVoiceNotes();
    await _pumpSection(tester, VoiceNotesSection(pending: pending));

    await tester.tap(find.text('Start Recording'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    await tester.tap(find.text('Stop Recording'));
    await tester.pumpAndSettle();
    expect(native.calls, contains('stop'));

    // Button → recording → text, top to bottom.
    double top(Finder f) => tester.getTopLeft(f).dy;
    expect(
      top(find.text('Start Recording')),
      lessThan(top(find.text('Recorded for this lead'))),
    );
    expect(
      top(find.bySemanticsLabel('Play')),
      lessThan(top(find.text('Live Transcription'))),
    );
    expect(
      top(find.text('Live Transcription')),
      lessThan(top(find.textContaining('first visit'))),
    );

    // A second recording's text replaces it; tapping the first shows its own.
    pending.add(
      VoiceNote(
        id: 'older',
        leadId: '',
        leadName: '',
        recordedAt: DateTime(2026, 11, 24, 9, 30),
        durationMs: 2000,
        filePath: first.path,
        transcript: 'kal milte hain',
        language: 'hi-IN',
      ),
    );
    await tester.pump();
    await tester.tap(find.textContaining('9:30 AM').first);
    await tester.pump();
    expect(find.textContaining('kal milte hain'), findsOneWidget);
    expect(find.textContaining('first visit'), findsNothing);
  });

  testWidgets('when no words come back, the reason is shown', (tester) async {
    final audio = File('${tmp.path}/silent.m4a')..writeAsBytesSync([0]);
    _FakeNative(
      audio,
      stopTranscript: '',
      stopProblem: 'No text: speech-to-text needs internet.',
    ).install(tester);
    await _pumpSection(
      tester,
      const VoiceNotesSection(leadId: 'lead-5', leadName: 'X'),
    );

    await tester.tap(find.text('Start Recording'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    await tester.tap(find.text('Stop Recording'));
    await tester.pumpAndSettle();

    expect(
      find.text('No text: speech-to-text needs internet.'),
      findsOneWidget,
    );
    expect(
      find.text('No words were recognised in this recording.'),
      findsOneWidget,
    );
  });

  testWidgets('a refused microphone permission is explained', (tester) async {
    final messenger = tester.binding.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(_methods, (call) async {
      switch (call.method) {
        case 'permissionStatus':
          return 'denied';
        case 'requestPermission':
          return 'denied';
        case 'listFiles':
          return <Object>[];
      }
      return null;
    });
    messenger.setMockStreamHandler(
      _events,
      MockStreamHandler.inline(onListen: (args, events) {}),
    );
    await _pumpSection(
      tester,
      const VoiceNotesSection(leadId: 'lead-3', leadName: 'X'),
    );

    await tester.tap(find.text('Start Recording'));
    await tester.pumpAndSettle();
    expect(
      find.text('Allow microphone access to record voice notes.'),
      findsOneWidget,
    );
    expect(find.text('Start Recording'), findsOneWidget);
  });
}
