import 'package:eco_core/eco_core.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

/// A notes field with Hindi / English voice-to-text. Spoken words are added to the text, which
/// stays editable. [language] reports the chosen language ("hi" or "en") for the API.
class VoiceTextField extends StatefulWidget {
  const VoiceTextField({super.key, required this.controller, required this.label, this.onLanguage, this.maxLength = 4000, this.validator});

  final TextEditingController controller;
  final String label;
  final ValueChanged<String>? onLanguage;
  final int maxLength;
  final FormFieldValidator<String>? validator;

  @override
  State<VoiceTextField> createState() => _VoiceTextFieldState();
}

class _VoiceTextFieldState extends State<VoiceTextField> {
  final SpeechToText _speech = SpeechToText();
  bool _ready = false;
  bool _listening = false;
  String _lang = 'hi';
  String _base = '';

  Future<void> _toggle() async {
    if (_listening) {
      await _speech.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }
    final ok = await askPermission(context, Permission.microphone, title: 'Microphone', why: "The microphone turns your spoken notes into text with the phone's speech recognition. Eco Sor saves only the text, never the audio.");
    if (!ok) return;
    if (!_ready) {
      _ready = await _speech.initialize(
        onStatus: (s) {
          if ((s == 'done' || s == 'notListening') && mounted) setState(() => _listening = false);
        },
        onError: (e) {
          if (mounted) {
            setState(() => _listening = false);
            showSnack(context, 'Voice input stopped: ${e.errorMsg}', error: true);
          }
        },
      );
    }
    if (!_ready) {
      if (mounted) showSnack(context, 'Voice input is not available on this phone.', error: true);
      return;
    }
    if (!mounted) return;
    _base = widget.controller.text.trim().isEmpty ? '' : '${widget.controller.text.trim()} ';
    setState(() => _listening = true);
    await _speech.listen(
      localeId: _lang == 'hi' ? 'hi_IN' : 'en_IN',
      onResult: (SpeechRecognitionResult r) {
        widget.controller.text = '$_base${r.recognizedWords}';
        widget.controller.selection = TextSelection.collapsed(offset: widget.controller.text.length);
      },
    );
  }

  @override
  void dispose() {
    _speech.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Text(widget.label, style: const TextStyle(fontWeight: FontWeight.w600))),
        SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'hi', label: Text('हिंदी')), ButtonSegment(value: 'en', label: Text('English'))],
          selected: {_lang},
          showSelectedIcon: false,
          onSelectionChanged: _listening
              ? null
              : (s) {
                  setState(() => _lang = s.first);
                  widget.onLanguage?.call(_lang);
                },
        ),
      ]),
      const SizedBox(height: 8),
      TextFormField(
        controller: widget.controller,
        maxLines: 5,
        minLines: 3,
        maxLength: widget.maxLength,
        validator: widget.validator,
        decoration: InputDecoration(
          hintText: _listening ? 'Listening… speak now' : 'Type, or tap the mic and speak',
          suffixIcon: IconButton(
            tooltip: _listening ? 'Stop' : 'Speak',
            onPressed: _toggle,
            icon: Icon(_listening ? Icons.stop_circle : Icons.mic, color: _listening ? EcoColors.red : EcoColors.blue, size: 30),
          ),
        ),
      ),
    ]);
  }
}
