class Lead {
  final String id;
  final String name;
  final LeadLocation location;
  final LeadContact contact;
  final RoomInventory roomInventory;
  final String status; // pending, approved, rejected, converted
  final String interest;
  final String notes;
  final String capturedByName;
  final DateTime capturedAt;
  final List<String> images;

  Lead({
    required this.id,
    required this.name,
    required this.location,
    required this.contact,
    required this.roomInventory,
    required this.status,
    required this.interest,
    required this.notes,
    required this.capturedByName,
    required this.capturedAt,
    this.images = const [],
  });

  factory Lead.fromJson(Map<String, dynamic> json) {
    return Lead(
      id: json['_id']?.toString() ?? json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? 'Unnamed Property',
      location: LeadLocation.fromJson(
        json['location'] as Map<String, dynamic>? ?? {},
      ),
      contact: LeadContact.fromJson(
        json['contact'] as Map<String, dynamic>? ?? {},
      ),
      roomInventory: RoomInventory.fromJson(
        json['roomInventory'] as Map<String, dynamic>? ?? {},
      ),
      status: json['status']?.toString().toLowerCase() ?? 'pending',
      interest: json['interest']?.toString() ?? 'Interested',
      notes: json['notes']?.toString() ?? json['agentNotes']?.toString() ?? '',
      capturedByName: json['capturedByName']?.toString() ?? 'Field Agent',
      // The server sends UTC; the agent's dates and times are local (IST).
      capturedAt:
          (DateTime.tryParse(json['capturedAt']?.toString() ?? '') ??
                  DateTime.now())
              .toLocal(),
      images:
          (json['images'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          [],
    );
  }

  bool get isToday {
    final now = DateTime.now();
    return capturedAt.year == now.year &&
        capturedAt.month == now.month &&
        capturedAt.day == now.day;
  }

  bool get isYesterday {
    final yest = DateTime.now().subtract(const Duration(days: 1));
    return capturedAt.year == yest.year &&
        capturedAt.month == yest.month &&
        capturedAt.day == yest.day;
  }

  bool get isTomorrow {
    final tom = DateTime.now().add(const Duration(days: 1));
    return capturedAt.year == tom.year &&
        capturedAt.month == tom.month &&
        capturedAt.day == tom.day;
  }

  bool matchesDate(DateTime target) {
    return capturedAt.year == target.year &&
        capturedAt.month == target.month &&
        capturedAt.day == target.day;
  }

  bool matchesDateRange(DateTime start, DateTime end) {
    final s = DateTime(start.year, start.month, start.day);
    final e = DateTime(end.year, end.month, end.day, 23, 59, 59, 999);
    return capturedAt.isAfter(s.subtract(const Duration(milliseconds: 1))) &&
        capturedAt.isBefore(e.add(const Duration(milliseconds: 1)));
  }
}

class LeadLocation {
  final String address;
  final String city;
  final String district;
  final String state;
  final double? lat;
  final double? lng;

  LeadLocation({
    required this.address,
    required this.city,
    required this.district,
    required this.state,
    this.lat,
    this.lng,
  });

  factory LeadLocation.fromJson(Map<String, dynamic> json) {
    final coords = json['coordinates'] as Map<String, dynamic>?;
    return LeadLocation(
      address: json['address']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      district: json['district']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      lat:
          (coords?['lat'] as num?)?.toDouble() ??
          (json['lat'] as num?)?.toDouble(),
      lng:
          (coords?['lng'] as num?)?.toDouble() ??
          (json['lng'] as num?)?.toDouble(),
    );
  }

  String get formattedAddress {
    final parts = [
      address,
      city,
      district,
      state,
    ].where((s) => s.trim().isNotEmpty).toList();
    return parts.join(', ');
  }
}

class LeadContact {
  final String ownerName;
  final String phone;

  LeadContact({required this.ownerName, required this.phone});

  factory LeadContact.fromJson(Map<String, dynamic> json) {
    return LeadContact(
      ownerName: json['ownerName']?.toString() ?? 'Owner',
      phone: json['phone']?.toString() ?? '',
    );
  }
}

class RoomInventory {
  final int? totalRooms;
  final double? roomPrice;

  RoomInventory({this.totalRooms, this.roomPrice});

  factory RoomInventory.fromJson(Map<String, dynamic> json) {
    return RoomInventory(
      totalRooms: (json['totalRooms'] as num?)?.toInt(),
      roomPrice: (json['roomPrice'] as num?)?.toDouble(),
    );
  }
}
