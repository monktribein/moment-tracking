package com.movementtracking.movement_tracking

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.speech.SpeechRecognizer
import android.view.WindowManager
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * Flutter bridge for voice notes: microphone permission, recording with live
 * speech-to-text, playback and the files themselves. Everything stays in the
 * app's private storage on this phone; nothing is uploaded.
 */
class VoiceNotesChannel(private val activity: Activity, messenger: BinaryMessenger) :
    MethodChannel.MethodCallHandler, EventChannel.StreamHandler {

    private val methods = MethodChannel(messenger, "moment/voice_notes")
    private val events = EventChannel(messenger, "moment/voice_notes/events")
    private var sink: EventChannel.EventSink? = null
    private var recorder: VoiceNoteRecorder? = null
    private var pendingPermission: MethodChannel.Result? = null
    private val player = VoiceNotePlayer(::emit)
    private val dir: File get() = File(activity.filesDir, "voice_notes")

    init {
        methods.setMethodCallHandler(this)
        events.setStreamHandler(this)
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        sink = events
    }

    override fun onCancel(arguments: Any?) {
        sink = null
    }

    private fun emit(event: Map<String, Any?>) {
        sink?.success(event)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "permissionStatus" -> result.success(if (hasPermission()) "granted" else "denied")
            "requestPermission" -> requestPermission(result)
            "openAppSettings" -> {
                openAppSettings()
                result.success(null)
            }
            "capabilities" -> result.success(
                mapOf(
                    "liveTranscription" to SpeechRecognizer.isRecognitionAvailable(activity),
                    "sdk" to Build.VERSION.SDK_INT,
                ),
            )
            "start" -> start(call, result)
            "stop" -> stop(result)
            "cancel" -> {
                recorder?.cancel()
                recorder = null
                keepScreenOn(false)
                result.success(null)
            }
            "isRecording" -> result.success(recorder != null)
            "deleteFile" -> result.success(deleteFile(call.argument<String>("path")))
            "listFiles" -> result.success(
                dir.listFiles()?.filter { it.isFile }?.map {
                    mapOf("path" to it.absolutePath, "modifiedMs" to it.lastModified())
                } ?: emptyList<Map<String, Any>>(),
            )
            "play" -> try {
                result.success(mapOf("durationMs" to player.play(call.argument<String>("path") ?: "")))
            } catch (e: Exception) {
                result.error("play_failed", e.message ?: "This recording can't be played.", null)
            }
            "pause" -> {
                player.pause()
                result.success(null)
            }
            "resume" -> {
                player.resume()
                result.success(null)
            }
            "seek" -> {
                player.seek(call.argument<Int>("positionMs") ?: 0)
                result.success(null)
            }
            "stopPlayback" -> {
                player.stop()
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun start(call: MethodCall, result: MethodChannel.Result) {
        if (recorder != null) {
            result.error("busy", "A recording is already in progress.", null)
            return
        }
        if (!hasPermission()) {
            result.error("permission", "Microphone permission is needed to record.", null)
            return
        }
        val id = (call.argument<String>("id") ?: System.currentTimeMillis().toString())
            .replace(Regex("[^A-Za-z0-9_-]"), "")
        val language = call.argument<String>("language") ?: "hi-IN"
        val file = File(dir, "$id.m4a")
        player.stop()
        val rec = VoiceNoteRecorder(
            activity,
            file,
            language,
            MicrophoneSource(),
            object : VoiceNoteRecorder.Listener {
                override fun onLevel(level: Double) = emit(mapOf("event" to "level", "level" to level))

                override fun onTranscript(committed: String, partial: String) =
                    emit(mapOf("event" to "transcript", "committed" to committed, "partial" to partial))

                override fun onTranscriptionUnavailable(message: String) =
                    emit(mapOf("event" to "transcriptionUnavailable", "message" to message))

                override fun onCaptureEnded(message: String) =
                    emit(mapOf("event" to "captureEnded", "message" to message))
            },
        )
        try {
            rec.start()
        } catch (e: Exception) {
            result.error("start_failed", e.message ?: "Could not start recording.", null)
            return
        }
        recorder = rec
        keepScreenOn(true) // A screen that locks itself would cut the recording off.
        result.success(mapOf("path" to file.absolutePath))
    }

    private fun stop(result: MethodChannel.Result) {
        val rec = recorder
        if (rec == null) {
            result.error("not_recording", "No recording is in progress.", null)
            return
        }
        val accepted = rec.stop { r ->
            if (recorder === rec) recorder = null
            keepScreenOn(false)
            result.success(
                mapOf(
                    "path" to r.path,
                    "durationMs" to r.durationMs,
                    "transcript" to r.transcript,
                    "transcriptProblem" to r.transcriptProblem,
                    "saved" to r.saved,
                ),
            )
        }
        if (!accepted) result.error("busy", "The recording is already being saved.", null)
    }

    private fun hasPermission() = activity.checkPermission(
        Manifest.permission.RECORD_AUDIO, Process.myPid(), Process.myUid(),
    ) == PackageManager.PERMISSION_GRANTED

    private fun requestPermission(result: MethodChannel.Result) {
        if (hasPermission()) {
            result.success("granted")
            return
        }
        if (Build.VERSION.SDK_INT < 23) {
            result.success("denied")
            return
        }
        if (pendingPermission != null) {
            result.error("busy", "A permission request is already open.", null)
            return
        }
        pendingPermission = result
        activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), PERMISSION_REQUEST)
    }

    /** Called by MainActivity with the answer to the permission dialog. */
    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray) {
        if (requestCode != PERMISSION_REQUEST) return
        val result = pendingPermission ?: return
        pendingPermission = null
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        result.success(
            when {
                granted -> "granted"
                Build.VERSION.SDK_INT >= 23 &&
                    !activity.shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO) ->
                    "permanentlyDenied"
                else -> "denied"
            },
        )
    }

    private fun openAppSettings() {
        activity.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    /** Deletes a voice note file; only files in the app's voice_notes folder. */
    private fun deleteFile(path: String?): Boolean {
        if (path.isNullOrEmpty()) return false
        val file = File(path)
        if (file.canonicalFile.parentFile != dir.canonicalFile) return false
        return !file.exists() || file.delete()
    }

    private fun keepScreenOn(on: Boolean) {
        val flag = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        if (on) activity.window.addFlags(flag) else activity.window.clearFlags(flag)
    }

    fun dispose() {
        recorder?.cancel()
        recorder = null
        player.stop()
        methods.setMethodCallHandler(null)
        events.setStreamHandler(null)
        sink = null
    }

    private companion object {
        const val PERMISSION_REQUEST = 7301
    }
}
