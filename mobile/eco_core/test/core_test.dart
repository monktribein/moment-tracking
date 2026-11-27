import 'dart:convert';

import 'package:eco_core/eco_core.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('formats', () {
    test('rupees in the Indian grouping', () {
      expect(inr(125000), '₹1,25,000');
      expect(inr(1250.5), '₹1,250.50');
      expect(inr(null), '—');
      expect(inr('abc'), '—');
    });

    test('dates like 27 Nov 2026', () {
      expect(inDate('2026-11-27'), '27 Nov 2026');
      expect(inDate(null), '—');
    });

    test('words and hours', () {
      expect(words('in_progress'), 'In progress');
      expect(hoursText(324), '05:24 Hrs');
    });
  });

  group('mobile numbers', () {
    test('keeps the last 10 digits and validates them', () {
      expect(digits10('+91 98765 43210'), '9876543210');
      expect(validateMobile('9876543210'), isNull);
      expect(validateMobile('12345'), isNotNull);
      expect(validateMobile('5876543210'), isNotNull);
    });
  });

  group('token expiry', () {
    test('reads the exp claim of a JWT', () {
      String part(Map<String, dynamic> m) => base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
      final token = '${part({'alg': 'HS256'})}.${part({'sub': 'x', 'exp': 1800000000})}.sig';
      expect(TokenStore.expiryOf(token), DateTime.fromMillisecondsSinceEpoch(1800000000 * 1000));
      expect(TokenStore.expiryOf('not-a-token'), isNull);
    });
  });

  group('idempotency key', () {
    test('stays the same until reset', () {
      final k = SubmitKey();
      final first = k.value;
      expect(k.value, first);
      k.reset();
      expect(k.value, isNot(first));
    });
  });
}
