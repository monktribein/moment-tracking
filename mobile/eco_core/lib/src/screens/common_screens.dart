import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../auth/session.dart';
import '../theme/eco_theme.dart';
import '../util/device.dart';
import '../util/format.dart';
import '../widgets/eco_widgets.dart';

/// Shown while the stored session is checked.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key, required this.tagline});

  final String tagline;

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.white,
        body: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const EcoLogo(size: 40),
            const SizedBox(height: 8),
            Text(tagline, style: const TextStyle(color: EcoColors.muted)),
            const SizedBox(height: 28),
            const CircularProgressIndicator(),
          ]),
        ),
      );
}

final RegExp _mobileRe = RegExp(r'^[6-9]\d{9}$');
String digits10(String s) {
  final d = s.replaceAll(RegExp(r'\D'), '');
  return d.length > 10 ? d.substring(d.length - 10) : d;
}

String? validateMobile(String? v) => _mobileRe.hasMatch(digits10(v ?? '')) ? null : 'Enter a valid 10-digit mobile number';

/// Mobile number + password sign-in, shared by both apps.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, required this.title, required this.onForgot, this.footer, this.message});

  final String title;
  final VoidCallback onForgot;
  final Widget? footer;
  final String? message;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _mobile = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _show = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _error = widget.message;
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).login(digits10(_mobile.text), _password.text);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _form,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Center(child: EcoLogo(size: 38)),
                const SizedBox(height: 8),
                Text(widget.title, textAlign: TextAlign.center, style: const TextStyle(color: EcoColors.muted, fontSize: 15)),
                const SizedBox(height: 32),
                TextFormField(
                  controller: _mobile,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'Mobile number', prefixIcon: Icon(Icons.phone_android), prefixText: '+91 '),
                  validator: validateMobile,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _password,
                  obscureText: !_show,
                  decoration: InputDecoration(
                    labelText: 'Password',
                    prefixIcon: const Icon(Icons.lock_outline),
                    suffixIcon: IconButton(icon: Icon(_show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _show = !_show)),
                  ),
                  validator: (v) => (v ?? '').isEmpty ? 'Enter your password' : null,
                  onFieldSubmitted: (_) => _submit(),
                ),
                Align(alignment: Alignment.centerRight, child: TextButton(onPressed: widget.onForgot, child: const Text('Forgot password?'))),
                if (_error != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: EcoColors.red.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
                    child: Text(_error!, style: const TextStyle(color: EcoColors.red)),
                  ),
                  const SizedBox(height: 12),
                ],
                ElevatedButton(onPressed: _busy ? null : _submit, child: _busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white)) : const Text('Sign in')),
                if (widget.footer != null) ...[const SizedBox(height: 16), widget.footer!],
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

/// Forgot password: a code is sent to WhatsApp, then a new password is set with it.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _mobile = TextEditingController();
  final _otp = TextEditingController();
  final _password = TextEditingController();
  bool _sent = false;
  bool _busy = false;

  Future<void> _run(Future<void> Function() work) async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await work();
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Forgot password')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(20), children: [
          Text(_sent ? 'If the number is registered, a 6-digit code was sent to its WhatsApp. It is valid for 10 minutes.' : 'We send a 6-digit code to your WhatsApp number.',
              style: const TextStyle(color: EcoColors.muted)),
          const SizedBox(height: 18),
          TextFormField(controller: _mobile, enabled: !_sent, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Mobile number', prefixText: '+91 '), validator: validateMobile),
          if (_sent) ...[
            const SizedBox(height: 14),
            TextFormField(controller: _otp, keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(labelText: 'Code'), validator: (v) => RegExp(r'^\d{6}$').hasMatch(v ?? '') ? null : 'Enter the 6-digit code'),
            TextFormField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: 'New password (at least 8 characters)'), validator: (v) => (v ?? '').length >= 8 ? null : 'At least 8 characters'),
          ],
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: _busy
                ? null
                : () => _run(() async {
                      if (!_sent) {
                        await api.post('/v1/auth/forgot-password', body: {'identifier': digits10(_mobile.text)}, auth: false);
                        if (mounted) setState(() => _sent = true);
                      } else {
                        await api.post('/v1/auth/reset-password', body: {'identifier': digits10(_mobile.text), 'otp': _otp.text, 'newPassword': _password.text}, auth: false);
                        if (!context.mounted) return;
                        showSnack(context, 'Password changed. Sign in with the new password.');
                        Navigator.of(context).maybePop();
                      }
                    }),
            child: Text(_busy ? 'Please wait…' : (_sent ? 'Change password' : 'Send code')),
          ),
          if (_sent) TextButton(onPressed: _busy ? null : () => setState(() => _sent = false), child: const Text('Send a new code (max 3 an hour)')),
        ]),
      ),
    );
  }
}

/// In-app notifications (GET /v1/notifications).
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  final _loader = GlobalKey<LoaderState<Paged>>();

  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiClientProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: () async {
              final ok = await runSubmit(context, () => api.post('/v1/notifications/read-all'), success: 'All marked as read');
              if (ok) await _loader.currentState?.reload();
            },
            child: const Text('Read all', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
      body: Loader<Paged>(
        key: _loader,
        load: () => api.page('/v1/notifications', query: {'limit': 50}),
        isEmpty: (p) => p.items.isEmpty,
        empty: const EmptyView(text: 'No notifications yet', icon: Icons.notifications_none),
        builder: (context, p, reload) => ListView.separated(
          padding: const EdgeInsets.all(12),
          itemCount: p.items.length,
          separatorBuilder: (_, __) => const SizedBox(height: 2),
          itemBuilder: (_, i) {
            final n = p.items[i];
            final unread = n['isRead'] != true;
            return EcoCard(
              color: unread ? const Color(0xFFF2F6FF) : null,
              onTap: unread
                  ? () async {
                      if (await runSubmit(context, () => api.post('/v1/notifications/${n['id']}/read'))) await reload();
                    }
                  : null,
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Icon(Icons.notifications, color: unread ? EcoColors.orange : EcoColors.muted),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${n['title'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    if ('${n['body'] ?? ''}'.isNotEmpty) Text('${n['body']}'),
                    Text(inDateTime(n['createdAt']), style: const TextStyle(color: EcoColors.muted, fontSize: 12)),
                  ]),
                ),
              ]),
            );
          },
        ),
      ),
    );
  }
}

/// Photo thumbnails with an add button (camera or gallery, compressed, 5 MB max).
class PhotoStrip extends StatelessWidget {
  const PhotoStrip({super.key, required this.files, required this.onChanged, this.max = 5, this.label = 'Add photo'});

  final List<File> files;
  final ValueChanged<List<File>> onChanged;
  final int max;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Wrap(spacing: 8, runSpacing: 8, children: [
      for (final f in files)
        Stack(children: [
          ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.file(f, width: 78, height: 78, fit: BoxFit.cover)),
          Positioned(
            right: 0,
            top: 0,
            child: InkWell(
              onTap: () => onChanged(List.of(files)..remove(f)),
              child: const CircleAvatar(radius: 11, backgroundColor: EcoColors.red, child: Icon(Icons.close, size: 14, color: Colors.white)),
            ),
          ),
        ]),
      if (files.length < max)
        InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: () async {
            try {
              final f = await pickPhoto(context);
              if (f != null) onChanged([...files, f]);
            } catch (e) {
              if (context.mounted) showSnack(context, e.toString().replaceFirst('Exception: ', ''), error: true);
            }
          },
          child: Container(
            width: 78,
            height: 78,
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: EcoColors.blue, style: BorderStyle.solid)),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Icon(Icons.add_a_photo_outlined, color: EcoColors.blue),
              Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 10, color: EcoColors.blue)),
            ]),
          ),
        ),
    ]);
  }
}

/// Runs [work], showing errors as a snack bar; returns true on success. Offline errors keep the
/// form as it is so the user can retry (with the same Idempotency-Key).
Future<bool> runSubmit(BuildContext context, Future<void> Function() work, {String? success}) async {
  try {
    await work();
    if (success != null && context.mounted) showSnack(context, success);
    return true;
  } on ApiException catch (e) {
    if (context.mounted) showSnack(context, e.offline ? 'No internet. Your entry is kept: press the button again when you are online.' : e.message, error: true);
    return false;
  } catch (e) {
    if (context.mounted) showSnack(context, e.toString().replaceFirst('Exception: ', ''), error: true);
    return false;
  }
}
