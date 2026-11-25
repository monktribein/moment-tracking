package com.movementtracking.movement_tracking

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper

/** Plays saved voice notes, reporting progress as "playback" events. */
class VoiceNotePlayer(private val emit: (Map<String, Any?>) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var path: String? = null

    private val ticker = object : Runnable {
        override fun run() {
            val p = player ?: return
            report(if (safe { p.isPlaying } == true) "playing" else "paused")
            main.postDelayed(this, 250)
        }
    }

    /** Starts [file]; returns its length in ms, or throws when it can't be played. */
    fun play(file: String): Int {
        stop()
        val p = MediaPlayer()
        try {
            p.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            p.setDataSource(file)
            p.prepare()
        } catch (e: Exception) {
            p.release()
            throw IllegalStateException("This recording can't be played.")
        }
        p.setOnCompletionListener {
            report("completed", safe { it.duration })
            release()
        }
        p.setOnErrorListener { _, _, _ ->
            report("error")
            release()
            true
        }
        player = p
        path = file
        p.start()
        main.removeCallbacks(ticker)
        main.post(ticker)
        return p.duration
    }

    fun pause() {
        val p = player ?: return
        if (safe { p.isPlaying } == true) p.pause()
        main.removeCallbacks(ticker)
        report("paused")
    }

    fun resume() {
        val p = player ?: return
        p.start()
        main.removeCallbacks(ticker)
        main.post(ticker)
    }

    fun seek(positionMs: Int) {
        val p = player ?: return
        p.seekTo(positionMs)
        report(if (safe { p.isPlaying } == true) "playing" else "paused", positionMs)
    }

    fun stop() {
        if (player == null) return
        report("stopped", 0)
        release()
    }

    private fun report(state: String, position: Int? = null) {
        val p = player
        emit(
            mapOf(
                "event" to "playback",
                "path" to path,
                "state" to state,
                "positionMs" to (position ?: safe { p?.currentPosition } ?: 0),
                "durationMs" to (safe { p?.duration } ?: 0),
            ),
        )
    }

    private fun release() {
        main.removeCallbacks(ticker)
        player?.release()
        player = null
        path = null
    }

    private inline fun <T> safe(block: () -> T): T? = try {
        block()
    } catch (_: IllegalStateException) {
        null
    }
}
