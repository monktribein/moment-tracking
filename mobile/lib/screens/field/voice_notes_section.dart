import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../models/voice_note.dart';
import '../../services/auth_service.dart';
import '../../services/voice_note_service.dart';
import '../../theme/app_theme.dart';

/// Voice notes for a lead: record the conversation while the words are
/// typed live, then play recordings back and read their transcripts.
///
/// Audio and text are kept only on this phone (see [VoiceNoteStore]).
class VoiceNotesSection extends StatefulWidget {
  const VoiceNotesSection({
    super.key,
    this.leadId,
    this.leadName = '',
    this.pending,
  }) : assert(
         leadId != null || pending != null,
         'Give a leadId, or pending on the capture form',
       );

  /// The lead the recordings belong to.
  final String? leadId;
  final String leadName;

  /// On the capture form the lead has no id yet: recordings wait here and
  /// are linked to the lead when it is submitted.
  final PendingVoiceNotes? pending;

  @override
  State<VoiceNotesSection> createState() => _VoiceNotesSectionState();
}

enum _Phase { idle, starting, recording, saving }

class _VoiceNotesSectionState extends State<VoiceNotesSection>
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  static const _languageKey = 'voice_notes.language';

  /// The language the agent speaks...
  static const _languages = {'hi-IN': 'Hindi', 'en-IN': 'English'};

  /// ...and how its text is written: Hindi in Roman letters (Hinglish).
  static const _textLanguages = {'hi-IN': 'Hinglish', 'en-IN': 'English'};
  static const _maxBars = 48;

  final _service = VoiceNoteService.instance;
  final _store = VoiceNoteStore.instance;
  final _transcriptScroll = ScrollController();
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  );

  StreamSubscription<Map<String, dynamic>>? _events;
  _Phase _phase = _Phase.idle;
  String _language = 'hi-IN';
  String _committed = '';
  String _partial = '';
  String? _liveTextNote;
  String? _notice;
  bool _noticeIsError = false;
  final List<double> _levels = [];
  final Stopwatch _stopwatch = Stopwatch();
  Timer? _ticker;
  String? _recordingId;
  DateTime? _startedAt;
  String? _agentId;
  ScaffoldMessengerState? _messenger;

  String? _playingPath;
  String _playState = 'stopped';
  int _positionMs = 0;
  int _durationMs = 0;

  /// The recording whose text is shown under it (the newest by default).
  String? _selectedId;

  /// Why the last recording has no text, from the phone's speech service.
  String? _textProblem;

  bool get _busy => _phase != _Phase.idle;
  bool get _capturing => widget.pending != null;

  String get _liveText =>
      [_committed.trim(), _partial.trim()].where((s) => s.isNotEmpty).join(' ');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _store.addListener(_onChanged);
    widget.pending?.addListener(_onChanged);
    if (_service.isSupported) {
      _store.load();
      _events = _service.events.listen(_onEvent, onError: (Object _) {});
      _loadLanguage();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _messenger = ScaffoldMessenger.maybeOf(context);
    if (_agentId == null) {
      try {
        _agentId = Provider.of<AuthService>(context, listen: false).session?.id;
      } catch (_) {
        // No session available (e.g. in isolation); the note just has no agent.
      }
    }
  }

  @override
  void didUpdateWidget(VoiceNotesSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.pending != widget.pending) {
      oldWidget.pending?.removeListener(_onChanged);
      widget.pending?.addListener(_onChanged);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _store.removeListener(_onChanged);
    widget.pending?.removeListener(_onChanged);
    _events?.cancel();
    _ticker?.cancel();
    _pulse.dispose();
    _transcriptScroll.dispose();
    if (_phase == _Phase.recording) {
      if (_capturing) {
        // The capture form is being left; its recordings are discarded.
        unawaited(_service.cancel().catchError((Object _) {}));
        widget.pending?.isRecording = false;
      } else {
        // Leaving Lead Details mid-recording keeps what was recorded.
        unawaited(_saveAfterDispose());
      }
    }
    if (_playingPath != null) {
      unawaited(_service.stopPlayback().catchError((Object _) {}));
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Android silences the microphone for apps in the background.
    if (state == AppLifecycleState.paused && _phase == _Phase.recording) {
      _stop(
        reason: 'The app went to the background, so the recording was stopped and saved.',
      );
    }
  }

  void _onChanged() {
    if (mounted) setState(() {});
  }

  void _onEvent(Map<String, dynamic> e) {
    if (!mounted) return;
    final live = _phase == _Phase.starting || _phase == _Phase.recording;
    switch (e['event']) {
      case 'level':
        if (_phase != _Phase.recording) return;
        setState(() {
          _levels.add((e['level'] as num?)?.toDouble() ?? 0);
          if (_levels.length > _maxBars) _levels.removeAt(0);
        });
      case 'transcript':
        if (!live && _phase != _Phase.saving) return;
        setState(() {
          _committed = e['committed']?.toString() ?? '';
          _partial = e['partial']?.toString() ?? '';
        });
        _scrollTranscriptToEnd();
      case 'transcriptionUnavailable':
        if (!live) return;
        setState(() => _liveTextNote = e['message']?.toString());
      case 'captureEnded':
        if (_phase == _Phase.recording) _stop(reason: e['message']?.toString());
      case 'playback':
        final path = e['path']?.toString();
        final state = e['state']?.toString() ?? 'stopped';
        final position = (e['positionMs'] as num?)?.toInt() ?? 0;
        final duration = (e['durationMs'] as num?)?.toInt() ?? 0;
        if (state == 'stopped' || state == 'completed' || state == 'error') {
          if (path == _playingPath) {
            setState(() {
              _playingPath = null;
              _playState = 'stopped';
              _positionMs = 0;
            });
          }
        } else if (path != null) {
          setState(() {
            _playingPath = path;
            _playState = state;
            _positionMs = position;
            if (duration > 0) _durationMs = duration;
          });
        }
    }
  }

  // ── Recording ────────────────────────────────────────────────────────────

  Future<void> _start() async {
    if (_busy) return;
    if (_playingPath != null) {
      await _service.stopPlayback().catchError((Object _) {});
    }
    setState(() {
      _phase = _Phase.starting;
      _committed = '';
      _partial = '';
      _liveTextNote = null;
      _notice = null;
      _levels.clear();
    });
    try {
      var permission = await _service.permissionStatus();
      if (permission != MicPermission.granted) {
        permission = await _service.requestPermission();
      }
      if (!mounted) return;
      if (permission != MicPermission.granted) {
        setState(() => _phase = _Phase.idle);
        await _explainPermission(permission);
        return;
      }
      final id =
          'vn_${DateTime.now().millisecondsSinceEpoch}_${math.Random().nextInt(1 << 30)}';
      await _service.start(id: id, language: _language);
      if (!mounted) {
        await _service.cancel();
        return;
      }
      _haptic(HapticFeedback.mediumImpact);
      _recordingId = id;
      _startedAt = DateTime.now();
      _stopwatch
        ..reset()
        ..start();
      _ticker = Timer.periodic(const Duration(milliseconds: 250), (_) {
        if (mounted) setState(() {});
      });
      _pulse.repeat(reverse: true);
      widget.pending?.isRecording = true;
      setState(() => _phase = _Phase.recording);
    } on PlatformException catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.idle;
        _setNotice(e.message ?? 'Could not start recording.', error: true);
      });
    }
  }

  Future<void> _stop({String? reason}) async {
    if (_phase != _Phase.recording) return;
    _ticker?.cancel();
    _stopwatch.stop();
    _pulse
      ..stop()
      ..value = 0;
    _haptic(HapticFeedback.lightImpact);
    setState(() {
      _phase = _Phase.saving;
      _notice = null;
    });
    try {
      final note = await _finishRecording();
      if (!mounted) return;
      setState(() {
        _phase = _Phase.idle;
        if (note == null) {
          _setNotice(
            'Nothing was saved: the recording was too short.',
            error: true,
          );
        } else {
          // Its text is shown right under the new recording.
          _selectedId = note.id;
          _committed = note.transcript;
          _partial = '';
          if (note.transcript.isEmpty) _liveTextNote = _textProblem;
          _setNotice(
            reason ??
                (_capturing
                    ? 'Voice note added. It is saved with this lead when you submit.'
                    : 'Voice note saved on this phone.'),
            error: reason != null,
          );
        }
      });
    } on PlatformException catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.idle;
        _setNotice(e.message ?? 'Could not save the recording.', error: true);
      });
    } finally {
      widget.pending?.isRecording = false;
    }
  }

  /// Stops the recorder and keeps the note; null when nothing was recorded.
  Future<VoiceNote?> _finishRecording() async {
    final result = await _service.stop();
    if (!result.saved) return null;
    final transcript = result.transcript.trim().isNotEmpty
        ? result.transcript.trim()
        : _liveText;
    _textProblem = transcript.isEmpty
        ? (result.transcriptProblem ??
              'No words were recognised. Speak clearly, close to the phone.')
        : null;
    final note = VoiceNote(
      id: _recordingId ?? 'vn_${DateTime.now().millisecondsSinceEpoch}',
      leadId: widget.leadId ?? '',
      leadName: widget.leadName,
      agentId: _agentId,
      recordedAt: _startedAt ?? DateTime.now(),
      durationMs: result.durationMs,
      filePath: result.path,
      transcript: transcript,
      language: _language,
    );
    if (widget.pending != null) {
      widget.pending!.add(note);
    } else {
      await _store.add(note);
    }
    return note;
  }

  Future<void> _saveAfterDispose() async {
    try {
      if (await _finishRecording() != null) {
        _messenger?.showSnackBar(
          const SnackBar(content: Text('Voice note saved on this phone')),
        );
      }
    } catch (_) {
      // The screen is gone; nothing more to report.
    }
  }

  Future<void> _explainPermission(MicPermission permission) async {
    if (permission == MicPermission.permanentlyDenied) {
      final open = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Microphone access is off'),
          content: const Text(
            'To record voice notes, allow the microphone for this app in '
            'Settings → Permissions → Microphone.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Not now'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Open Settings'),
            ),
          ],
        ),
      );
      if (open == true) await _service.openAppSettings();
    } else if (mounted) {
      setState(
        () => _setNotice(
          'Allow microphone access to record voice notes.',
          error: true,
        ),
      );
    }
  }

  // ── Saved recordings ─────────────────────────────────────────────────────

  Future<void> _togglePlay(VoiceNote note) async {
    if (_selectedId != note.id) setState(() => _selectedId = note.id);
    try {
      if (_playingPath == note.filePath) {
        if (_playState == 'playing') {
          await _service.pause();
        } else {
          await _service.resume();
        }
        return;
      }
      setState(() {
        _playingPath = note.filePath;
        _playState = 'playing';
        _positionMs = 0;
        _durationMs = note.durationMs;
      });
      await _service.play(note.filePath);
    } on PlatformException catch (e) {
      if (!mounted) return;
      setState(() {
        _playingPath = null;
        _playState = 'stopped';
        _setNotice(e.message ?? "This recording can't be played.", error: true);
      });
    }
  }

  Future<void> _delete(VoiceNote note) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this voice note?'),
        content: const Text(
          'The recording and its transcript will be removed from this phone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    if (_playingPath == note.filePath) {
      await _service.stopPlayback().catchError((Object _) {});
    }
    if (widget.pending != null) {
      await widget.pending!.remove(note);
    } else {
      await _store.remove(note);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  void _setNotice(String? text, {bool error = false}) {
    _notice = text;
    _noticeIsError = error;
  }

  void _haptic(Future<void> Function() feedback) {
    feedback().catchError((Object _) {});
  }

  void _scrollTranscriptToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_transcriptScroll.hasClients) {
        _transcriptScroll.jumpTo(_transcriptScroll.position.maxScrollExtent);
      }
    });
  }

  Future<void> _loadLanguage() async {
    try {
      final saved = (await SharedPreferences.getInstance()).getString(
        _languageKey,
      );
      if (saved != null && _languages.containsKey(saved) && mounted && !_busy) {
        setState(() => _language = saved);
      }
    } catch (_) {
      // Keep the default.
    }
  }

  Future<void> _setLanguage(String code) async {
    setState(() => _language = code);
    try {
      await (await SharedPreferences.getInstance()).setString(
        _languageKey,
        code,
      );
    } catch (_) {
      // Only a preference.
    }
  }

  static String _clock(int ms) {
    final d = Duration(milliseconds: ms < 0 ? 0 : ms);
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return d.inHours > 0 ? '${d.inHours}:$m:$s' : '$m:$s';
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  //
  // One card, top to bottom: the recorder and its button, the recordings
  // right under the button, then the text: live while recording, otherwise
  // the text of the selected recording (the newest one by default).

  VoiceNote? _selectedNote(List<VoiceNote> notes) {
    if (notes.isEmpty) return null;
    for (final n in notes) {
      if (n.id == _selectedId) return n;
    }
    return notes.first;
  }

  /// What the text box shows: the live words while recording, otherwise
  /// the selected recording's text.
  String _boxText(VoiceNote? selected) =>
      _busy || selected == null ? _liveText : selected.transcript;

  @override
  Widget build(BuildContext context) {
    final notes =
        widget.pending?.notes ??
        (_store.isLoaded
            ? _store.forLead(widget.leadId!)
            : const <VoiceNote>[]);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(
              Icons.graphic_eq_rounded,
              size: 18,
              color: AppColors.primary,
            ),
            const SizedBox(width: 6),
            const Text(
              'Voice Notes',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.infoLight,
                borderRadius: BorderRadius.circular(4),
              ),
              child: const Text(
                'ON THIS PHONE',
                style: TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w800,
                  color: AppColors.info,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        const Text(
          'Record the conversation and your words are typed live. Audio and '
          'text stay on this phone only.',
          style: TextStyle(fontSize: 12, color: AppColors.muted),
        ),
        const SizedBox(height: 10),
        if (!_service.isSupported)
          const _InlineNote(
            text:
                'Voice notes with live text are available in the Android app.',
            color: AppColors.muted,
            background: Color(0xFFF1F5F9),
            icon: Icons.mic_off_outlined,
          )
        else
          _recorderCard(notes),
      ],
    );
  }

  Widget _recorderCard(List<VoiceNote> notes) {
    final recording = _phase == _Phase.recording;
    final accent = recording ? AppColors.danger : AppColors.primary;
    final status = switch (_phase) {
      _Phase.idle => 'Ready to record',
      _Phase.starting => 'Starting…',
      _Phase.recording => 'Recording… speak naturally',
      _Phase.saving => 'Saving recording…',
    };
    final selected = _selectedNote(notes);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: recording
              ? AppColors.danger.withValues(alpha: 0.35)
              : AppColors.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              _MicBadge(recording: recording, pulse: _pulse),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _clock(
                        _phase == _Phase.idle
                            ? 0
                            : _stopwatch.elapsedMilliseconds,
                      ),
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        fontFeatures: const [FontFeature.tabularFigures()],
                        color: recording ? AppColors.danger : AppColors.text,
                      ),
                    ),
                    Text(
                      status,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              _languageToggle(enabled: !_busy),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 40,
            child: CustomPaint(
              painter: _WaveformPainter(
                levels: List.of(_levels),
                color: accent,
                active: recording,
                bars: _maxBars,
              ),
            ),
          ),
          const SizedBox(height: 12),
          _mainButton(),

          // ① The recordings, right under the record button.
          if (notes.isNotEmpty) ...[
            const SizedBox(height: 14),
            _recordingsHeader(notes.length),
            const SizedBox(height: 8),
            for (final note in notes)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: _recordingRow(
                  note,
                  selected: !_busy && note.id == selected?.id,
                ),
              ),
          ] else if (!_capturing && _store.isLoaded && !_busy) ...[
            const SizedBox(height: 10),
            const Text(
              'No voice notes for this lead yet.',
              style: TextStyle(fontSize: 12, color: AppColors.faint),
            ),
          ],

          // ② Its text, just below.
          const SizedBox(height: 14),
          _transcriptHeader(selected),
          const SizedBox(height: 8),
          _transcriptBox(selected),
          if (_liveTextNote != null) ...[
            const SizedBox(height: 8),
            _InlineNote(
              text: _liveTextNote!,
              color: AppColors.warning,
              background: AppColors.warningLight,
              icon: Icons.info_outline,
            ),
          ],
          if (_notice != null) ...[
            const SizedBox(height: 8),
            _InlineNote(
              text: _notice!,
              color: _noticeIsError ? AppColors.danger : AppColors.success,
              background: _noticeIsError
                  ? AppColors.dangerLight
                  : AppColors.successLight,
              icon: _noticeIsError
                  ? Icons.error_outline
                  : Icons.check_circle_outline,
            ),
          ],
        ],
      ),
    );
  }

  Widget _mainButton() {
    final style = FilledButton.styleFrom(
      minimumSize: const Size.fromHeight(48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      foregroundColor: Colors.white,
      disabledForegroundColor: Colors.white,
    );
    switch (_phase) {
      case _Phase.recording:
        return FilledButton.icon(
          onPressed: _stop,
          style: style.copyWith(
            backgroundColor: const WidgetStatePropertyAll(AppColors.danger),
          ),
          icon: const Icon(Icons.stop_rounded),
          label: const Text('Stop Recording'),
        );
      case _Phase.starting:
      case _Phase.saving:
        return FilledButton.icon(
          onPressed: null,
          style: style.copyWith(
            backgroundColor: WidgetStatePropertyAll(
              AppColors.primary.withValues(alpha: 0.6),
            ),
          ),
          icon: const SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Colors.white,
            ),
          ),
          label: Text(_phase == _Phase.starting ? 'Starting…' : 'Saving…'),
        );
      case _Phase.idle:
        return FilledButton.icon(
          onPressed: _start,
          style: style.copyWith(
            backgroundColor: const WidgetStatePropertyAll(AppColors.primary),
          ),
          icon: const Icon(Icons.mic_rounded),
          label: const Text('Start Recording'),
        );
    }
  }

  Widget _recordingsHeader(int count) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(
              Icons.audio_file_outlined,
              size: 16,
              color: AppColors.muted,
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                _capturing ? 'Recorded for this lead' : 'Saved Recordings',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
              decoration: BoxDecoration(
                color: AppColors.primaryLight,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '$count',
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primary,
                ),
              ),
            ),
          ],
        ),
        if (_capturing)
          const Padding(
            padding: EdgeInsets.only(top: 2),
            child: Text(
              'Saved with this lead when you tap Submit. Tap one to see its text.',
              style: TextStyle(fontSize: 11, color: AppColors.muted),
            ),
          ),
      ],
    );
  }

  Widget _recordingRow(VoiceNote note, {required bool selected}) {
    final exists = note.filePath.isNotEmpty && File(note.filePath).existsSync();
    final active = _playingPath == note.filePath;
    final playing = active && _playState == 'playing';
    final total = active && _durationMs > 0 ? _durationMs : note.durationMs;
    final position = active ? _positionMs.clamp(0, total) : 0;
    final highlighted = selected || active;

    return Material(
      color: highlighted ? AppColors.primaryLight : AppColors.bg,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: _busy ? null : () => setState(() => _selectedId = note.id),
        child: Container(
          padding: const EdgeInsets.fromLTRB(8, 6, 2, 6),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: highlighted
                  ? AppColors.primary.withValues(alpha: 0.45)
                  : AppColors.border,
            ),
          ),
          child: Column(
            children: [
              Row(
                children: [
                  Material(
                    color: exists && !_busy
                        ? AppColors.primary
                        : AppColors.border,
                    shape: const CircleBorder(),
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: exists && !_busy ? () => _togglePlay(note) : null,
                      child: SizedBox(
                        width: 36,
                        height: 36,
                        child: Icon(
                          playing
                              ? Icons.pause_rounded
                              : Icons.play_arrow_rounded,
                          color: Colors.white,
                          size: 22,
                          semanticLabel: playing ? 'Pause' : 'Play',
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          DateFormat('d MMM, h:mm a')
                              .format(note.recordedAt.toLocal()),
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          '${_clock(note.durationMs)} · '
                          '${_textLanguages[note.language] ?? note.language}'
                          '${exists ? '' : ' · Audio file missing'}'
                          '${note.transcript.isEmpty ? ' · No text' : ''}',
                          style: TextStyle(
                            fontSize: 11,
                            color: exists ? AppColors.muted : AppColors.danger,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Delete',
                    visualDensity: VisualDensity.compact,
                    icon: Icon(
                      Icons.delete_outline,
                      size: 20,
                      color: _busy ? AppColors.faint : AppColors.danger,
                    ),
                    onPressed: _busy ? null : () => _delete(note),
                  ),
                ],
              ),
              if (active && total > 0)
                Row(
                  children: [
                    Expanded(
                      child: SliderTheme(
                        data: SliderTheme.of(context).copyWith(
                          trackHeight: 3,
                          overlayShape: SliderComponentShape.noOverlay,
                          thumbShape: const RoundSliderThumbShape(
                            enabledThumbRadius: 6,
                          ),
                        ),
                        child: Slider(
                          value: position.toDouble(),
                          max: total.toDouble(),
                          activeColor: AppColors.primary,
                          inactiveColor: AppColors.border,
                          onChanged: (v) =>
                              setState(() => _positionMs = v.round()),
                          onChangeEnd: (v) => _service
                              .seek(v.round())
                              .catchError((Object _) {}),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${_clock(position)} / ${_clock(total)}',
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.muted,
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _transcriptHeader(VoiceNote? selected) {
    final recording = _phase == _Phase.recording;
    final text = _boxText(selected);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(
              Icons.subtitles_outlined,
              size: 16,
              color: AppColors.muted,
            ),
            const SizedBox(width: 6),
            const Text(
              'Live Transcription',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
            ),
            const Spacer(),
            if (recording)
              FadeTransition(
                opacity: Tween(begin: 0.35, end: 1.0).animate(_pulse),
                child: const Row(
                  children: [
                    Icon(Icons.circle, size: 8, color: AppColors.danger),
                    SizedBox(width: 4),
                    Text(
                      'LIVE',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        color: AppColors.danger,
                      ),
                    ),
                  ],
                ),
              ),
            if (!_busy && text.isNotEmpty)
              InkWell(
                borderRadius: BorderRadius.circular(6),
                onTap: () async {
                  await Clipboard.setData(ClipboardData(text: text));
                  if (mounted) setState(() => _setNotice('Text copied.'));
                },
                child: const Padding(
                  padding: EdgeInsets.all(4),
                  child: Row(
                    children: [
                      Icon(
                        Icons.copy_rounded,
                        size: 14,
                        color: AppColors.primary,
                      ),
                      SizedBox(width: 4),
                      Text(
                        'Copy',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
        if (!_busy && selected != null)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              'Text of the ${DateFormat('h:mm a').format(selected.recordedAt.toLocal())} '
              'recording above',
              style: const TextStyle(fontSize: 11, color: AppColors.muted),
            ),
          ),
      ],
    );
  }

  Widget _transcriptBox(VoiceNote? selected) {
    final note = _busy ? null : selected; // null: show the live words
    final committed = note == null ? _committed.trim() : note.transcript.trim();
    final partial = note == null ? _partial.trim() : '';
    final hasText = committed.isNotEmpty || partial.isNotEmpty;
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 84, maxHeight: 220),
      decoration: BoxDecoration(
        color: AppColors.bg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: SingleChildScrollView(
        controller: _transcriptScroll,
        padding: const EdgeInsets.all(12),
        child: hasText
            ? Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: committed,
                      style: const TextStyle(color: AppColors.text),
                    ),
                    if (partial.isNotEmpty)
                      TextSpan(
                        text: '${committed.isEmpty ? '' : ' '}$partial',
                        style: const TextStyle(color: AppColors.muted),
                      ),
                  ],
                ),
                style: const TextStyle(fontSize: 14, height: 1.45),
              )
            : Text(
                note == null
                    ? _placeholder()
                    : 'No words were recognised in this recording.',
                style: const TextStyle(fontSize: 13, color: AppColors.faint),
              ),
      ),
    );
  }

  String _placeholder() {
    final hindi = _language == 'hi-IN';
    if (_phase == _Phase.recording || _phase == _Phase.starting) {
      return hindi
          ? 'Listening… speak in Hindi. It is typed in Hinglish.'
          : 'Listening… speak in English.';
    }
    return hindi
        ? 'Hindi is typed in Hinglish, e.g. "aap kaise hain". '
              'Speaking English? Choose English above.'
        : 'Your English words appear here as you speak. '
              'Speaking Hindi? Choose Hindi above.';
  }

  Widget _languageToggle({required bool enabled}) {
    return Semantics(
      label: 'Speech language',
      child: Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final entry in _languages.entries)
              GestureDetector(
                onTap: enabled && entry.key != _language
                    ? () => _setLanguage(entry.key)
                    : null,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: entry.key == _language
                        ? Colors.white
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    entry.value,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: entry.key == _language
                          ? (enabled ? AppColors.primary : AppColors.muted)
                          : AppColors.faint,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _MicBadge extends StatelessWidget {
  const _MicBadge({required this.recording, required this.pulse});

  final bool recording;
  final Animation<double> pulse;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 54,
      height: 54,
      child: AnimatedBuilder(
        animation: pulse,
        builder: (context, _) => Stack(
          alignment: Alignment.center,
          children: [
            if (recording)
              Container(
                width: 42 + 12 * pulse.value,
                height: 42 + 12 * pulse.value,
                decoration: BoxDecoration(
                  color: AppColors.danger.withValues(
                    alpha: 0.22 * (1 - pulse.value) + 0.06,
                  ),
                  shape: BoxShape.circle,
                ),
              ),
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: recording ? AppColors.danger : AppColors.primaryLight,
                shape: BoxShape.circle,
              ),
              child: Icon(
                recording ? Icons.mic_rounded : Icons.mic_none_rounded,
                color: recording ? Colors.white : AppColors.primary,
                size: 22,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InlineNote extends StatelessWidget {
  const _InlineNote({
    required this.text,
    required this.color,
    required this.background,
    required this.icon,
  });

  final String text;
  final Color color;
  final Color background;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 12, height: 1.35, color: color),
            ),
          ),
        ],
      ),
    );
  }
}

/// Bars for the last few seconds of input loudness, newest on the right.
class _WaveformPainter extends CustomPainter {
  _WaveformPainter({
    required this.levels,
    required this.color,
    required this.active,
    required this.bars,
  });

  final List<double> levels;
  final Color color;
  final bool active;
  final int bars;

  @override
  void paint(Canvas canvas, Size size) {
    const gap = 3.0;
    final barWidth = ((size.width - gap * (bars - 1)) / bars).clamp(1.5, 6.0);
    final total = barWidth * bars + gap * (bars - 1);
    var x = (size.width - total) / 2;
    final paint = Paint();
    final firstLive = bars - levels.length;
    for (var i = 0; i < bars; i++) {
      final level = i >= firstLive ? levels[i - firstLive] : 0.0;
      final height = math.max(3.0, level * size.height);
      paint.color = active && i >= firstLive ? color : AppColors.border;
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromCenter(
            center: Offset(x + barWidth / 2, size.height / 2),
            width: barWidth,
            height: height,
          ),
          Radius.circular(barWidth / 2),
        ),
        paint,
      );
      x += barWidth + gap;
    }
  }

  @override
  bool shouldRepaint(_WaveformPainter old) =>
      old.active != active || old.color != color || old.levels != levels;
}
