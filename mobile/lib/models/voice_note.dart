/// A voice recording an agent made for a lead, with the text recognised
/// from it while they spoke. Kept only on this phone (VoiceNoteStore); it is
/// never uploaded.
class VoiceNote {
  final String id;
  final String leadId;
  final String leadName;

  /// The field agent signed in when it was recorded, if known.
  final String? agentId;
  final DateTime recordedAt;
  final int durationMs;

  /// The .m4a file in the app's private storage.
  final String filePath;
  final String transcript;

  /// Speech language used for the live text, e.g. `hi-IN` or `en-IN`.
  final String language;

  const VoiceNote({
    required this.id,
    required this.leadId,
    required this.leadName,
    required this.recordedAt,
    required this.durationMs,
    required this.filePath,
    required this.transcript,
    required this.language,
    this.agentId,
  });

  Duration get duration => Duration(milliseconds: durationMs);

  VoiceNote linkedTo({required String leadId, required String leadName}) {
    return VoiceNote(
      id: id,
      leadId: leadId,
      leadName: leadName,
      agentId: agentId,
      recordedAt: recordedAt,
      durationMs: durationMs,
      filePath: filePath,
      transcript: transcript,
      language: language,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'leadId': leadId,
    'leadName': leadName,
    'agentId': agentId,
    'recordedAt': recordedAt.toIso8601String(),
    'durationMs': durationMs,
    'filePath': filePath,
    'transcript': transcript,
    'language': language,
  };

  factory VoiceNote.fromJson(Map<String, dynamic> json) {
    return VoiceNote(
      id: json['id']?.toString() ?? '',
      leadId: json['leadId']?.toString() ?? '',
      leadName: json['leadName']?.toString() ?? '',
      agentId: json['agentId']?.toString(),
      recordedAt:
          DateTime.tryParse(json['recordedAt']?.toString() ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
      durationMs: (json['durationMs'] as num?)?.toInt() ?? 0,
      filePath: json['filePath']?.toString() ?? '',
      transcript: json['transcript']?.toString() ?? '',
      language: json['language']?.toString() ?? 'hi-IN',
    );
  }
}
