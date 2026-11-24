import '../models/lead.dart';
import '../models/tracking.dart';
import 'api_client.dart';

/// Backend calls made by the field staff app.
class ApiService {
  final ApiClient client;

  ApiService(this.client);

  void setToken(String? token) {
    client.token = token;
  }

  // ── Authentication ──────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> fieldLogin(String phone, String password) async {
    final cleanPhone = phone.replaceAll(RegExp(r'\D'), '');
    final res = await client.post(
      '/lead-collection/auth/login',
      body: {'phone': cleanPhone, 'password': password},
    );
    return res as Map<String, dynamic>;
  }

  // ── Field Agent: Shift & Attendance ─────────────────────────────────────────

  Future<AttendanceRecord?> fieldAttendanceToday() async {
    try {
      final res = await client.get('/lead-collection/agent/attendance/today');
      return AttendanceRecord.fromJson(res as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>> fieldCheckIn(
    double lat,
    double lng,
    String? address, {
    double? accuracy,
  }) async {
    final coords = <String, dynamic>{'lat': lat, 'lng': lng};
    if (accuracy != null) coords['accuracy'] = accuracy;
    final body = <String, dynamic>{'coords': coords};
    if (address != null) body['address'] = address;

    final res = await client.post(
      '/lead-collection/agent/attendance/check-in',
      body: body,
    );
    return res as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> fieldCheckOut(
    double lat,
    double lng,
    String? address, {
    double? accuracy,
  }) async {
    final coords = <String, dynamic>{'lat': lat, 'lng': lng};
    if (accuracy != null) coords['accuracy'] = accuracy;
    final body = <String, dynamic>{'coords': coords};
    if (address != null) body['address'] = address;

    final res = await client.post(
      '/lead-collection/agent/attendance/check-out',
      body: body,
    );
    return res as Map<String, dynamic>;
  }

  Future<void> fieldGrantConsent() async {
    await client.post(
      '/lead-collection/agent/tracking/consent',
      body: {'granted': true},
    );
  }

  /// Uploads up to 100 route points recorded during the shift.
  Future<TrackingUpload> fieldRecordFixes(
    List<Map<String, dynamic>> fixes,
  ) async {
    final res = await client.post(
      '/lead-collection/agent/tracking/fixes',
      body: {'fixes': fixes},
    );
    return TrackingUpload.fromJson(res as Map<String, dynamic>);
  }

  // ── Field Agent: Leads ──────────────────────────────────────────────────────

  Future<Lead> fieldCreateLead(Map<String, dynamic> data) async {
    final res = await client.post('/lead-collection/agent/leads', body: data);
    return Lead.fromJson(res as Map<String, dynamic>);
  }

  Future<List<Lead>> fieldGetLeads({String? search, String? status}) async {
    final query = <String, dynamic>{'limit': 200};
    if (search != null && search.trim().isNotEmpty) {
      query['search'] = search.trim();
    }
    if (status != null && status != 'all') {
      query['status'] = status;
    }
    final res = await client.get('/lead-collection/agent/leads', query: query);
    if (res is Map<String, dynamic> && res['items'] is List) {
      return (res['items'] as List)
          .map((e) => Lead.fromJson(e as Map<String, dynamic>))
          .toList();
    }
    if (res is List) {
      return res.map((e) => Lead.fromJson(e as Map<String, dynamic>)).toList();
    }
    return [];
  }
}
