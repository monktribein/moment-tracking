import 'package:intl/intl.dart';

/// Indian formats: ₹1,25,000 and "27 Nov 2026".
final _inr = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
final _inr2 = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);

String inr(Object? v) {
  final n = v is num ? v : num.tryParse('${v ?? ''}');
  if (n == null) return '—';
  return n % 1 == 0 ? _inr.format(n) : _inr2.format(n);
}

DateTime? _parse(Object? v) {
  if (v == null) return null;
  if (v is DateTime) return v.toLocal();
  final s = v.toString();
  if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s)) return DateTime.tryParse('${s}T12:00:00');
  return DateTime.tryParse(s)?.toLocal();
}

String inDate(Object? v) {
  final d = _parse(v);
  return d == null ? '—' : DateFormat('dd MMM yyyy').format(d);
}

String inDateTime(Object? v) {
  final d = _parse(v);
  return d == null ? '—' : DateFormat('dd MMM yyyy, hh:mm a').format(d);
}

String inTime(Object? v) {
  final d = _parse(v);
  return d == null ? '—' : DateFormat('hh:mm a').format(d);
}

/// YYYY-MM-DD for the API (local day).
String apiDay(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

/// Today in India, the day the server uses.
String todayIst() => apiDay(DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30)));

/// "in_progress" -> "In progress".
String words(Object? s) {
  final t = (s ?? '').toString().replaceAll('_', ' ');
  return t.isEmpty ? '' : t[0].toUpperCase() + t.substring(1);
}

String greeting([DateTime? now]) {
  final h = (now ?? DateTime.now()).hour;
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

String hoursText(num? minutes) {
  if (minutes == null) return '—';
  final m = minutes.round();
  return '${(m ~/ 60).toString().padLeft(2, '0')}:${(m % 60).toString().padLeft(2, '0')} Hrs';
}
