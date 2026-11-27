import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Customer registration: details, then the WhatsApp code that verifies the mobile number,
/// then the customer is signed in.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _mobile = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _pin = TextEditingController();
  final _otp = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;

  ApiClient get _api => ref.read(apiClientProvider);

  Future<void> _sendCode() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final ok = await runSubmit(context, () async {
      await _api.post('/v1/customers/register', auth: false, body: {
        'name': _name.text.trim(),
        'mobile': digits10(_mobile.text),
        'password': _password.text,
        if (_email.text.trim().isNotEmpty) 'email': _email.text.trim(),
        if (_address.text.trim().isNotEmpty) 'address': _address.text.trim(),
        if (_city.text.trim().isNotEmpty) 'city': _city.text.trim(),
        if (_state.text.trim().isNotEmpty) 'state': _state.text.trim(),
        if (_pin.text.trim().isNotEmpty) 'pin': _pin.text.trim(),
        if (EcoConfig.companyId.isNotEmpty) 'companyId': EcoConfig.companyId,
      });
    }, success: 'A 6-digit code was sent to your WhatsApp');
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (ok) _codeSent = true;
    });
  }

  Future<void> _verify() async {
    if (!RegExp(r'^\d{6}$').hasMatch(_otp.text.trim())) {
      showSnack(context, 'Enter the 6-digit code', error: true);
      return;
    }
    setState(() => _busy = true);
    await runSubmit(context, () async {
      await _api.post('/v1/customers/register/verify', auth: false, body: {'mobile': digits10(_mobile.text), 'otp': _otp.text.trim()});
      // Verified: sign in straight away (the router then opens Home).
      await ref.read(authControllerProvider.notifier).login(digits10(_mobile.text), _password.text);
    }, success: 'Welcome to Eco Sor!');
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_codeSent ? 'Verify mobile number' : 'Create your account')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(18), children: [
          if (!_codeSent) ...[
            const Center(child: EcoLogo(size: 30)),
            const SizedBox(height: 16),
            TextFormField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Full name *'), validator: (v) => (v ?? '').trim().length < 2 ? 'Enter your name' : null),
            const SizedBox(height: 12),
            TextFormField(controller: _mobile, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Mobile number *', prefixText: '+91 ', helperText: 'A code is sent to this number on WhatsApp'), validator: validateMobile),
            const SizedBox(height: 12),
            TextFormField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: 'Password * (at least 8 characters)'), validator: (v) => (v ?? '').length < 8 ? 'At least 8 characters' : null),
            const SizedBox(height: 12),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Email'),
              validator: (v) => (v ?? '').trim().isEmpty || RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(v!.trim()) ? null : 'Enter a valid email',
            ),
            const SizedBox(height: 12),
            TextFormField(controller: _address, maxLines: 2, decoration: const InputDecoration(labelText: 'Address (used for service visits)')),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: TextFormField(controller: _city, decoration: const InputDecoration(labelText: 'City'))),
              const SizedBox(width: 10),
              Expanded(child: TextFormField(controller: _state, decoration: const InputDecoration(labelText: 'State'))),
            ]),
            const SizedBox(height: 12),
            TextFormField(
              controller: _pin,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: const InputDecoration(labelText: 'PIN code'),
              validator: (v) => (v ?? '').isEmpty || RegExp(r'^\d{6}$').hasMatch(v!) ? null : 'PIN is 6 digits',
            ),
            const SizedBox(height: 10),
            ElevatedButton(onPressed: _busy ? null : _sendCode, child: Text(_busy ? 'Sending…' : 'Continue')),
          ] else ...[
            const Icon(Icons.mark_chat_read_outlined, size: 64, color: EcoColors.green),
            const SizedBox(height: 10),
            Text('Enter the 6-digit code sent to WhatsApp on +91 ${digits10(_mobile.text)}.', textAlign: TextAlign.center, style: const TextStyle(fontSize: 15)),
            const SizedBox(height: 4),
            const Text('It is valid for 10 minutes. 5 wrong tries lock it.', textAlign: TextAlign.center, style: TextStyle(color: EcoColors.muted)),
            const SizedBox(height: 18),
            TextField(controller: _otp, keyboardType: TextInputType.number, maxLength: 6, textAlign: TextAlign.center, style: const TextStyle(fontSize: 24, letterSpacing: 8, fontWeight: FontWeight.w800), decoration: const InputDecoration(counterText: '', hintText: '••••••')),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _busy ? null : _verify, child: Text(_busy ? 'Checking…' : 'Verify & continue')),
            TextButton(onPressed: _busy ? null : _sendCode, child: const Text('Send the code again (max 3 an hour)')),
            TextButton(onPressed: _busy ? null : () => setState(() => _codeSent = false), child: const Text('Change details')),
          ],
        ]),
      ),
    );
  }
}
