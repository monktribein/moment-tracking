import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Contact support: call or WhatsApp (numbers set at build time, see mobile/README.md).
class ContactSupportScreen extends StatelessWidget {
  const ContactSupportScreen({super.key});

  @override
  Widget build(BuildContext context) {
    const phone = EcoConfig.supportPhone;
    final whatsapp = EcoConfig.supportWhatsApp.isNotEmpty ? EcoConfig.supportWhatsApp : EcoConfig.supportPhone;
    return Scaffold(
      appBar: AppBar(title: const Text('Support')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        const Icon(Icons.support_agent, size: 80, color: EcoColors.blue),
        const SizedBox(height: 8),
        const Text('Need help?', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
        const Text('Our support team is here to assist you.', textAlign: TextAlign.center, style: TextStyle(color: EcoColors.muted)),
        const SizedBox(height: 24),
        if (phone.isEmpty && whatsapp.isEmpty)
          const EmptyView(text: 'Support contact is not set up in this build', hint: 'Raise a service request from the home screen instead.', icon: Icons.phone_disabled)
        else ...[
          if (phone.isNotEmpty) OutlinedButton.icon(onPressed: () => openPhone(phone), icon: const Icon(Icons.call), label: const Text('Call support')),
          const SizedBox(height: 12),
          if (whatsapp.isNotEmpty)
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: EcoColors.green, side: const BorderSide(color: EcoColors.green)),
              onPressed: () => openWhatsApp(whatsapp),
              icon: const Icon(Icons.chat),
              label: const Text('WhatsApp chat'),
            ),
        ],
        const SizedBox(height: 12),
        ElevatedButton.icon(onPressed: () => context.push('/complaints/new'), icon: const Icon(Icons.build), label: const Text('Raise a service request')),
      ]),
    );
  }
}

/// Profile (GET /v1/customers/me), password change and sign out.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: Loader<Map<String, dynamic>>(
        load: () async => ((await api.get('/v1/customers/me')) as Map).cast<String, dynamic>(),
        builder: (context, me, reload) => ListView(padding: const EdgeInsets.all(14), children: [
          EcoCard(
            child: Column(children: [
              CircleAvatar(radius: 34, backgroundColor: EcoColors.blue, child: Text('${me['name'] ?? '?'}'.isEmpty ? '?' : '${me['name']}'[0].toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800))),
              const SizedBox(height: 8),
              Text('${me['name'] ?? ''}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                Text('+91 ${me['mobile'] ?? ''}', style: const TextStyle(color: EcoColors.muted)),
                if (me['mobileVerified'] == true) const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.verified, color: EcoColors.green, size: 16)),
              ]),
              const Divider(height: 24),
              InfoRow('Email', '${me['email'] ?? ''}', icon: Icons.email_outlined),
              InfoRow('Address', [me['address'], me['city'], me['state'], me['pin']].where((x) => x != null && '$x'.isNotEmpty).join(', '), icon: Icons.home_outlined),
              InfoRow('Products', '${me['products'] ?? 0}', icon: Icons.inventory_2_outlined),
              InfoRow('Requests', '${me['complaints'] ?? 0}', icon: Icons.assignment_outlined),
            ]),
          ),
          EcoCard(
            onTap: () => context.push('/notifications'),
            child: const Row(children: [Icon(Icons.notifications_outlined, color: EcoColors.blue), SizedBox(width: 10), Expanded(child: Text('Notifications', style: TextStyle(fontWeight: FontWeight.w600))), Icon(Icons.chevron_right)]),
          ),
          EcoCard(
            onTap: () => context.push('/support'),
            child: const Row(children: [Icon(Icons.support_agent, color: EcoColors.blue), SizedBox(width: 10), Expanded(child: Text('Contact support', style: TextStyle(fontWeight: FontWeight.w600))), Icon(Icons.chevron_right)]),
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
      ),
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
