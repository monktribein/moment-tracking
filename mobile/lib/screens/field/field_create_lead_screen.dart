import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../api/api_service.dart';
import '../../services/location_service.dart';
import '../../services/voice_note_service.dart';
import '../../theme/app_theme.dart';
import 'voice_notes_section.dart';

class FieldCreateLeadScreen extends StatefulWidget {
  const FieldCreateLeadScreen({super.key});

  @override
  State<FieldCreateLeadScreen> createState() => _FieldCreateLeadScreenState();
}

class _FieldCreateLeadScreenState extends State<FieldCreateLeadScreen> {
  final _formKey = GlobalKey<FormState>();

  final _nameController = TextEditingController();
  final _ownerNameController = TextEditingController();
  final _ownerPhoneController = TextEditingController();
  final _addressController = TextEditingController();
  final _cityController = TextEditingController();
  final _districtController = TextEditingController(text: 'Mathura');
  final _stateController = TextEditingController(text: 'Uttar Pradesh');
  final _roomsController = TextEditingController();
  final _priceController = TextEditingController();
  final _notesController = TextEditingController();

  /// Voice notes recorded here; linked to the lead once it is submitted.
  final _voiceNotes = PendingVoiceNotes();

  double? _lat;
  double? _lng;
  bool _detectingGps = false;
  bool _submitting = false;

  String _interest = 'Interested';
  final List<String> _interests = [
    'Interested',
    'Follow-up Required',
    'Not Interested',
  ];

  @override
  void initState() {
    super.initState();
    _handleAutoGps();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _ownerNameController.dispose();
    _ownerPhoneController.dispose();
    _addressController.dispose();
    _cityController.dispose();
    _districtController.dispose();
    _stateController.dispose();
    _roomsController.dispose();
    _priceController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _handleAutoGps() async {
    setState(() => _detectingGps = true);
    try {
      final loc = await LocationService.getCurrentLocation();
      // The agent may have left the form while GPS was still searching.
      if (!mounted) return;
      setState(() {
        _lat = loc.latitude;
        _lng = loc.longitude;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Location auto-tagged: ${loc.latitude.toStringAsFixed(4)}, ${loc.longitude.toStringAsFixed(4)}',
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('GPS error: $e'),
            duration: const Duration(seconds: 8),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _detectingGps = false);
    }
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;

    final phone = _ownerPhoneController.text.replaceAll(RegExp(r'\D'), '');
    if (phone.length != 10) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a 10-digit mobile number')),
      );
      return;
    }
    if (_voiceNotes.isRecording) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Stop the voice recording before submitting.'),
        ),
      );
      return;
    }

    setState(() => _submitting = true);

    final payload = {
      'name': _nameController.text.trim(),
      'contact': {
        'ownerName': _ownerNameController.text.trim(),
        'phone': phone,
      },
      'location': {
        'address': _addressController.text.trim(),
        'city': _cityController.text.trim().isNotEmpty
            ? _cityController.text.trim()
            : _districtController.text.trim(),
        'district': _districtController.text.trim(),
        'state': _stateController.text.trim(),
        if (_lat != null && _lng != null)
          'coordinates': {'lat': _lat, 'lng': _lng},
      },
      'roomInventory': {
        'totalRooms': int.tryParse(_roomsController.text),
        'roomPrice': double.tryParse(_priceController.text),
      },
      'interest': _interest,
      'notes': _notesController.text.trim(),
    };

    try {
      final lead = await context.read<ApiService>().fieldCreateLead(payload);
      // Voice notes stay on this phone, filed under the new lead's id.
      var voiceNotesLost = false;
      if (lead.id.isNotEmpty) {
        await _voiceNotes.saveFor(
          leadId: lead.id,
          leadName: lead.name.isNotEmpty
              ? lead.name
              : _nameController.text.trim(),
        );
      } else if (_voiceNotes.notes.isNotEmpty) {
        voiceNotesLost = true;
        await _voiceNotes.discard();
      }
      if (mounted && voiceNotesLost) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Lead saved, but its voice notes could not be linked to it.',
            ),
          ),
        );
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Customer / Lead captured successfully!'),
            backgroundColor: AppColors.success,
          ),
        );
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Failed to submit: $e')));
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// Leaving with unsaved voice notes asks first; they're deleted if so.
  Future<void> _confirmLeave() async {
    final discard = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Discard voice notes?'),
        content: const Text(
          'Voice notes are saved with the lead when you submit it. If you '
          'leave now, they will be deleted.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Keep editing'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    if (discard != true) return;
    await _voiceNotes.discard();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _voiceNotes,
      builder: (context, child) => PopScope(
        canPop: !_voiceNotes.hasUnsaved,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) _confirmLeave();
        },
        child: child!,
      ),
      child: _buildForm(context),
    );
  }

  Widget _buildForm(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Capture Customer / Lead')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Property / Customer Info',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'Property / Hotel / Ashram Name *',
                  hintText: 'e.g. Radhe Radhe Guest House',
                ),
                validator: (v) =>
                    v == null || v.trim().isEmpty ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _ownerNameController,
                decoration: const InputDecoration(
                  labelText: 'Owner / Contact Person *',
                  hintText: 'e.g. Shyam Sundar',
                ),
                validator: (v) =>
                    v == null || v.trim().isEmpty ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _ownerPhoneController,
                keyboardType: TextInputType.phone,
                maxLength: 10,
                decoration: const InputDecoration(
                  labelText: 'Phone Number (10 digits) *',
                ),
                validator: (v) =>
                    v == null || v.trim().isEmpty ? 'Required' : null,
              ),
              const SizedBox(height: 16),

              const Text(
                'Location & GPS Tagging',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _addressController,
                decoration: const InputDecoration(
                  labelText: 'Street / Landmark Address',
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'GPS Tag:',
                            style: TextStyle(
                              fontSize: 11,
                              color: AppColors.muted,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _lat != null && _lng != null
                                ? '${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)}'
                                : 'Locating...',
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                      OutlinedButton.icon(
                        onPressed: _detectingGps ? null : _handleAutoGps,
                        icon: const Icon(Icons.my_location, size: 16),
                        label: Text(
                          _detectingGps ? 'Locating...' : 'Re-tag GPS',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              const Text(
                'Interest Level',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: _interests.map((item) {
                  final active = _interest == item;
                  return ChoiceChip(
                    label: Text(item),
                    selected: active,
                    onSelected: (_) => setState(() => _interest = item),
                  );
                }).toList(),
              ),
              const SizedBox(height: 16),

              TextFormField(
                controller: _notesController,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Field Notes',
                  hintText: 'Customer requirements, feedback...',
                ),
              ),
              const SizedBox(height: 20),

              VoiceNotesSection(pending: _voiceNotes),
              const SizedBox(height: 24),

              ElevatedButton(
                onPressed: _submitting ? null : _handleSubmit,
                child: _submitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Submit Customer Lead'),
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }
}
