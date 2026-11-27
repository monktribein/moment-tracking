import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';

/// A single GPS fix for a check-in (no continuous tracking). Throws a readable message on failure.
/// It lives in the employee app so the customer app does not include any location code.
Future<Position> currentFix(BuildContext context) async {
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw Exception('Location is turned off. Turn on GPS and try again.');
  }
  if (!context.mounted) throw Exception('Cancelled');
  final ok = await askPermission(context, Permission.locationWhenInUse,
      title: 'Location for check-in', why: 'Eco Sor takes your location once at each check-in or check-out. It does not track you in the background.');
  if (!ok) throw Exception('Location permission is needed to check in.');
  return Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 25)));
}
