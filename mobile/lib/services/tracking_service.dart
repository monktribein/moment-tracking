import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../api/api_service.dart';
import '../models/tracking.dart';
import 'auth_service.dart';

typedef PositionStreamFactory = Stream<Position> Function(
  LocationSettings settings,
);

/// Records the agent's route while they are on duty (check-in to check-out)
/// and uploads it, so the server knows the day's route and distance.
///
/// Points wait in a queue on the phone and are sent every minute. Without
/// signal they stay queued (saved per agent, across app restarts) and go out
/// later; the server ignores duplicates, so retries are safe. On Android a
/// notification shows while recording, which keeps it running with the
/// screen off or the app in the background.
class TrackingService extends ChangeNotifier with WidgetsBindingObserver {
  TrackingService(
    this._api,
    this._auth, {
    PositionStreamFactory? positionStream,
    Future<String?> Function()? locationProblem,
  }) : _positionStream =
           positionStream ??
           ((settings) =>
               Geolocator.getPositionStream(locationSettings: settings)),
       _locationProblem = locationProblem ?? _defaultLocationProblem {
    _auth.addListener(_onAuthChanged);
    WidgetsBinding.instance.addObserver(this);
  }

  static const uploadEvery = Duration(seconds: 60);
  static const _maxBatch = 100; // the server's limit per request
  static const _maxQueued = 3000; // about a day of points
  static const _maxAccuracyMetres = 100.0; // the server rejects worse fixes

  final ApiService _api;
  final AuthService _auth;
  final PositionStreamFactory _positionStream;
  final Future<String?> Function() _locationProblem;

  bool _onDuty = false;
  StreamSubscription<Position>? _positions;
  Timer? _timer;
  List<Map<String, dynamic>> _queue = [];
  String? _queueAgent;
  Future<void>? _upload;
  bool _foreground = true;
  bool _outsideIndia = false;
  bool _disposed = false;

  /// Today's distance measured by the server, once a batch has been sent.
  double? todayKm;
  DateTime? lastPointAt;
  DateTime? lastUploadAt;

  /// Why recording or uploading isn't working right now, for the agent.
  String? problem;

  int _shiftEndedByServer = 0;

  /// Recording is wanted: the agent is checked in.
  bool get onDuty => _onDuty;

  /// The phone is delivering location points.
  bool get isRecording => _positions != null;

  /// Points recorded but not yet on the server.
  int get pendingPoints => _queue.length;

  /// Goes up each time the server reports the shift is over (checked out
  /// elsewhere, or closed automatically), so screens can refresh.
  int get shiftEndedByServer => _shiftEndedByServer;

  /// Starts recording for the signed-in agent. Safe to call again.
  Future<void> startShift() async {
    final agent = _auth.session?.id;
    if (agent == null || agent.isEmpty) return;
    if (_queueAgent != agent) await _loadQueue(agent);
    _onDuty = true;
    _timer ??= Timer.periodic(uploadEvery, (_) => _tick());
    await _startStream();
    notifyListeners();
    unawaited(flush());
  }

  /// Stops recording and sends what is queued. Call before checking out.
  Future<void> endShift() async {
    _onDuty = false;
    await _stopStream();
    await flush();
    if (_queue.isEmpty) _stopTimer();
    notifyListeners();
  }

  /// Sends queued points, oldest first. While an upload is already running,
  /// callers wait for it (check-out must not go ahead of the last points).
  Future<void> flush() =>
      _upload ??= _uploadQueue().whenComplete(() => _upload = null);

  Future<void> _uploadQueue() async {
    final agent = _auth.session?.id;
    if (_queue.isEmpty || agent == null) return;
    // Never send one agent's points with another agent's login.
    if (agent != _queueAgent) return;
    try {
      while (_queue.isNotEmpty) {
        final batch = _queue.take(_maxBatch).toList();
        final TrackingUpload result;
        try {
          result = await _api.fieldRecordFixes(batch);
        } on ApiException catch (e) {
          if (e.statusCode == 400 || e.statusCode == 422) {
            // The server will never accept these; don't let them block the rest.
            _queue.removeRange(0, batch.length);
            await _saveQueue();
            continue;
          }
          problem = e.statusCode == 403
              ? e.message
              : 'Route points are waiting to upload (${e.message}).';
          break;
        }
        _queue.removeRange(0, batch.length);
        await _saveQueue();
        lastUploadAt = DateTime.now();
        if (!_outsideIndia) problem = null;
        if (result.totalKm != null) todayKm = result.totalKm;
        if (!result.onDuty && _onDuty) {
          _onDuty = false;
          await _stopStream();
          _shiftEndedByServer++;
        }
      }
    } finally {
      notifyListeners();
    }
  }

  @override
  void notifyListeners() {
    // An upload can finish after the service is gone (tests, app shutdown).
    if (!_disposed) super.notifyListeners();
  }

  Future<void> _tick() async {
    if (_onDuty && _positions == null) await _startStream();
    await flush();
    if (!_onDuty && _queue.isEmpty) _stopTimer();
  }

  Future<void> _startStream() async {
    if (_positions != null || !_onDuty) return;
    final issue = await _locationProblem();
    if (!_onDuty || _positions != null) return;
    if (issue != null) {
      problem = issue;
      notifyListeners();
      return;
    }
    problem = null;
    _positions = _positionStream(_settings()).listen(
      _onPosition,
      onError: (Object e) {
        _positions = null;
        problem = 'Route recording paused: ${_describe(e)}';
        notifyListeners();
      },
      cancelOnError: true,
    );
    notifyListeners();
  }

  Future<void> _stopStream() async {
    final sub = _positions;
    _positions = null;
    await sub?.cancel();
  }

  void _stopTimer() {
    _timer?.cancel();
    _timer = null;
  }

  void _onPosition(Position p) {
    lastPointAt = DateTime.now();
    if (!isWithinIndia(p.latitude, p.longitude)) {
      // An emulator's default position or a fake-GPS app: never save it.
      _outsideIndia = true;
      problem =
          'Your phone reports a location outside India, so route points are '
          'not being saved.';
      notifyListeners();
      return;
    }
    if (_outsideIndia) {
      _outsideIndia = false;
      problem = null;
    }
    if (!p.accuracy.isFinite || p.accuracy > _maxAccuracyMetres) {
      notifyListeners();
      return; // Too vague to map; the server would reject it.
    }
    _queue.add({
      'lat': p.latitude,
      'lng': p.longitude,
      'accuracy': p.accuracy,
      if (p.speed.isFinite && p.speed >= 0) 'speed': p.speed,
      if (p.heading.isFinite && p.heading >= 0) 'heading': p.heading,
      if (p.altitude.isFinite) 'altitude': p.altitude,
      'recordedAt': p.timestamp.toUtc().toIso8601String(),
      'source': _foreground ? 'foreground' : 'background',
    });
    if (_queue.length > _maxQueued) {
      _queue.removeRange(0, _queue.length - _maxQueued);
    }
    unawaited(_saveQueue());
    notifyListeners();
  }

  LocationSettings _settings() {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      return AndroidSettings(
        accuracy: LocationAccuracy.high,
        intervalDuration: const Duration(seconds: 30),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Shift in progress',
          notificationText:
              'Your route is being recorded while you are on duty.',
          notificationChannelName: 'Shift route recording',
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    }
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
      return AppleSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10,
        activityType: ActivityType.otherNavigation,
        pauseLocationUpdatesAutomatically: false,
        allowBackgroundLocationUpdates: true,
        showBackgroundLocationIndicator: true,
      );
    }
    return const LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 10,
    );
  }

  static String _queueKey(String agentId) => 'tracking.queue.$agentId';

  Future<void> _loadQueue(String agentId) async {
    _queue = [];
    _queueAgent = agentId;
    try {
      final raw = (await SharedPreferences.getInstance()).getString(
        _queueKey(agentId),
      );
      if (raw != null) {
        _queue = (jsonDecode(raw) as List<dynamic>)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      }
    } catch (e) {
      debugPrint('tracking: could not read queued points: $e');
    }
  }

  Future<void> _saveQueue() async {
    final agent = _queueAgent;
    if (agent == null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      if (_queue.isEmpty) {
        await prefs.remove(_queueKey(agent));
      } else {
        await prefs.setString(_queueKey(agent), jsonEncode(_queue));
      }
    } catch (e) {
      debugPrint('tracking: could not save queued points: $e');
    }
  }

  void _onAuthChanged() {
    if (_auth.session != null) return;
    // Signed out: stop. Queued points stay saved for that agent's next sign-in.
    _onDuty = false;
    _stopTimer();
    unawaited(_stopStream());
    _queue = [];
    _queueAgent = null;
    todayKm = null;
    problem = null;
    lastPointAt = null;
    lastUploadAt = null;
    notifyListeners();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (state == AppLifecycleState.resumed) {
      if (_onDuty && _positions == null) unawaited(_startStream());
      unawaited(flush());
    }
  }

  static Future<String?> _defaultLocationProblem() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return 'Location is turned off, so your route is not being recorded. '
            'Turn on location (GPS).';
      }
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return 'Location permission is off, so your route is not being '
            'recorded. Allow it in Settings.';
      }
    } catch (_) {
      // Platform without location: let the stream report it.
    }
    return null;
  }

  static String _describe(Object e) {
    if (e is LocationServiceDisabledException) return 'location is turned off.';
    if (e is PermissionDeniedException) {
      return 'location permission was removed.';
    }
    return e.toString();
  }

  @visibleForTesting
  Future<void> tickForTest() => _tick();

  @override
  void dispose() {
    _disposed = true;
    _auth.removeListener(_onAuthChanged);
    WidgetsBinding.instance.removeObserver(this);
    _stopTimer();
    unawaited(_stopStream());
    super.dispose();
  }
}
