import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../api/api_service.dart';
import '../../models/tracking.dart';
import '../../services/auth_service.dart';
import '../../services/location_service.dart';
import '../../services/tracking_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/app_logo.dart';
import 'field_create_lead_screen.dart';

class FieldShiftScreen extends StatefulWidget {
  final VoidCallback? onNavigateToLeads;
  final VoidCallback? onNavigateToProfile;

  /// Called after the capture form closes, so the leads list can refresh.
  final VoidCallback? onLeadCaptured;

  const FieldShiftScreen({
    super.key,
    this.onNavigateToLeads,
    this.onNavigateToProfile,
    this.onLeadCaptured,
  });

  @override
  State<FieldShiftScreen> createState() => _FieldShiftScreenState();
}

class _FieldShiftScreenState extends State<FieldShiftScreen> {
  AttendanceRecord? _today;
  bool _loading = true;
  bool _acting = false;
  late final TrackingService _tracking;
  int _seenShiftEnds = 0;

  @override
  void initState() {
    super.initState();
    _tracking = context.read<TrackingService>();
    _seenShiftEnds = _tracking.shiftEndedByServer;
    _tracking.addListener(_onTrackingChanged);
    _loadShift();
  }

  @override
  void dispose() {
    _tracking.removeListener(_onTrackingChanged);
    super.dispose();
  }

  /// The server closed the shift (checked out elsewhere or automatically).
  void _onTrackingChanged() {
    if (_tracking.shiftEndedByServer != _seenShiftEnds) {
      _seenShiftEnds = _tracking.shiftEndedByServer;
      if (mounted) _loadShift();
    }
  }

  Future<void> _loadShift() async {
    setState(() => _loading = true);
    try {
      final rec = await context.read<ApiService>().fieldAttendanceToday();
      if (mounted) {
        setState(() {
          _today = rec;
          _loading = false;
        });
        // Route recording follows the shift, including after an app restart.
        final onDuty = rec?.checkedIn == true && rec?.checkedOut != true;
        if (onDuty) {
          await _tracking.startShift();
        } else if (rec != null && _tracking.onDuty) {
          await _tracking.endShift();
        }
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _handleCheckIn() async {
    setState(() => _acting = true);
    final api = context.read<ApiService>();
    try {
      // 1. Grant consent
      await api.fieldGrantConsent();

      // 2. Fetch high accuracy current fix
      final loc = await LocationService.getCurrentLocation();

      // 3. Check in
      await api.fieldCheckIn(
        loc.latitude,
        loc.longitude,
        'Field Check-in (${loc.latitude.toStringAsFixed(4)}, ${loc.longitude.toStringAsFixed(4)})',
        accuracy: loc.accuracy,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Checked In successfully! Shift started.'),
            backgroundColor: AppColors.success,
          ),
        );
      }
      await _loadShift();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Check-in failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  Future<void> _handleCheckOut() async {
    final api = context.read<ApiService>();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('End Shift & Check Out?'),
        content: const Text(
          'Checking out will finalize your working hours and stop route recording for today.',
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
            child: const Text('Confirm Check Out'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    setState(() => _acting = true);
    // Send the last route points before the shift closes.
    await _tracking.endShift();
    try {
      LocationResult? loc;
      String? locationProblem;
      try {
        loc = await LocationService.getCurrentLocation();
      } catch (e) {
        locationProblem = e.toString();
      }

      if (loc != null) {
        await api.fieldCheckOut(
          loc.latitude,
          loc.longitude,
          'Field Check-out',
          accuracy: loc.accuracy,
        );
      } else {
        // 0,0 tells the server there was no GPS fix.
        await api.fieldCheckOut(0, 0, 'Field Check-out (no GPS)');
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              loc != null
                  ? 'Shift Completed! Checked out successfully.'
                  : 'Checked out, but your location was not recorded: $locationProblem',
            ),
            backgroundColor: loc != null
                ? AppColors.success
                : AppColors.warning,
            duration: Duration(seconds: loc != null ? 4 : 8),
          ),
        );
      }
      await _loadShift();
    } catch (e) {
      // Still on duty: keep recording the route.
      await _tracking.startShift();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Check-out failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthService>().session;
    final tracking = context.watch<TrackingService>();
    final isCheckedIn = _today?.checkedIn == true && _today?.checkedOut != true;
    final isCheckedOut = _today?.checkedOut == true;
    final distanceKm = tracking.todayKm ?? _today?.totalKm ?? 0.0;

    return Scaffold(
      appBar: AppBar(
        title: const Row(
          children: [
            AppLogo(size: 34),
            SizedBox(width: 10),
            Flexible(
              child: Text(
                'Field Agent Console',
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadShift,
            tooltip: 'Refresh Status',
          ),
          if (widget.onNavigateToProfile != null)
            IconButton(
              icon: const Icon(Icons.account_circle_outlined),
              onPressed: widget.onNavigateToProfile,
              tooltip: 'My Profile',
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadShift,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ── Greeting Banner ───────────────────────────────────────────
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Hello, ${user?.name ?? 'Field Agent'}',
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              color: AppColors.text,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${user?.district ?? 'Field'}, ${user?.state ?? 'Duty'}',
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppColors.muted,
                            ),
                          ),
                        ],
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: isCheckedIn
                              ? AppColors.successLight
                              : isCheckedOut
                              ? AppColors.primaryLight
                              : const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          isCheckedIn
                              ? 'ON DUTY'
                              : isCheckedOut
                              ? 'COMPLETED'
                              : 'NOT STARTED',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: isCheckedIn
                                ? AppColors.success
                                : isCheckedOut
                                ? AppColors.primary
                                : AppColors.muted,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // ── Shift Action Card ──────────────────────────────────────────
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: _loading
                      ? const Padding(
                          padding: EdgeInsets.symmetric(vertical: 18),
                          child: Center(child: CircularProgressIndicator()),
                        )
                      : !isCheckedIn && !isCheckedOut
                      ? _ShiftAction(
                          icon: Icons.location_on_rounded,
                          color: AppColors.primary,
                          background: AppColors.primaryLight,
                          title: 'Ready to begin your field shift?',
                          details: const _ShiftDetails(
                            'Check in to start recording your route. It stops '
                            'when you check out.',
                          ),
                          button: ElevatedButton.icon(
                            onPressed: _acting ? null : _handleCheckIn,
                            style: _shiftButtonStyle(AppColors.primary),
                            icon: const Icon(
                              Icons.play_arrow_rounded,
                              size: 20,
                            ),
                            label: const Text('Check In & Start Shift'),
                          ),
                        )
                      : isCheckedIn
                      ? _ShiftAction(
                          icon: Icons.sensors_rounded,
                          color: AppColors.success,
                          background: AppColors.successLight,
                          title: 'You are on duty',
                          titleColor: AppColors.success,
                          details: _TrackingStatus(tracking: tracking),
                          button: ElevatedButton.icon(
                            onPressed: _acting ? null : _handleCheckOut,
                            style: _shiftButtonStyle(AppColors.danger),
                            icon: const Icon(Icons.stop_rounded, size: 20),
                            label: const Text('End Shift & Check Out'),
                          ),
                        )
                      : const _ShiftAction(
                          icon: Icons.check_circle_rounded,
                          color: AppColors.primary,
                          background: AppColors.primaryLight,
                          title: 'Shift completed for today',
                          details: _ShiftDetails(
                            'Great job today! Your shift has been saved.',
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 16),

              // ── Today's Metrics ────────────────────────────────────────────
              Row(
                children: [
                  Expanded(
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Distance Covered',
                              style: TextStyle(
                                fontSize: 12,
                                color: AppColors.muted,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${distanceKm.toStringAsFixed(2)} km',
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w800,
                                color: AppColors.primary,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Shift Status',
                              style: TextStyle(
                                fontSize: 12,
                                color: AppColors.muted,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              isCheckedIn
                                  ? 'Active'
                                  : isCheckedOut
                                  ? 'Done'
                                  : 'Pending',
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w800,
                                color: isCheckedIn
                                    ? AppColors.success
                                    : AppColors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // ── Quick Navigation Cards ─────────────────────────────────────
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Quick Management',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.text,
                        ),
                      ),
                      const SizedBox(height: 12),
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const CircleAvatar(
                          backgroundColor: AppColors.primaryLight,
                          child: Icon(
                            Icons.assignment,
                            color: AppColors.primary,
                          ),
                        ),
                        title: const Text(
                          'My Leads (Today, Yesterday, Custom)',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: const Text(
                          'Filter customer properties by date & status',
                          style: TextStyle(fontSize: 12),
                        ),
                        trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                        onTap: widget.onNavigateToLeads,
                      ),
                      const Divider(height: 16),
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const CircleAvatar(
                          backgroundColor: AppColors.primaryLight,
                          child: Icon(Icons.person, color: AppColors.primary),
                        ),
                        title: const Text(
                          'My Profile & Identity',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: const Text(
                          'View staff details, district, and working hours',
                          style: TextStyle(fontSize: 12),
                        ),
                        trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                        onTap: widget.onNavigateToProfile,
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 80),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'field_shift_fab',
        onPressed: () async {
          await Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const FieldCreateLeadScreen()),
          );
          widget.onLeadCaptured?.call();
        },
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_location_alt_rounded),
        label: const Text('Capture Customer / Lead'),
      ),
    );
  }
}

/// What the route recorder is doing, shown under "ON DUTY".
class _TrackingStatus extends StatelessWidget {
  const _TrackingStatus({required this.tracking});

  final TrackingService tracking;

  @override
  Widget build(BuildContext context) {
    final problem = tracking.problem;
    final IconData icon;
    final Color color;
    final String text;
    if (problem != null) {
      icon = Icons.warning_amber_rounded;
      color = AppColors.warning;
      text = problem;
    } else if (tracking.isRecording) {
      final last = tracking.lastPointAt;
      final waiting = tracking.pendingPoints;
      icon = Icons.gps_fixed;
      color = AppColors.success;
      text = [
        'Route recording is on',
        if (last != null) 'last point ${DateFormat('h:mm a').format(last)}',
        if (waiting > 0) '$waiting waiting to upload',
      ].join(' · ');
    } else {
      icon = Icons.gps_not_fixed;
      color = AppColors.muted;
      text = 'Starting route recording…';
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Icon(icon, size: 14, color: color),
        ),
        const SizedBox(width: 5),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: 12,
              height: 1.35,
              color: problem != null ? AppColors.warning : AppColors.muted,
            ),
          ),
        ),
      ],
    );
  }
}

/// A slimmer take on the app's full-width button, for the shift card.
ButtonStyle _shiftButtonStyle(Color color) => ElevatedButton.styleFrom(
  backgroundColor: color,
  foregroundColor: Colors.white,
  minimumSize: const Size.fromHeight(44),
  textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
);

/// The shift card: icon beside the title and details, action button below.
class _ShiftAction extends StatelessWidget {
  const _ShiftAction({
    required this.icon,
    required this.color,
    required this.background,
    required this.title,
    required this.details,
    this.titleColor = AppColors.text,
    this.button,
  });

  final IconData icon;
  final Color color;
  final Color background;
  final String title;
  final Color titleColor;
  final Widget details;
  final Widget? button;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: background,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, size: 24, color: color),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: titleColor,
                    ),
                  ),
                  const SizedBox(height: 3),
                  details,
                ],
              ),
            ),
          ],
        ),
        if (button != null) ...[const SizedBox(height: 12), button!],
      ],
    );
  }
}

class _ShiftDetails extends StatelessWidget {
  const _ShiftDetails(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 12,
        height: 1.35,
        color: AppColors.muted,
      ),
    );
  }
}
