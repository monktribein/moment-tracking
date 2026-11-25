/// Rough bounding box of India. The field team works in India, so a fix
/// outside it is not an agent's real position: it is an emulator's default
/// location (Google's office in California) or a fake-GPS app.
bool isWithinIndia(double lat, double lng) =>
    lat >= 6.0 && lat <= 37.6 && lng >= 68.0 && lng <= 97.6;

/// The server's answer to a batch of route points.
class TrackingUpload {
  final int accepted;
  final int rejected;

  /// False once the shift is over (checked out, or closed automatically):
  /// the phone should stop recording.
  final bool onDuty;

  /// Today's distance so far, measured by the server.
  final double? totalKm;

  const TrackingUpload({
    required this.accepted,
    required this.rejected,
    required this.onDuty,
    this.totalKm,
  });

  factory TrackingUpload.fromJson(Map<String, dynamic> json) {
    final summary = json['summary'];
    return TrackingUpload(
      accepted: (json['accepted'] as num?)?.toInt() ?? 0,
      rejected: (json['rejected'] as num?)?.toInt() ?? 0,
      onDuty: json['onDuty'] != false,
      totalKm: summary is Map ? (summary['totalKm'] as num?)?.toDouble() : null,
    );
  }
}

/// The signed-in agent's attendance for one day.
class AttendanceRecord {
  final String id;
  final String date;
  final bool checkedIn;
  final bool checkedOut;
  final DateTime? checkInTime;
  final DateTime? checkOutTime;
  final double? totalKm;
  final String? status; // present, half_day, absent

  AttendanceRecord({
    required this.id,
    required this.date,
    required this.checkedIn,
    required this.checkedOut,
    this.checkInTime,
    this.checkOutTime,
    this.totalKm,
    this.status,
  });

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) {
    final data = json['record'] is Map<String, dynamic>
        ? json['record'] as Map<String, dynamic>
        : json;
    return AttendanceRecord(
      id: data['_id']?.toString() ?? data['id']?.toString() ?? '',
      date: data['date']?.toString() ?? '',
      checkedIn: data['checkedIn'] == true || data['checkIn'] != null,
      checkedOut: data['checkedOut'] == true || data['checkOut'] != null,
      checkInTime: data['checkInTime'] != null
          ? DateTime.tryParse(data['checkInTime'].toString())
          : (data['checkIn']?['time'] != null
                ? DateTime.tryParse(data['checkIn']['time'].toString())
                : null),
      checkOutTime: data['checkOutTime'] != null
          ? DateTime.tryParse(data['checkOutTime'].toString())
          : (data['checkOut']?['time'] != null
                ? DateTime.tryParse(data['checkOut']['time'].toString())
                : null),
      totalKm:
          (data['totalKm'] as num?)?.toDouble() ??
          (data['distanceKm'] as num?)?.toDouble(),
      status: data['status']?.toString(),
    );
  }
}
