import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'home_screen.dart';

/// Profile, change password and sign out.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! SignedIn) return const SizedBox.shrink();
    final u = auth.user;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        EcoCard(
          child: Column(children: [
            CircleAvatar(radius: 34, backgroundColor: EcoColors.blue, child: Text(u.name.isEmpty ? '?' : u.name[0].toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800))),
            const SizedBox(height: 8),
            Text(u.name, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            Text(roleNames[u.role] ?? words(u.role), style: const TextStyle(color: EcoColors.muted)),
            const Divider(height: 24),
            InfoRow('Mobile', u.phone, icon: Icons.phone),
            InfoRow('Email', u.email, icon: Icons.email_outlined),
            InfoRow('Company', u.companyName, icon: Icons.business),
          ]),
        ),
        EcoCard(
          onTap: () => showDialog(context: context, builder: (_) => const _ChangePassword()),
          child: const Row(children: [Icon(Icons.lock_outline, color: EcoColors.blue), SizedBox(width: 10), Expanded(child: Text('Change password', style: TextStyle(fontWeight: FontWeight.w600))), Icon(Icons.chevron_right)]),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(foregroundColor: EcoColors.red, side: const BorderSide(color: EcoColors.red)),
          onPressed: () async {
            if (await confirmDialog(context, title: 'Sign out?', message: 'You will need your password to sign in again.', confirm: 'Sign out', danger: true)) {
              await ref.read(authControllerProvider.notifier).logout();
            }
          },
          icon: const Icon(Icons.logout),
          label: const Text('Logout'),
        ),
      ]),
    );
  }
}

class _ChangePassword extends ConsumerStatefulWidget {
  const _ChangePassword();

  @override
  ConsumerState<_ChangePassword> createState() => _ChangePasswordState();
}

class _ChangePasswordState extends ConsumerState<_ChangePassword> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Change password'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: _current, obscureText: true, decoration: const InputDecoration(labelText: 'Current password')),
        const SizedBox(height: 10),
        TextField(controller: _next, obscureText: true, decoration: const InputDecoration(labelText: 'New password (8+ characters)')),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(
          onPressed: _busy
              ? null
              : () async {
                  if (_next.text.length < 8) {
                    showSnack(context, 'The new password needs 8 characters', error: true);
                    return;
                  }
                  setState(() => _busy = true);
                  final ok = await runSubmit(context, () async {
                    final r = (await ref.read(apiClientProvider).post('/v1/auth/change-password', body: {'currentPassword': _current.text, 'newPassword': _next.text})) as Map;
                    await ref.read(authControllerProvider.notifier).replaceToken(r['token'] as String);
                  }, success: 'Password changed');
                  if (!context.mounted) return;
                  setState(() => _busy = false);
                  if (ok) Navigator.pop(context);
                },
          child: const Text('Save'),
        ),
      ],
    );
  }
}
