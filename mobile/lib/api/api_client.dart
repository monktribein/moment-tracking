import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

class ApiException implements Exception {
  final String message;
  final int statusCode;

  ApiException(this.message, {this.statusCode = 0});

  @override
  String toString() => message;
}

class ApiClient {
  static const String defaultBaseUrl =
      'https://moment-tracking.onrender.com/api';

  /// The server sleeps when idle and can take close to a minute to wake.
  static const Duration timeout = Duration(seconds: 60);

  final String baseUrl;
  String? token;

  /// Called when the server rejects the saved login (expired or revoked),
  /// so the app can sign the agent out instead of failing every request.
  void Function()? onUnauthorized;

  ApiClient({this.baseUrl = defaultBaseUrl, this.token});

  Map<String, String> _headers() {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (token != null && token!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  dynamic _handleResponse(http.Response res) {
    dynamic body;
    try {
      body = jsonDecode(res.body);
    } catch (_) {
      body = res.body;
    }

    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (body is Map<String, dynamic> && body.containsKey('data')) {
        return body['data'];
      }
      return body;
    }

    // 401 with a saved login means it expired; a wrong password at sign-in
    // (no saved login yet) is reported normally below.
    if (res.statusCode == 401 && (token?.isNotEmpty ?? false)) {
      onUnauthorized?.call();
      throw ApiException(
        'Your session has expired. Please sign in again.',
        statusCode: 401,
      );
    }

    String message = 'Request failed (${res.statusCode})';
    if (body is Map<String, dynamic>) {
      message =
          body['message']?.toString() ?? body['error']?.toString() ?? message;
    } else if (body is String && body.isNotEmpty) {
      message = body;
    }

    throw ApiException(message, statusCode: res.statusCode);
  }

  /// Sends a request and turns network failures into readable messages.
  Future<dynamic> _send(Future<http.Response> Function() request) async {
    try {
      final res = await request().timeout(timeout);
      return _handleResponse(res);
    } on SocketException {
      throw ApiException(
        'Cannot reach server. Please check internet connection.',
      );
    } on TimeoutException {
      throw ApiException(
        'The server is taking too long to respond (it may be starting up). '
        'Please try again in a minute.',
      );
    } catch (e) {
      if (e is ApiException) rethrow;
      throw ApiException(e.toString());
    }
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) {
    var uri = Uri.parse('$baseUrl$path');
    if (query != null && query.isNotEmpty) {
      final stringQuery = query.map((k, v) => MapEntry(k, v.toString()));
      uri = uri.replace(queryParameters: stringQuery);
    }
    return _send(() => http.get(uri, headers: _headers()));
  }

  Future<dynamic> post(String path, {dynamic body}) {
    final uri = Uri.parse('$baseUrl$path');
    return _send(
      () => http.post(
        uri,
        headers: _headers(),
        body: body != null ? jsonEncode(body) : null,
      ),
    );
  }

  Future<dynamic> put(String path, {dynamic body}) {
    final uri = Uri.parse('$baseUrl$path');
    return _send(
      () => http.put(
        uri,
        headers: _headers(),
        body: body != null ? jsonEncode(body) : null,
      ),
    );
  }

  Future<dynamic> delete(String path) {
    final uri = Uri.parse('$baseUrl$path');
    return _send(() => http.delete(uri, headers: _headers()));
  }
}
