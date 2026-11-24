/// The signed-in field staff member.
class UserSession {
  final String token;
  final String role;
  final String kind; // always 'field'
  final String id;
  final String name;
  final String? email;
  final String? phone;
  final String? district;
  final String? state;
  final String? employeeCode;

  UserSession({
    required this.token,
    required this.role,
    required this.kind,
    required this.id,
    required this.name,
    this.email,
    this.phone,
    this.district,
    this.state,
    this.employeeCode,
  });

  bool get isSupervisor => role == 'field_supervisor';

  factory UserSession.fromFieldJson(Map<String, dynamic> json, String token) {
    final user = json['user'] as Map<String, dynamic>? ?? json;
    return UserSession(
      token: token,
      role: user['role']?.toString() ?? 'field_agent',
      kind: 'field',
      id: user['_id']?.toString() ?? user['id']?.toString() ?? '',
      name: user['name']?.toString() ?? 'Field Staff',
      phone: user['phone']?.toString(),
      district: user['district']?.toString(),
      state: user['state']?.toString(),
      employeeCode: user['employeeCode']?.toString(),
      email: user['email']?.toString(),
    );
  }
}
