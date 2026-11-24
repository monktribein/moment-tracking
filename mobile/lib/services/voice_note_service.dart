import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/voice_note.dart';
import '../utils/hinglish.dart';

enum MicPermission { granted, denied, permanentlyDenied }

class VoiceRecordingResult {
  final String path;
  final int durationMs;
  final String transcript;

  /// False when nothing playable was recorded (e.g. stopped instantly).
  final bool saved;

  /// When no words were recognised: why, in words the agent can act on.
  final String? transcriptProblem;

  const VoiceRecordingResult({
    required this.path,
    required this.durationMs,
    required this.transcript,
    required this.saved,
    this.transcriptProblem,
  });
}

/// Voice recording with live speech-to-text, on the phone only (Android).
///
/// The Android side owns the microphone, writes an .m4a file and hands the
/// same audio to the phone's speech recognition service, so one tap gives
/// both a recording and live text. Nothing is uploaded anywhere.
///
/// Events (maps with an `event` key): `level` (0..1), `transcript`
/// (`committed` + `partial` text), `transcriptionUnavailable` (`message`),
/// `captureEnded` (`message`) and `playback` (`path`, `state`,
/// `positionMs`, `durationMs`).
class VoiceNoteService {
  VoiceNoteService._();

  static final VoiceNoteService instance = VoiceNoteService._();

  static const MethodChannel _methods = MethodChannel('moment/voice_notes');
  static const EventChannel _eventChannel = EventChannel(
    'moment/voice_notes/events',
  );

  Stream<Map<String, dynamic>>? _events;

  bool get isSupported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  Stream<Map<String, dynamic>> get events => _events ??= _eventChannel
      .receiveBroadcastStream()
      .where((e) => e is Map)
      .map((e) => _inHinglish(Map<String, dynamic>.from(e as Map)));

  /// Hindi speech arrives in Devanagari; agents get it in Hinglish.
  static Map<String, dynamic> _inHinglish(Map<String, dynamic> e) {
    if (e['event'] == 'transcript') {
      for (final key in const ['committed', 'partial']) {
        final text = e[key];
        if (text is String) e[key] = toHinglish(text);
      }
    }
    return e;
  }

  Future<MicPermission> permissionStatus() async =>
      _permission(await _methods.invokeMethod<String>('permissionStatus'));

  Future<MicPermission> requestPermission() async =>
      _permission(await _methods.invokeMethod<String>('requestPermission'));

  Future<void> openAppSettings() => _methods.invokeMethod('openAppSettings');

  /// Starts recording to a new file named after [id]; returns its path.
  Future<String> start({required String id, required String language}) async {
    final res = await _methods.invokeMapMethod<String, dynamic>('start', {
      'id': id,
      'language': language,
    });
    return res?['path']?.toString() ?? '';
  }

  /// Stops recording; waits for the last words to be recognised.
  Future<VoiceRecordingResult> stop() async {
    final res =
        await _methods.invokeMapMethod<String, dynamic>('stop') ?? const {};
    return VoiceRecordingResult(
      path: res['path']?.toString() ?? '',
      durationMs: (res['durationMs'] as num?)?.toInt() ?? 0,
      transcript: toHinglish(res['transcript']?.toString() ?? ''),
      saved: res['saved'] == true,
      transcriptProblem: res['transcriptProblem']?.toString(),
    );
  }

  /// Stops recording and deletes the file.
  Future<void> cancel() => _methods.invokeMethod('cancel');

  Future<bool> deleteFile(String path) async =>
      await _methods.invokeMethod<bool>('deleteFile', {'path': path}) ?? false;

  Future<List<({String path, DateTime modified})>> listFiles() async {
    final rows = await _methods.invokeListMethod<dynamic>('listFiles') ?? [];
    return [
      for (final row in rows.whereType<Map>())
        (
          path: row['path']?.toString() ?? '',
          modified: DateTime.fromMillisecondsSinceEpoch(
            (row['modifiedMs'] as num?)?.toInt() ?? 0,
          ),
        ),
    ];
  }

  Future<void> play(String path) =>
      _methods.invokeMethod('play', {'path': path});

  Future<void> pause() => _methods.invokeMethod('pause');

  Future<void> resume() => _methods.invokeMethod('resume');

  Future<void> seek(int positionMs) =>
      _methods.invokeMethod('seek', {'positionMs': positionMs});

  Future<void> stopPlayback() => _methods.invokeMethod('stopPlayback');

  static MicPermission _permission(String? value) {
    switch (value) {
      case 'granted':
        return MicPermission.granted;
      case 'permanentlyDenied':
        return MicPermission.permanentlyDenied;
      default:
        return MicPermission.denied;
    }
  }
}

/// Saved voice notes, kept in SharedPreferences on this phone; survives
/// app restarts. Audio files live in the app's private storage.
class VoiceNoteStore extends ChangeNotifier {
  VoiceNoteStore._();

  static final VoiceNoteStore instance = VoiceNoteStore._();

  static const _prefsKey = 'voice_notes.v1';

  final List<VoiceNote> _notes = [];
  Future<void>? _loading;
  bool _loaded = false;

  bool get isLoaded => _loaded;

  Future<void> load() => _loading ??= _load();

  /// Newest first.
  List<VoiceNote> forLead(String leadId) =>
      _notes.where((n) => n.leadId == leadId).toList()
        ..sort((a, b) => b.recordedAt.compareTo(a.recordedAt));

  Future<void> add(VoiceNote note) => addAll([note]);

  Future<void> addAll(Iterable<VoiceNote> notes) async {
    await load();
    _notes.addAll(notes);
    await _save();
    notifyListeners();
  }

  /// Deletes the note and its audio file.
  Future<void> remove(VoiceNote note) async {
    await load();
    await _deleteFile(note.filePath);
    _notes.removeWhere((n) => n.id == note.id);
    await _save();
    notifyListeners();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_prefsKey);
    var converted = false;
    if (raw != null) {
      try {
        final list = jsonDecode(raw) as List<dynamic>;
        _notes
          ..clear()
          ..addAll(
            list.whereType<Map>().map((e) {
              final json = Map<String, dynamic>.from(e);
              // Notes saved before Hinglish was added are converted once.
              final text = json['transcript'];
              if (text is String) {
                final hinglish = toHinglish(text);
                if (hinglish != text) {
                  json['transcript'] = hinglish;
                  converted = true;
                }
              }
              return VoiceNote.fromJson(json);
            }),
          );
      } catch (e) {
        debugPrint('voice notes: could not read saved list: $e');
      }
    }
    if (converted) {
      try {
        await _save();
      } catch (_) {
        // They are converted again next time.
      }
    }
    _loaded = true;
    notifyListeners();
    unawaited(_removeOrphanFiles());
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _prefsKey,
      jsonEncode(_notes.map((n) => n.toJson()).toList()),
    );
  }

  /// Audio left behind with no saved note (app closed mid-recording, capture
  /// form abandoned). Only files older than an hour, so nothing in use.
  Future<void> _removeOrphanFiles() async {
    final service = VoiceNoteService.instance;
    if (!service.isSupported) return;
    try {
      final known = _notes.map((n) => n.filePath).toSet();
      final cutoff = DateTime.now().subtract(const Duration(hours: 1));
      for (final file in await service.listFiles()) {
        if (!known.contains(file.path) && file.modified.isBefore(cutoff)) {
          await service.deleteFile(file.path);
        }
      }
    } catch (_) {
      // Housekeeping only.
    }
  }

  static Future<void> _deleteFile(String path) async {
    if (path.isEmpty) return;
    try {
      if (VoiceNoteService.instance.isSupported) {
        await VoiceNoteService.instance.deleteFile(path);
      } else {
        final file = File(path);
        if (file.existsSync()) file.deleteSync();
      }
    } catch (_) {
      // The note goes regardless.
    }
  }

  @visibleForTesting
  void resetForTest() {
    _notes.clear();
    _loading = null;
    _loaded = false;
  }
}

/// Recordings made on the capture form, before the lead exists. They are
/// linked to the lead when it is submitted, or deleted if the form is left.
class PendingVoiceNotes extends ChangeNotifier {
  final List<VoiceNote> _notes = [];
  bool _recording = false;

  List<VoiceNote> get notes => List.unmodifiable(_notes.reversed);

  bool get isRecording => _recording;

  bool get hasUnsaved => _recording || _notes.isNotEmpty;

  set isRecording(bool value) {
    if (_recording == value) return;
    _recording = value;
    notifyListeners();
  }

  void add(VoiceNote note) {
    _notes.add(note);
    notifyListeners();
  }

  Future<void> remove(VoiceNote note) async {
    await VoiceNoteStore._deleteFile(note.filePath);
    _notes.removeWhere((n) => n.id == note.id);
    notifyListeners();
  }

  /// Saves the recordings under the newly created lead. Returns how many.
  Future<int> saveFor({
    required String leadId,
    required String leadName,
  }) async {
    if (_notes.isEmpty) return 0;
    final linked = [
      for (final n in _notes) n.linkedTo(leadId: leadId, leadName: leadName),
    ];
    await VoiceNoteStore.instance.addAll(linked);
    _notes.clear();
    notifyListeners();
    return linked.length;
  }

  Future<void> discard() async {
    for (final n in List.of(_notes)) {
      await VoiceNoteStore._deleteFile(n.filePath);
    }
    _notes.clear();
    notifyListeners();
  }
}
