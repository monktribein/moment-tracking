import 'package:flutter_test/flutter_test.dart';
import 'package:movement_tracking/models/lead.dart';
import 'package:movement_tracking/models/tracking.dart';

void main() {
  test('Lead model parses JSON correctly', () {
    final json = {
      '_id': 'lead_123',
      'name': 'Krishna Heritage',
      'location': {
        'address': 'Main Road',
        'city': 'Mathura',
        'district': 'Mathura',
        'state': 'Uttar Pradesh',
        'coordinates': {'lat': 27.4924, 'lng': 77.6737},
      },
      'contact': {'ownerName': 'Rajesh', 'phone': '9876543210'},
      'status': 'approved',
      'interest': 'Interested',
      'capturedByName': 'Field Agent',
    };

    final lead = Lead.fromJson(json);
    expect(lead.id, 'lead_123');
    expect(lead.name, 'Krishna Heritage');
    expect(lead.location.city, 'Mathura');
    expect(lead.location.lat, 27.4924);
    expect(lead.contact.ownerName, 'Rajesh');
    expect(lead.status, 'approved');
  });

  test('AttendanceRecord parses today\'s shift for the agent', () {
    final record = AttendanceRecord.fromJson({
      'record': {
        '_id': 'att_1',
        'date': '2026-11-24',
        'checkedIn': true,
        'checkedOut': false,
        'checkInTime': '2026-11-24T04:12:00.000Z',
        'status': 'checked_in',
      },
    });
    expect(record.id, 'att_1');
    expect(record.checkedIn, isTrue);
    expect(record.checkedOut, isFalse);
    expect(record.checkInTime, DateTime.utc(2026, 11, 24, 4, 12));
    expect(record.status, 'checked_in');
  });

  test('isWithinIndia accepts Indian fixes, rejects the emulator default', () {
    expect(isWithinIndia(27.4924, 77.6737), isTrue); // Mathura
    expect(isWithinIndia(30.3165, 78.0322), isTrue); // Dehradun
    expect(isWithinIndia(37.4220, -122.0840), isFalse); // Android emulator
  });
}
