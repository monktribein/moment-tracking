package com.movementtracking.movement_tracking

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var voiceNotes: VoiceNotesChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        voiceNotes = VoiceNotesChannel(this, flutterEngine.dartExecutor.binaryMessenger)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        voiceNotes?.onRequestPermissionsResult(requestCode, grantResults)
    }

    override fun onDestroy() {
        voiceNotes?.dispose()
        voiceNotes = null
        super.onDestroy()
    }
}
