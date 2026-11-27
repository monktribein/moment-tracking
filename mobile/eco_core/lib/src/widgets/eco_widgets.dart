import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../theme/eco_theme.dart';
import '../util/format.dart';

/// "⚡ECO SOR" word mark (logo text in Eco Sor colours).
class EcoLogo extends StatelessWidget {
  const EcoLogo({super.key, this.size = 28, this.onDark = false});

  final double size;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(children: [
        TextSpan(text: '⚡', style: TextStyle(color: EcoColors.orange, fontSize: size * 0.9)),
        TextSpan(text: 'ECO ', style: TextStyle(color: onDark ? Colors.white : EcoColors.blue)),
        const TextSpan(text: 'SOR', style: TextStyle(color: EcoColors.orange)),
      ]),
      style: TextStyle(fontSize: size, fontWeight: FontWeight.w900, fontStyle: FontStyle.italic, letterSpacing: 0.5),
    );
  }
}

/// The blue greeting header of the home screens: "Good Morning, <name>".
class GreetingHeader extends StatelessWidget {
  const GreetingHeader({super.key, required this.name, required this.subtitle, this.trailing});

  final String name;
  final String subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final initials = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2).map((w) => w[0].toUpperCase()).join();
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 20),
      decoration: const BoxDecoration(
        gradient: LinearGradient(colors: [EcoColors.blue, EcoColors.blueBright], begin: Alignment.topLeft, end: Alignment.bottomRight),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(22)),
      ),
      child: Row(children: [
        CircleAvatar(radius: 26, backgroundColor: Colors.white, child: Text(initials.isEmpty ? '?' : initials, style: const TextStyle(color: EcoColors.blue, fontWeight: FontWeight.w800, fontSize: 18))),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${greeting()},', style: const TextStyle(color: Colors.white70, fontSize: 14)),
            Text(name, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
            Text(subtitle, style: const TextStyle(color: Colors.white70, fontSize: 13)),
          ]),
        ),
        if (trailing != null) trailing!,
      ]),
    );
  }
}

/// A coloured home-screen tile: icon in a tinted square and a label, like the design's grid.
class IconTile extends StatelessWidget {
  const IconTile({super.key, required this.icon, required this.label, required this.color, required this.onTap, this.badge});

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;
  final int? badge;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: color.withValues(alpha: 0.18))),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Stack(clipBehavior: Clip.none, children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
                child: Icon(icon, color: color, size: 26),
              ),
              if ((badge ?? 0) > 0)
                Positioned(
                  right: -6,
                  top: -6,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(color: EcoColors.red, borderRadius: BorderRadius.circular(10)),
                    child: Text('$badge', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
                  ),
                ),
            ]),
            const SizedBox(height: 8),
            Text(label, textAlign: TextAlign.center, maxLines: 2, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: EcoColors.text)),
          ]),
        ),
      ),
    );
  }
}

/// A small figure card (e.g. "Assigned 12").
class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, required this.icon, required this.color, this.onTap});

  final String label;
  final String value;
  final IconData icon;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return EcoCard(
      onTap: onTap,
      child: Row(children: [
        Container(width: 38, height: 38, decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)), child: Icon(icon, color: color, size: 22)),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(color: EcoColors.muted, fontSize: 12)),
            Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: EcoColors.text)),
          ]),
        ),
      ]),
    );
  }
}

/// White rounded card with an optional tap.
class EcoCard extends StatelessWidget {
  const EcoCard({super.key, required this.child, this.onTap, this.padding = const EdgeInsets.all(14), this.color});

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: color,
      clipBehavior: Clip.antiAlias,
      child: InkWell(onTap: onTap, child: Padding(padding: padding, child: child)),
    );
  }
}

/// Coloured status chip: green done, orange pending/in review, blue new, red rejected.
class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key, this.label});

  final String? status;
  final String? label;

  static Color colorOf(String? s) {
    switch (s) {
      case 'approved':
      case 'verified':
      case 'completed':
      case 'resolved':
      case 'done':
      case 'reimbursed':
      case 'processed':
      case 'eligible':
      case 'checked_out':
      case 'present':
        return EcoColors.green;
      case 'pending':
      case 'under_review':
      case 'in_progress':
      case 'checked_in':
      case 'report_submitted':
      case 'half_day':
        return EcoColors.orange;
      case 'rejected':
      case 'correction_required':
      case 'not_eligible':
      case 'reopened':
      case 'absent':
      case 'cancelled':
        return EcoColors.red;
      case 'closed':
      case 'draft':
      case 'rescheduled':
        return EcoColors.muted;
      default:
        return EcoColors.blueBright; // new, open, submitted, scheduled, assigned
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = colorOf(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(label ?? words(status), style: TextStyle(color: c, fontWeight: FontWeight.w700, fontSize: 12)),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.action});

  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 16, 4, 6),
        child: Row(children: [
          Expanded(child: Text(text, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: EcoColors.text))),
          if (action != null) action!,
        ]),
      );
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.text, this.icon = Icons.inbox_outlined, this.hint});

  final String text;
  final String? hint;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 52, color: EcoColors.muted.withValues(alpha: 0.6)),
            const SizedBox(height: 10),
            Text(text, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
            if (hint != null) ...[const SizedBox(height: 4), Text(hint!, textAlign: TextAlign.center, style: const TextStyle(color: EcoColors.muted))],
          ]),
        ),
      );
}

/// Error with a retry button; a clear "no internet" state when the device is offline.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final offline = error is ApiException && (error as ApiException).offline;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(offline ? Icons.wifi_off_rounded : Icons.error_outline, size: 52, color: offline ? EcoColors.amber : EcoColors.red),
          const SizedBox(height: 10),
          Text(offline ? 'No internet connection' : 'Something went wrong', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 4),
          Text(error.toString(), textAlign: TextAlign.center, style: const TextStyle(color: EcoColors.muted)),
          if (onRetry != null) ...[
            const SizedBox(height: 14),
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Try again')),
          ],
        ]),
      ),
    );
  }
}

/// Loads data once (and on pull-to-refresh), with loading, error and empty states.
class Loader<T> extends StatefulWidget {
  const Loader({super.key, required this.load, required this.builder, this.isEmpty, this.empty});

  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;
  final bool Function(T data)? isEmpty;
  final Widget? empty;

  @override
  State<Loader<T>> createState() => LoaderState<T>();
}

class LoaderState<T> extends State<Loader<T>> {
  T? _data;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    setState(() {
      _loading = _data == null;
      _error = null;
    });
    try {
      final d = await widget.load();
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()));
    if (_error != null && _data == null) return ErrorView(error: _error!, onRetry: reload);
    final data = _data as T;
    final empty = widget.isEmpty?.call(data) ?? false;
    return RefreshIndicator(
      onRefresh: reload,
      child: empty
          ? ListView(physics: const AlwaysScrollableScrollPhysics(), children: [widget.empty ?? const EmptyView(text: 'Nothing here yet')])
          : widget.builder(context, data, reload),
    );
  }
}

/// A vertical timeline (status history).
class TimelineList extends StatelessWidget {
  const TimelineList({super.key, required this.items});

  /// Each item: title, subtitle, done (bool), warn (bool).
  final List<({String title, String subtitle, bool done, bool warn})> items;

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      for (var i = 0; i < items.length; i++)
        IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Column(children: [
              Icon(items[i].warn ? Icons.error : (items[i].done ? Icons.check_circle : Icons.radio_button_unchecked), color: items[i].warn ? EcoColors.red : (items[i].done ? EcoColors.green : EcoColors.muted), size: 22),
              if (i < items.length - 1) Expanded(child: Container(width: 2, color: EcoColors.border)),
            ]),
            const SizedBox(width: 10),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(items[i].title, style: TextStyle(fontWeight: FontWeight.w700, color: items[i].done || items[i].warn ? EcoColors.text : EcoColors.muted)),
                  if (items[i].subtitle.isNotEmpty) Text(items[i].subtitle, style: const TextStyle(color: EcoColors.muted, fontSize: 12)),
                ]),
              ),
            ),
          ]),
        ),
    ]);
  }
}

/// A label/value row for detail screens.
class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key, this.icon});

  final String label;
  final String? value;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (icon != null) ...[Icon(icon, size: 18, color: EcoColors.blue), const SizedBox(width: 8)],
          SizedBox(width: 120, child: Text(label, style: const TextStyle(color: EcoColors.muted))),
          Expanded(child: Text((value == null || value!.isEmpty) ? '—' : value!, style: const TextStyle(fontWeight: FontWeight.w600))),
        ]),
      );
}

void showSnack(BuildContext context, String text, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text), backgroundColor: error ? EcoColors.red : EcoColors.green, behavior: SnackBarBehavior.floating));
}

Future<bool> confirmDialog(BuildContext context, {required String title, required String message, String confirm = 'Confirm', bool danger = false}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: danger ? EcoColors.red : EcoColors.blue), onPressed: () => Navigator.pop(c, true), child: Text(confirm)),
      ],
    ),
  );
  return ok ?? false;
}
