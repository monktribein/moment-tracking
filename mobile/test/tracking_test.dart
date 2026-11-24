import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:movement_tracking/api/api_client.dart';
import 'package:movement_tracking/api/api_service.dart';
import 'package:movement_tracking/models/tracking.dart';
import 'package:movement_tracking/services/auth_service.dart';
import 'package:movement_tracking/services/tracking_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _session = {
  'kind': 'field',
  'role': 'field_agent',
  'user': {'id': 'agent-1', 'name': 'Test Agent', 'phone': '9000000001'},
};

class _FakeApi extends ApiService {
  _FakeApi() : super(ApiClient());

  final batches = <List<Map<String, dynamic>>>[];
  bool fail = false;
  bool onDuty = true;

  @override
  Future<TrackingUpload> fieldRecordFixes(
    List<Map<String, dynamic>> fixes,
  ) async {
    if (fail) throw ApiException('Cannot reach server.');
    batches.add(List.of(fixes));
    return TrackingUpload(
      accepted: fixes.length,
      rejected: 0,
      onDuty: onDuty,
      totalKm: 1.25,
    );
  }
}

Position _at(double lat, double lng, {double accuracy = 8}) => Position(
  latitude: lat,
  longitude: lng,
  timestamp: DateTime.now(),
  accuracy: accuracy,
  altitude: 180,
  altitudeAccuracy: 3,
  heading: 90,
  headingAccuracy: 5,
  speed: 1.2,
  speedAccuracy: 0.5,
);

Future<void> _settle() => Future<void>.delayed(Duration.zero);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _FakeApi api;
  late AuthService auth;
  late StreamController<Position> positions;
  late TrackingService tracking;

  TrackingService newTracking() => TrackingService(
    api,
    auth,
    positionStream: (_) => positions.stream,
    locationProblem: () async => null,
  );

  setUp(() async {
    SharedPreferences.setMockInitialValues({
      'auth_token': 'token-1',
      'auth_session': jsonEncode(_session),
    });
    api = _FakeApi();
    auth = AuthService(api);
    await auth.init();
    positions = StreamController<Position>.broadcast();
    tracking = newTracking();
  });

  tearDown(() async {
    tracking.dispose();
    await positions.close();
  });

  test('records the route while on duty and uploads it', () async {
    await tracking.startShift();
    expect(tracking.onDuty, isTrue);
    expect(tracking.isRecording, isTrue);

    positions.add(_at(27.4924, 77.6737)); // Mathura
    positions.add(_at(27.4950, 77.6760));
    await _settle();
    expect(tracking.pendingPoints, 2);

    await tracking.flush();
    final batch = api.batches.single;
    expect(batch, hasLength(2));
    expect(batch.first['lat'], 27.4924);
    expect(batch.first['accuracy'], 8);
    expect(batch.first['recordedAt'], endsWith('Z'));
    expect(batch.first['source'], 'foreground');
    expect(tracking.pendingPoints, 0);
    expect(tracking.todayKm, 1.25);
  });

  test('never saves a fake (outside India) or vague position', () async {
    await tracking.startShift();
    positions.add(_at(27.4924, 77.6737, accuracy: 500)); // too vague
    positions.add(_at(37.4220, -122.0840)); // emulator default
    await _settle();
    expect(tracking.pendingPoints, 0);
    expect(tracking.problem, contains('outside India'));
  });

  test('keeps points through a failed upload and an app restart', () async {
    await tracking.startShift();
    positions.add(_at(27.4924, 77.6737));
    positions.add(_at(27.4950, 77.6760));
    await _settle();

    api.fail = true;
    await tracking.flush();
    expect(tracking.pendingPoints, 2);
    expect(tracking.problem, contains('waiting to upload'));
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('tracking.queue.agent-1'), isNotNull);

    // The app is closed and opened again, still on duty.
    tracking.dispose();
    tracking = newTracking();
    api.fail = false;
    await tracking.startShift();
    await tracking.flush();
    expect(api.batches.single, hasLength(2));
    expect(tracking.pendingPoints, 0);
    expect(prefs.getString('tracking.queue.agent-1'), isNull);
  });

  test('stops when the server says the shift is over', () async {
    await tracking.startShift();
    positions.add(_at(27.4924, 77.6737));
    await _settle();

    api.onDuty = false; // e.g. closed automatically after 9 hours
    await tracking.flush();
    expect(tracking.onDuty, isFalse);
    expect(tracking.isRecording, isFalse);
    expect(tracking.shiftEndedByServer, 1);
  });

  test('check-out sends the last points and stops recording', () async {
    await tracking.startShift();
    positions.add(_at(27.4924, 77.6737));
    await _settle();

    await tracking.endShift();
    expect(api.batches.single, hasLength(1));
    expect(tracking.isRecording, isFalse);
    expect(tracking.onDuty, isFalse);
  });

  test('signing out stops recording', () async {
    await tracking.startShift();
    await auth.logout();
    await _settle();
    expect(tracking.isRecording, isFalse);
    expect(tracking.onDuty, isFalse);
  });

  test('an expired login signs out; a wrong password does not', () async {
    final client = ApiClient();
    final service = ApiService(client);
    final authWithClient = AuthService(service);
    await authWithClient.init();
    expect(authWithClient.isAuthenticated, isTrue);

    await http.runWithClient(
      () async {
        // Saved login rejected by the server.
        await expectLater(
          service.fieldGetLeads(),
          throwsA(
            isA<ApiException>().having((e) => e.statusCode, 'statusCode', 401),
          ),
        );
        await _settle();
        expect(authWithClient.isAuthenticated, isFalse);
        expect(authWithClient.takeSignOutReason(), contains('expired'));

        // Signing in with a wrong password: no saved login, normal message.
        await expectLater(
          service.fieldLogin('9000000001', 'wrong'),
          throwsA(
            isA<ApiException>().having(
              (e) => e.message,
              'message',
              'Invalid credentials',
            ),
          ),
        );
        expect(authWithClient.takeSignOutReason(), isNull);
      },
      () => MockClient(
        (request) async =>
            http.Response(jsonEncode({'message': 'Invalid credentials'}), 401),
      ),
    );
  });
}
