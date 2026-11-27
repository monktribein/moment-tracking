/// Build-time settings, passed with `--dart-define`.
///
/// flutter run --dart-define=API_URL=https://api.example.com/api
class EcoConfig {
  EcoConfig._();

  /// The backend base URL, ending in `/api` (the apps call its `/v1/...` routes).
  /// Default: the Android emulator's address for a backend on this computer.
  static const String apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:5100/api');

  /// Support phone for "Contact support" (digits with country code, e.g. 919876543210).
  static const String supportPhone = String.fromEnvironment('SUPPORT_PHONE', defaultValue: '');

  /// Support WhatsApp number (digits with country code). Falls back to [supportPhone].
  static const String supportWhatsApp = String.fromEnvironment('SUPPORT_WHATSAPP', defaultValue: '');

  /// Company id for customer self-registration when the platform hosts several companies.
  static const String companyId = String.fromEnvironment('COMPANY_ID', defaultValue: '');
}
