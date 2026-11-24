import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../api/api_service.dart';
import '../../models/tracking.dart';
import '../../services/auth_service.dart';
import '../../services/tracking_service.dart';
import '../../theme/app_theme.dart';

class FieldProfileScreen extends StatefulWidget {
  const FieldProfileScreen({super.key});

  @override
  State<FieldProfileScreen> createState() => _FieldProfileScreenState();
}

class _FieldProfileScreenState extends State<FieldProfileScreen> {
  AttendanceRecord? _todayRecord;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _loadProfileData();
  }

  Future<void> _loadProfileData() async {
    setState(() => _loading = true);
    try {
      final record = await context.read<ApiService>().fieldAttendanceToday();
      if (mounted) {
        setState(() {
          _todayRecord = record;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _formatTime(DateTime? dt) {
    if (dt == null) return '--:--';
    return DateFormat('hh:mm a').format(dt.toLocal());
  }

  Future<void> _handleLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Log Out'),
        content: const Text(
          'Are you sure you want to log out of your field account? If you '
          'are on duty, your route stops being recorded until you sign in '
          'again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.danger,
              foregroundColor: Colors.white,
              // The app theme makes buttons full width; not in a dialog.
              minimumSize: const Size(0, 40),
            ),
            child: const Text('Log Out'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      await context.read<AuthService>().logout();
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthService>().session;
    final liveKm = context.watch<TrackingService>().todayKm;
    final isCheckedIn =
        _todayRecord?.checkedIn == true && _todayRecord?.checkedOut != true;
    final isCheckedOut = _todayRecord?.checkedOut == true;

    final dutyStatusText = isCheckedIn
        ? 'ON DUTY'
        : isCheckedOut
        ? 'SHIFT COMPLETED'
        : 'NOT STARTED';

    final dutyStatusColor = isCheckedIn
        ? AppColors.success
        : isCheckedOut
        ? AppColors.primary
        : AppColors.muted;

    final dutyStatusBg = isCheckedIn
        ? AppColors.successLight
        : isCheckedOut
        ? AppColors.primaryLight
        : const Color(0xFFF1F5F9);

    final initials = (user?.name.trim().isNotEmpty == true)
        ? user!.name
              .trim()
              .split(' ')
              .map((e) => e.isNotEmpty ? e[0] : '')
              .take(2)
              .join()
              .toUpperCase()
        : 'FA';

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Profile'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadProfileData,
            tooltip: 'Refresh Profile',
          ),
          IconButton(
            icon: const Icon(Icons.logout, color: AppColors.danger),
            onPressed: _handleLogout,
            tooltip: 'Log Out',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadProfileData,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    // ── Header Card ──────────────────────────────────────────
                    Card(
                      elevation: 1.5,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          vertical: 24,
                          horizontal: 16,
                        ),
                        child: Column(
                          children: [
                            CircleAvatar(
                              radius: 40,
                              backgroundColor: AppColors.primaryLight,
                              child: Text(
                                initials,
                                style: const TextStyle(
                                  fontSize: 26,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.primary,
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            Text(
                              user?.name ?? 'Field Staff',
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w800,
                                color: AppColors.text,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              user?.phone ?? '',
                              style: const TextStyle(
                                fontSize: 14,
                                color: AppColors.muted,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 4,
                                  ),
                                  decoration: BoxDecoration(
                                    color: AppColors.primaryLight,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    user?.role
                                            .replaceAll('_', ' ')
                                            .toUpperCase() ??
                                        'FIELD AGENT',
                                    style: const TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w800,
                                      color: AppColors.primary,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 4,
                                  ),
                                  decoration: BoxDecoration(
                                    color: dutyStatusBg,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    dutyStatusText,
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w800,
                                      color: dutyStatusColor,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    // ── Staff & Jurisdiction Details ─────────────────────────
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Icon(
                                  Icons.badge,
                                  size: 20,
                                  color: AppColors.primary,
                                ),
                                SizedBox(width: 8),
                                Text(
                                  'Staff Information',
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.text,
                                  ),
                                ),
                              ],
                            ),
                            const Divider(height: 24),
                            _buildInfoRow(
                              label: 'Assigned District',
                              value: user?.district ?? 'Mathura',
                              icon: Icons.location_city,
                            ),
                            _buildInfoRow(
                              label: 'Assigned State',
                              value: user?.state ?? 'Uttar Pradesh',
                              icon: Icons.map,
                            ),
                            _buildInfoRow(
                              label: 'Mobile Phone',
                              value: user?.phone ?? 'Not set',
                              icon: Icons.phone_android,
                              canCopy: true,
                            ),
                            if (user?.employeeCode != null &&
                                user!.employeeCode!.isNotEmpty)
                              _buildInfoRow(
                                label: 'Employee Code',
                                value: user.employeeCode!,
                                icon: Icons.numbers,
                              ),
                            if (user?.email != null && user!.email!.isNotEmpty)
                              _buildInfoRow(
                                label: 'Email Address',
                                value: user.email!,
                                icon: Icons.email,
                              ),
                            _buildInfoRow(
                              label: 'Staff ID',
                              value: user?.id.isNotEmpty == true
                                  ? user!.id
                                  : 'Active',
                              icon: Icons.fingerprint,
                              canCopy: true,
                            ),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    // ── Today's Duty & Attendance Card ───────────────────────
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Icon(
                                  Icons.timer_outlined,
                                  size: 20,
                                  color: AppColors.primary,
                                ),
                                SizedBox(width: 8),
                                Text(
                                  "Today's Shift & Duty",
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.text,
                                  ),
                                ),
                              ],
                            ),
                            const Divider(height: 24),
                            Row(
                              children: [
                                Expanded(
                                  child: _buildMetricTile(
                                    label: 'Check-In',
                                    value: _formatTime(
                                      _todayRecord?.checkInTime,
                                    ),
                                    icon: Icons.login,
                                    color: AppColors.success,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: _buildMetricTile(
                                    label: 'Check-Out',
                                    value: _formatTime(
                                      _todayRecord?.checkOutTime,
                                    ),
                                    icon: Icons.logout,
                                    color: isCheckedOut
                                        ? AppColors.primary
                                        : AppColors.muted,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Row(
                              children: [
                                Expanded(
                                  child: _buildMetricTile(
                                    label: 'Distance Covered',
                                    value:
                                        '${(liveKm ?? _todayRecord?.totalKm ?? 0.0).toStringAsFixed(2)} km',
                                    icon: Icons.route,
                                    color: AppColors.primary,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: _buildMetricTile(
                                    label: 'Shift Status',
                                    value: dutyStatusText,
                                    icon: Icons.work_outline,
                                    color: dutyStatusColor,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    // ── Server & App Connectivity Card ───────────────────────
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Icon(
                                  Icons.cloud_done,
                                  size: 20,
                                  color: AppColors.success,
                                ),
                                SizedBox(width: 8),
                                Text(
                                  'System & Server Status',
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.text,
                                  ),
                                ),
                              ],
                            ),
                            const Divider(height: 24),
                            _buildInfoRow(
                              label: 'Backend Server',
                              value: 'Render Cloud (Active)',
                              icon: Icons.cloud,
                            ),
                            _buildInfoRow(
                              label: 'Server URL',
                              value: 'moment-tracking.onrender.com/api',
                              icon: Icons.link,
                            ),
                            _buildInfoRow(
                              label: 'GPS Tracking',
                              value: 'Satellite + Network (High Accuracy)',
                              icon: Icons.my_location,
                            ),
                            _buildInfoRow(
                              label: 'Application Build',
                              value: 'v1.0.0 (Flutter Production)',
                              icon: Icons.smartphone,
                            ),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 24),

                    // ── Sign Out Button ──────────────────────────────────────
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        onPressed: _handleLogout,
                        icon: const Icon(Icons.logout),
                        label: const Text('Sign Out from Device'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: AppColors.danger,
                          side: const BorderSide(color: AppColors.danger),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                      ),
                    ),

                    const SizedBox(height: 32),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildInfoRow({
    required String label,
    required String value,
    required IconData icon,
    bool canCopy = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.muted),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.text,
                  ),
                ),
              ],
            ),
          ),
          if (canCopy)
            IconButton(
              icon: const Icon(Icons.copy, size: 16, color: AppColors.muted),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: value));
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('$label copied to clipboard'),
                    duration: const Duration(seconds: 2),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _buildMetricTile({
    required String label,
    required String value,
    required IconData icon,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 6),
              Text(
                label,
                style: const TextStyle(fontSize: 11, color: AppColors.muted),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
