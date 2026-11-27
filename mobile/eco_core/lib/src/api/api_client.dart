import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:http_parser/http_parser.dart';

import '../config.dart';
import 'token_store.dart';

/// An error from the API or the network, with a message fit to show the user.
class ApiException implements Exception {
  ApiException(this.message, {this.status, this.offline = false});

  final String message;
  final int? status;

  /// True when the request never reached the server (no internet, timeout).
  final bool offline;

  @override
  String toString() => message;
}

/// One page of a list: the rows and the total count.
class Paged {
  Paged({required this.items, required this.page, required this.limit, required this.total, this.extra = const {}});

  final List<Map<String, dynamic>> items;
  final int page;
  final int limit;
  final int total;

  /// Other top-level fields of the response (e.g. `unread` on notifications).
  final Map<String, dynamic> extra;

  bool get hasMore => page * limit < total;
}

/// The single HTTP client of an app. Adds the token, unwraps `{ success, data }`, turns
/// failures into [ApiException], and reports a rejected token through [onUnauthorized].
class ApiClient {
  ApiClient(this._store) {
    _dio = Dio(BaseOptions(
      baseUrl: EcoConfig.apiUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 60),
      headers: {'Accept': 'application/json'},
    ));
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _store.read();
        if (token != null && options.extra['auth'] != false) options.headers['Authorization'] = 'Bearer $token';
        handler.next(options);
      },
      onError: (error, handler) async {
        final sentToken = error.requestOptions.headers['Authorization'] != null;
        if (error.response?.statusCode == 401 && sentToken) {
          await _store.clear();
          onUnauthorized?.call();
        }
        handler.next(error);
      },
    ));
  }

  final TokenStore _store;
  late final Dio _dio;

  /// Called when the server rejects the stored token (expired, logged out, deactivated).
  void Function()? onUnauthorized;

  TokenStore get tokens => _store;

  static String _messageOf(dynamic data, int? status) {
    if (data is Map && data['message'] != null) {
      final m = data['message'];
      return m is List ? m.join('. ') : m.toString();
    }
    if (status == 401) return 'Your session has ended. Please sign in again.';
    if (status == 413) return 'The file is too large.';
    return 'Something went wrong (${status ?? 'no response'}). Please try again.';
  }

  ApiException _wrap(Object e) {
    if (e is ApiException) return e;
    if (e is DioException) {
      switch (e.type) {
        case DioExceptionType.connectionError:
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.receiveTimeout:
          return ApiException('No internet connection, or the server is not reachable. Check your network and try again.', offline: true);
        default:
          if (e.error is SocketException) return ApiException('No internet connection. Check your network and try again.', offline: true);
          return ApiException(_messageOf(e.response?.data, e.response?.statusCode), status: e.response?.statusCode);
      }
    }
    return ApiException(e.toString());
  }

  Future<Response<dynamic>> _send(Future<Response<dynamic>> Function() call) async {
    try {
      final res = await call();
      final body = res.data;
      if (body is Map && body['success'] == false) throw ApiException(_messageOf(body, res.statusCode), status: res.statusCode);
      return res;
    } catch (e) {
      throw _wrap(e);
    }
  }

  dynamic _data(Response<dynamic> res) => res.data is Map ? (res.data as Map)['data'] : res.data;

  Options _opts({Map<String, String>? headers, bool auth = true}) => Options(headers: headers, extra: {'auth': auth});

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async =>
      _data(await _send(() => _dio.get(path, queryParameters: _clean(query))));

  Future<dynamic> post(String path, {Object? body, Map<String, dynamic>? query, Map<String, String>? headers, bool auth = true}) async =>
      _data(await _send(() => _dio.post(path, data: body ?? <String, dynamic>{}, queryParameters: _clean(query), options: _opts(headers: headers, auth: auth))));

  Future<dynamic> patch(String path, {Object? body}) async => _data(await _send(() => _dio.patch(path, data: body)));

  /// A paged list (`{ data: [...], meta: { page, limit, total } }`).
  Future<Paged> page(String path, {Map<String, dynamic>? query}) async {
    final res = await _send(() => _dio.get(path, queryParameters: _clean(query)));
    final body = (res.data as Map).cast<String, dynamic>();
    final meta = (body['meta'] as Map?)?.cast<String, dynamic>() ?? {};
    final items = ((body['data'] as List?) ?? []).map((e) => (e as Map).cast<String, dynamic>()).toList();
    return Paged(
      items: items,
      page: (meta['page'] as num?)?.toInt() ?? 1,
      limit: (meta['limit'] as num?)?.toInt() ?? items.length,
      total: (meta['total'] as num?)?.toInt() ?? items.length,
      extra: Map.of(body)..removeWhere((k, _) => k == 'data' || k == 'meta' || k == 'success'),
    );
  }

  /// multipart/form-data with one JPG/PNG file in field `file`.
  Future<dynamic> upload(String path, File file, {Map<String, String> fields = const {}, Map<String, String>? headers}) async {
    final name = file.path.split(Platform.pathSeparator).last;
    final isPng = name.toLowerCase().endsWith('.png');
    final form = FormData.fromMap({
      ...fields,
      'file': await MultipartFile.fromFile(file.path, filename: name, contentType: MediaType('image', isPng ? 'png' : 'jpeg')),
    });
    return _data(await _send(() => _dio.post(path, data: form, options: _opts(headers: headers))));
  }

  /// Uploads a private image (`scope`: photo, receipt, warranty, proof) and returns its storage key.
  Future<String> uploadPrivate(File file, String scope) async {
    final r = await upload('/v1/uploads', file, fields: {'scope': scope});
    return (r as Map)['key'] as String;
  }

  static Map<String, dynamic>? _clean(Map<String, dynamic>? q) {
    if (q == null) return null;
    return Map.of(q)..removeWhere((_, v) => v == null || (v is String && v.isEmpty));
  }
}
