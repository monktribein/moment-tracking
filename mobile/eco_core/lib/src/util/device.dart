import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:uuid/uuid.dart';

/// One Idempotency-Key per form: retries after a network error reuse it, so the server
/// returns the record created the first time instead of a second copy. Call [reset] after success.
class SubmitKey {
  String value = const Uuid().v4();
  void reset() => value = const Uuid().v4();
}

/// Explains why a permission is needed before the system dialog appears; true when granted.
Future<bool> askPermission(BuildContext context, Permission permission, {required String title, required String why}) async {
  if (await permission.isGranted) return true;
  if (!context.mounted) return false;
  final go = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Text(why),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Not now')),
        FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Continue')),
      ],
    ),
  );
  if (go != true) return false;
  final status = await permission.request();
  if (status.isPermanentlyDenied && context.mounted) {
    final open = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Permission turned off'),
        content: const Text('Allow it in the app settings to use this feature.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Open settings')),
        ],
      ),
    );
    if (open == true) await openAppSettings();
    return false;
  }
  return status.isGranted || status.isLimited;
}

/// Camera permission with an explanation first (for apps that do not use permission_handler directly).
Future<bool> askCameraPermission(BuildContext context, {String why = 'The camera is used to scan serial numbers and take photos.'}) =>
    askPermission(context, Permission.camera, title: 'Camera', why: why);

/// Picks a photo from the camera or gallery, compresses it to JPEG and checks the 5 MB limit.
Future<File?> pickPhoto(BuildContext context, {int maxBytes = 5 * 1024 * 1024}) async {
  final source = await showModalBottomSheet<ImageSource>(
    context: context,
    showDragHandle: true,
    builder: (c) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take photo'), onTap: () => Navigator.pop(c, ImageSource.camera)),
        ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose from gallery'), onTap: () => Navigator.pop(c, ImageSource.gallery)),
      ]),
    ),
  );
  if (source == null || !context.mounted) return null;
  if (source == ImageSource.camera) {
    final ok = await askPermission(context, Permission.camera, title: 'Camera', why: 'The camera is used to photograph receipts, products and payment proofs.');
    if (!ok) return null;
  }
  final picked = await ImagePicker().pickImage(source: source, maxWidth: 2000, maxHeight: 2000, imageQuality: 90);
  if (picked == null) return null;
  final dir = await getTemporaryDirectory();
  final target = '${dir.path}/eco_${DateTime.now().millisecondsSinceEpoch}.jpg';
  final compressed = await FlutterImageCompress.compressAndGetFile(picked.path, target, quality: 75, minWidth: 1600, minHeight: 1600, format: CompressFormat.jpeg);
  final file = File(compressed?.path ?? picked.path);
  final lower = file.path.toLowerCase();
  if (!(lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png'))) {
    throw Exception('Only JPG or PNG images are accepted.');
  }
  if (await file.length() > maxBytes) throw Exception('The photo is larger than ${maxBytes ~/ (1024 * 1024)} MB. Try again with a smaller one.');
  return file;
}

Future<void> openPhone(String number) => launchUrl(Uri(scheme: 'tel', path: number.replaceAll(RegExp(r'\s'), '')));

Future<void> openWhatsApp(String digitsWithCountry) => launchUrl(Uri.parse('https://wa.me/${digitsWithCountry.replaceAll(RegExp(r'\D'), '')}'), mode: LaunchMode.externalApplication);

Future<void> openMaps(String address) =>
    launchUrl(Uri.parse('https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(address)}'), mode: LaunchMode.externalApplication);
