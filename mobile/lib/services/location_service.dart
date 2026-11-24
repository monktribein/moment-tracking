import 'dart:async';

import 'package:geolocator/geolocator.dart';

import '../models/tracking.dart';

class LocationResult {
  final double latitude;
  final double longitude;
  final double? accuracy;

  LocationResult({
    required this.latitude,
    required this.longitude,
    this.accuracy,
  });
}

/// A location problem whose message can be shown to the user as is.
class LocationException implements Exception {
  final String message;

  LocationException(this.message);

  @override
  String toString() => message;
}

class LocationService {
  /// A fresh, precise GPS fix of where the phone really is.
  ///
  /// Throws [LocationException] when location is off or denied, when only
  /// approximate location is allowed, when no fix arrives in time, or when
  /// the fix is outside India (an emulator's default location or a fake-GPS
  /// app). A wrong position is never handed back to be saved.
  static Future<LocationResult> getCurrentLocation() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw LocationException(
        'Location is turned off. Turn on location (GPS) on this phone and try again.',
      );
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        throw LocationException(
          'Location permission was denied. Allow location access to continue.',
        );
      }
    }
    if (permission == LocationPermission.deniedForever) {
      throw LocationException(
        'Location permission is blocked. Enable it in App Settings → Permissions → Location.',
      );
    }

    // Android 12+ and iOS 14+ let the user allow only approximate location,
    // which can be kilometres off. Ask once to upgrade to precise.
    if (await _approximateOnly()) {
      await Geolocator.requestPermission();
      if (await _approximateOnly()) {
        throw LocationException(
          'Only approximate location is allowed. In App Settings → Permissions → '
          'Location, turn on "Use precise location".',
        );
      }
    }

    final Position pos;
    try {
      pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 20),
        ),
      );
    } on TimeoutException {
      throw LocationException(
        'Could not get a GPS fix. Move near a window or outdoors and try again.',
      );
    }

    if (!isWithinIndia(pos.latitude, pos.longitude)) {
      throw LocationException(
        'This phone reported a location outside India '
        '(${pos.latitude.toStringAsFixed(4)}, ${pos.longitude.toStringAsFixed(4)}), '
        'so it was not used. On an emulator, set its location in '
        'Extended controls → Location. On a phone, turn off any fake-GPS app.',
      );
    }

    return LocationResult(
      latitude: pos.latitude,
      longitude: pos.longitude,
      accuracy: pos.accuracy,
    );
  }

  static Future<bool> _approximateOnly() async {
    try {
      return await Geolocator.getLocationAccuracy() ==
          LocationAccuracyStatus.reduced;
    } catch (_) {
      return false; // Not supported on this platform.
    }
  }
}
