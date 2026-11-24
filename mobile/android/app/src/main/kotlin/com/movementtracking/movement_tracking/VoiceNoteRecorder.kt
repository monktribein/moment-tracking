package com.movementtracking.movement_tracking

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.util.ArrayDeque
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.log10
import kotlin.math.sqrt

/** 16-bit mono PCM audio, read in chunks. */
interface PcmSource {
    val sampleRate: Int

    /** Opens the source; throws with a message the agent can read when it can't. */
    fun open()

    /** Fills [buffer]; returns the number of bytes read, or -1 when the source failed. */
    fun read(buffer: ByteArray): Int

    fun close()
}

/** The phone's microphone. */
class MicrophoneSource(override val sampleRate: Int = 16_000) : PcmSource {
    private var record: AudioRecord? = null

    @SuppressLint("MissingPermission") // The channel checks RECORD_AUDIO before recording starts.
    override fun open() {
        val minBuffer = AudioRecord.getMinBufferSize(
            sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer <= 0) throw IllegalStateException("This phone's microphone can't record right now.")
        val r = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuffer, sampleRate * 2), // about a second of audio
        )
        if (r.state != AudioRecord.STATE_INITIALIZED) {
            r.release()
            throw IllegalStateException("Could not open the microphone.")
        }
        try {
            r.startRecording()
        } catch (e: IllegalStateException) {
            r.release()
            throw IllegalStateException("Could not start the microphone.")
        }
        if (r.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            r.release()
            throw IllegalStateException("The microphone is being used by another app.")
        }
        record = r
    }

    override fun read(buffer: ByteArray): Int {
        val r = record ?: return -1
        val n = r.read(buffer, 0, buffer.size)
        return if (n < 0) -1 else n
    }

    override fun close() {
        record?.let {
            try {
                it.stop()
            } catch (_: IllegalStateException) {
            }
            it.release()
        }
        record = null
    }
}

/** Encodes 16-bit mono PCM to AAC in an .m4a file (about 0.25 MB a minute). */
class AacFileWriter(private val file: File, private val sampleRate: Int) {
    private val codec: MediaCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    private lateinit var muxer: MediaMuxer
    private val info = MediaCodec.BufferInfo()
    private var track = -1
    private var muxing = false
    private var samplesQueued = 0L
    private var released = false

    init {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, 1).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 32_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384)
        }
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        } catch (e: Exception) {
            codec.release()
            throw e
        }
    }

    private fun presentationUs() = samplesQueued * 1_000_000L / sampleRate

    fun write(pcm: ByteArray, length: Int) {
        var offset = 0
        while (offset < length) {
            val index = codec.dequeueInputBuffer(10_000)
            if (index >= 0) {
                val buffer = codec.getInputBuffer(index)
                if (buffer == null) {
                    codec.queueInputBuffer(index, 0, 0, presentationUs(), 0)
                } else {
                    buffer.clear()
                    val n = minOf(buffer.remaining(), length - offset)
                    buffer.put(pcm, offset, n)
                    codec.queueInputBuffer(index, 0, n, presentationUs(), 0)
                    samplesQueued += n / 2
                    offset += n
                }
            }
            drain(false)
        }
    }

    /** Ends the stream and closes the file. False when nothing playable was written. */
    fun finish(): Boolean {
        if (released) return muxing
        try {
            var queued = false
            var tries = 0
            while (!queued && tries++ < 100) {
                val index = codec.dequeueInputBuffer(10_000)
                if (index >= 0) {
                    codec.queueInputBuffer(index, 0, 0, presentationUs(), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                    queued = true
                } else {
                    drain(false)
                }
            }
            if (queued) drain(true)
        } catch (_: Exception) {
        }
        release()
        return muxing
    }

    /** Throws the recording away. */
    fun abort() {
        release()
        file.delete()
    }

    private fun drain(endOfStream: Boolean) {
        var idle = 0
        while (true) {
            val index = codec.dequeueOutputBuffer(info, if (endOfStream) 10_000L else 0L)
            when {
                index == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                    if (!endOfStream || ++idle > 200) return
                }
                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    if (!muxing) {
                        track = muxer.addTrack(codec.outputFormat)
                        muxer.start()
                        muxing = true
                    }
                }
                index >= 0 -> {
                    val buffer = codec.getOutputBuffer(index)
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                    if (buffer != null && info.size > 0 && muxing) {
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        muxer.writeSampleData(track, buffer, info)
                    }
                    codec.releaseOutputBuffer(index, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                }
            }
        }
    }

    private fun release() {
        if (released) return
        released = true
        try {
            codec.stop()
        } catch (_: Exception) {
        }
        codec.release()
        try {
            if (muxing) muxer.stop()
        } catch (_: Exception) {
            muxing = false // Nothing was written: the file isn't playable.
        }
        try {
            muxer.release()
        } catch (_: Exception) {
        }
    }
}

/**
 * Turns the recording's own audio into text with the phone's speech
 * recognition service (Google's on most phones).
 *
 * The app owns the microphone and hands the recognizer the same audio through
 * a pipe (RecognizerIntent.EXTRA_AUDIO_SOURCE), so recording and recognition
 * never compete for the mic. Android 13+ keeps one continuous session going
 * through pauses (EXTRA_SEGMENTED_SESSION); a session that ends while the
 * agent is still recording is simply started again, keeping the text so far.
 *
 * Recognizer calls and callbacks run on the main thread; [feed] may be
 * called from any thread.
 */
class LiveTranscriber(
    private val context: Context,
    private val language: String,
    private val sampleRate: Int,
    private val onTranscript: (committed: String, partial: String) -> Unit,
    private val onUnavailable: (message: String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val queue = LinkedBlockingQueue<ByteArray>(600) // ~60 s of 100 ms chunks
    private val writerLock = Any()
    private var writer: OutputStream? = null
    private var readEnd: ParcelFileDescriptor? = null
    private var recognizer: SpeechRecognizer? = null

    private val committed = StringBuilder()
    private var partial = ""
    private var lastSegment = ""

    @Volatile private var heardSound = false
    @Volatile private var inputEnded = false
    @Volatile private var feederRunning = false
    private var sessionHadText = false
    private var deafSessions = 0
    private var transientFailures = 0
    private var networkFailures = 0
    private val restarts = ArrayDeque<Long>()

    private var active = false
    private var finishing = false
    private var stopped = false
    private var onFinished: ((String, String?) -> Unit)? = null

    // For a second try over the whole recording when no words came back live
    // (short recordings can end before the recognizer has warmed up).
    private val clipLock = Any()
    private val maxClipBytes = sampleRate * 2 * 120 // two minutes
    private var clip: ByteArrayOutputStream? = ByteArrayOutputStream()

    // Why no words came back, to tell the agent.
    @Volatile private var everHeardSound = false
    private var ready = false
    private var lastError: Int? = null
    private var gaveUpMessage: String? = null

    val transcript: String get() = join(committed.toString(), partial)

    fun start() {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            stopped = true
            gaveUpMessage = "This phone has no speech recognition service, so no text could be made."
            onUnavailable("Live text isn't available: this phone has no speech recognition service. The recording is still being saved.")
            return
        }
        active = true
        feederRunning = true
        Thread(::feedLoop, "voice-note-feeder").apply { isDaemon = true }.start()
        startSession()
    }

    /** Queues a chunk of the recording for the recognizer. */
    fun feed(chunk: ByteArray, loud: Boolean) {
        if (!feederRunning || inputEnded) return
        if (loud) {
            heardSound = true
            everHeardSound = true
        }
        synchronized(clipLock) {
            val c = clip
            if (c != null) {
                if (c.size() + chunk.size > maxClipBytes) clip = null else c.write(chunk, 0, chunk.size)
            }
        }
        if (!queue.offer(chunk)) {
            queue.poll()
            queue.offer(chunk)
        }
    }

    /**
     * Lets the recognizer finish the last words, then reports the whole text,
     * and when there is none, why (for the agent).
     */
    fun finish(callback: (text: String, problem: String?) -> Unit) {
        if (!active || stopped) {
            cleanup()
            callback(transcript, problem())
            return
        }
        finishing = true
        onFinished = callback
        inputEnded = true // The feeder closes the pipe once it has handed over everything.
        main.postDelayed({ complete() }, 6_000) // Never wait longer than this.
    }

    fun cancel() {
        stopped = true
        onFinished = null
        cleanup()
    }

    private fun feedLoop() {
        val backlog = ArrayDeque<ByteArray>()
        var backlogBytes = 0
        val maxBacklog = sampleRate * 2 * 3 // what a new session may need to catch up on
        while (feederRunning) {
            val chunk = try {
                queue.poll(50, TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
                null
            }
            if (chunk != null) {
                backlog.addLast(chunk)
                backlogBytes += chunk.size
            }
            while (backlogBytes > maxBacklog) backlogBytes -= backlog.removeFirst().size
            val out = synchronized(writerLock) { writer }
            if (out != null) {
                while (backlog.isNotEmpty()) {
                    val next = backlog.first()
                    try {
                        out.write(next)
                    } catch (_: IOException) {
                        // The session ended; the next one picks up from here.
                        synchronized(writerLock) { if (writer === out) writer = null }
                        break
                    }
                    backlog.removeFirst()
                    backlogBytes -= next.size
                }
            }
            if (inputEnded && queue.isEmpty() && (backlog.isEmpty() || out == null)) {
                // Closing the pipe tells the recognizer the speech is over.
                synchronized(writerLock) {
                    try {
                        writer?.close()
                    } catch (_: IOException) {
                    }
                    writer = null
                }
                break
            }
        }
    }

    private fun startSession() {
        if (!active || stopped || finishing) return
        val now = System.currentTimeMillis()
        while (restarts.isNotEmpty() && now - restarts.first() > 60_000) restarts.removeFirst()
        if (restarts.size >= 30) {
            giveUp("Live text stopped responding. The recording is still being saved.")
            return
        }
        restarts.addLast(now)

        val pipe = try {
            ParcelFileDescriptor.createPipe()
        } catch (e: IOException) {
            giveUp("Live text couldn't start. The recording is still being saved.")
            return
        }
        val rec = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also {
            it.setRecognitionListener(listener)
            recognizer = it
        }
        readEnd = pipe[0]
        synchronized(writerLock) { writer = ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]) }
        sessionHadText = false
        heardSound = false
        lastSegment = ""
        try {
            rec.startListening(recognizerIntent(pipe[0]))
        } catch (e: Exception) {
            giveUp("Live text couldn't start. The recording is still being saved.")
        }
    }

    /** Recognition of our own audio, read from [source] (16-bit mono PCM). */
    private fun recognizerIntent(source: ParcelFileDescriptor) =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, source)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, sampleRate)
            if (Build.VERSION.SDK_INT >= 33) {
                putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
            }
        }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            ready = true
        }
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onPartialResults(partialResults: Bundle?) {
            val text = firstText(partialResults) ?: return
            val fresh = withoutPrefix(text, lastSegment)
            if (fresh.isNotBlank()) gotText()
            partial = fresh
            publish()
        }

        override fun onSegmentResults(segmentResults: Bundle) {
            val text = firstText(segmentResults).orEmpty()
            val fresh = withoutPrefix(text, lastSegment)
            if (fresh.isNotBlank()) gotText()
            commit(fresh.ifBlank { partial })
            if (text.isNotBlank()) lastSegment = text
        }

        override fun onEndOfSegmentedSession() {
            commit(partial)
            sessionEnded()
        }

        override fun onResults(results: Bundle?) {
            val text = firstText(results)
            commit(if (text.isNullOrBlank()) partial else withoutPrefix(text, lastSegment))
            sessionEnded()
        }

        override fun onError(error: Int) = handleError(error)
    }

    private fun handleError(code: Int) {
        lastError = code
        if (finishing) {
            commit(partial)
            complete()
            return
        }
        if (stopped) return
        when (code) {
            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> {
                // The agent paused. But if there was clearly speech and nothing
                // came back three times running, the recognizer isn't hearing
                // the recording on this phone.
                if (heardSound && !sessionHadText) deafSessions++
                if (deafSessions >= 3) {
                    giveUp("Live text isn't supported on this phone. The recording is still being saved.")
                } else {
                    commit(partial)
                    sessionEnded()
                }
            }
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT -> {
                if (++transientFailures > 5) {
                    giveUp("Live text stopped responding. The recording is still being saved.")
                } else {
                    commit(partial)
                    restartAfter(600)
                }
            }
            SpeechRecognizer.ERROR_NETWORK,
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
            SpeechRecognizer.ERROR_SERVER,
            11 /* ERROR_SERVER_DISCONNECTED */ -> {
                if (++networkFailures > 3) {
                    giveUp("Live text needs internet, or this language's offline speech pack. The recording is still being saved.")
                } else {
                    commit(partial)
                    restartAfter(1_000L * networkFailures)
                }
            }
            12 /* ERROR_LANGUAGE_NOT_SUPPORTED */, 13 /* ERROR_LANGUAGE_UNAVAILABLE */ ->
                giveUp("Live text isn't available for this language on this phone. Try the other language, or install its offline speech pack. The recording is still being saved.")
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                giveUp("Live text needs the microphone permission. The recording is still being saved.")
            else -> giveUp("Live text stopped (code $code). The recording is still being saved.")
        }
    }

    private fun gotText() {
        sessionHadText = true
        deafSessions = 0
        transientFailures = 0
        networkFailures = 0
    }

    private fun sessionEnded() {
        closePipe()
        if (finishing) {
            complete()
            return
        }
        if (active && !stopped) main.post { startSession() }
    }

    private fun restartAfter(delayMs: Long) {
        closePipe()
        main.postDelayed({ startSession() }, delayMs)
    }

    private fun giveUp(message: String) {
        commit(partial)
        stopped = true
        gaveUpMessage = message.removeSuffix(" The recording is still being saved.")
        cleanup()
        onUnavailable(message)
    }

    private fun complete() {
        val callback = onFinished ?: return
        onFinished = null
        commit(partial)
        cleanup()
        val pcm = synchronized(clipLock) {
            val bytes = if (transcript.isBlank() && worthRetrying()) clip?.toByteArray() else null
            clip = null
            bytes
        }
        if (pcm == null || pcm.size < sampleRate) { // under half a second
            callback(transcript, problem())
            return
        }
        transcribeClip(pcm) { text, error ->
            if (error != null) lastError = error
            commit(text)
            callback(transcript, problem())
        }
    }

    private fun worthRetrying() =
        everHeardSound && gaveUpMessage == null && lastError !in NETWORK_ERRORS && lastError !in LANGUAGE_ERRORS

    /**
     * One more pass of speech-to-text over the whole recording, now that the
     * recognizer is warm. Calls back on the main thread, at the latest after
     * the recording's length plus a few seconds.
     */
    private fun transcribeClip(pcm: ByteArray, callback: (text: String, error: Int?) -> Unit) {
        val pipe = try {
            ParcelFileDescriptor.createPipe()
        } catch (e: IOException) {
            callback("", null)
            return
        }
        val rec = try {
            SpeechRecognizer.createSpeechRecognizer(context)
        } catch (e: Exception) {
            pipe.forEach { closeQuietly(it) }
            callback("", null)
            return
        }
        val text = StringBuilder()
        var pending = ""
        var error: Int? = null
        var done = false
        fun end() {
            if (done) return
            done = true
            try {
                rec.cancel()
            } catch (_: Exception) {
            }
            rec.destroy()
            closeQuietly(pipe[0])
            callback(join(text.toString(), pending), error)
        }
        rec.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                ready = true
            }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onPartialResults(partialResults: Bundle?) {
                firstText(partialResults)?.let { pending = it }
            }
            override fun onSegmentResults(segmentResults: Bundle) {
                val segment = firstText(segmentResults).orEmpty().ifBlank { pending }.trim()
                if (segment.isNotEmpty()) {
                    if (text.isNotEmpty()) text.append(' ')
                    text.append(segment)
                }
                pending = ""
            }
            override fun onEndOfSegmentedSession() = end()
            override fun onResults(results: Bundle?) {
                val last = firstText(results)
                if (!last.isNullOrBlank()) pending = last
                end()
            }
            override fun onError(code: Int) {
                error = code
                end()
            }
        })
        try {
            rec.startListening(recognizerIntent(pipe[0]))
        } catch (e: Exception) {
            closeQuietly(pipe[1])
            end()
            return
        }
        Thread({
            try {
                ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { out ->
                    var offset = 0
                    while (offset < pcm.size) {
                        val n = minOf(3_200, pcm.size - offset)
                        out.write(pcm, offset, n)
                        offset += n
                    }
                }
            } catch (_: IOException) {
                // The recognizer stopped reading; it reports what it has.
            }
        }, "voice-note-retry").apply { isDaemon = true }.start()
        val seconds = pcm.size / (sampleRate * 2)
        main.postDelayed({ end() }, minOf(8_000L + seconds * 1_000L, 20_000L))
    }

    /** Why there is no text, in words the agent can act on; null when there is text. */
    private fun problem(): String? {
        if (transcript.isNotBlank()) return null
        gaveUpMessage?.let { return it }
        if (!everHeardSound) {
            return "No voice was heard. Speak close to the phone and make sure nothing covers the microphone."
        }
        return when (lastError) {
            in NETWORK_ERRORS -> "No text: speech-to-text needs internet, or this language's offline speech pack."
            in LANGUAGE_ERRORS -> "No text: speech-to-text isn't available for this language on this phone. Try the other language."
            else -> if (!ready) {
                "Speech-to-text didn't start on this phone. Check the internet and try again."
            } else {
                "No words were recognised. Speak clearly, close to the phone, in the language chosen above."
            }
        }
    }

    private fun commit(text: String) {
        val clean = text.trim()
        if (clean.isNotEmpty()) {
            if (committed.isNotEmpty()) committed.append(' ')
            committed.append(clean)
        }
        partial = ""
        publish()
    }

    private fun publish() = onTranscript(committed.toString(), partial)

    private fun closePipe() {
        try {
            readEnd?.close()
        } catch (_: IOException) {
        }
        readEnd = null
        synchronized(writerLock) {
            try {
                writer?.close()
            } catch (_: IOException) {
            }
            writer = null
        }
    }

    private fun cleanup() {
        active = false
        feederRunning = false
        closePipe()
        recognizer?.let {
            try {
                it.cancel()
            } catch (_: Exception) {
            }
            it.destroy()
        }
        recognizer = null
        queue.clear()
    }

    private companion object {
        val NETWORK_ERRORS = setOf(
            SpeechRecognizer.ERROR_NETWORK,
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
            SpeechRecognizer.ERROR_SERVER,
            11, // ERROR_SERVER_DISCONNECTED
        )
        val LANGUAGE_ERRORS = setOf(12, 13) // ERROR_LANGUAGE_NOT_SUPPORTED / _UNAVAILABLE

        fun closeQuietly(fd: ParcelFileDescriptor) {
            try {
                fd.close()
            } catch (_: IOException) {
            }
        }

        fun firstText(bundle: Bundle?): String? =
            bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

        fun join(a: String, b: String) = listOf(a.trim(), b.trim()).filter { it.isNotEmpty() }.joinToString(" ")

        /** Some recognizers repeat the finished segment at the start of the next partials. */
        fun withoutPrefix(text: String, prefix: String): String {
            if (prefix.split(' ').size < 3 || !text.startsWith(prefix, ignoreCase = true)) return text
            return text.substring(prefix.length).trim()
        }
    }
}

/**
 * One voice note: records the microphone to an .m4a file and, at the same
 * time, transcribes that audio live. Listener callbacks arrive on the main
 * thread.
 */
class VoiceNoteRecorder(
    private val context: Context,
    private val file: File,
    private val language: String,
    private val source: PcmSource,
    private val listener: Listener,
) {
    interface Listener {
        /** Input loudness, 0..1, about ten times a second (for the waveform). */
        fun onLevel(level: Double)
        fun onTranscript(committed: String, partial: String)

        /** Live text stopped; the recording carries on. */
        fun onTranscriptionUnavailable(message: String)

        /** Recording stopped on its own (mic failure or time limit); call [stop] to save it. */
        fun onCaptureEnded(message: String)
    }

    /** [transcriptProblem]: why there is no text, when there is none. */
    class Result(
        val path: String,
        val durationMs: Long,
        val transcript: String,
        val saved: Boolean,
        val transcriptProblem: String?,
    )

    private val main = Handler(Looper.getMainLooper())
    @Volatile private var writer: AacFileWriter? = null
    @Volatile private var transcriber: LiveTranscriber? = null
    private var thread: Thread? = null
    @Volatile private var capturing = false
    @Volatile private var samples = 0L
    private var stopping = false

    /** Throws with a readable message when the microphone or the file can't be opened. */
    fun start() {
        file.parentFile?.mkdirs()
        source.open()
        writer = try {
            AacFileWriter(file, source.sampleRate)
        } catch (e: Exception) {
            source.close()
            throw IllegalStateException("Could not create the recording file.")
        }
        transcriber = LiveTranscriber(
            context,
            language,
            source.sampleRate,
            { committed, partial -> listener.onTranscript(committed, partial) },
            { message -> listener.onTranscriptionUnavailable(message) },
        ).also { it.start() }
        capturing = true
        thread = Thread(::captureLoop, "voice-note-capture").also { it.start() }
    }

    private fun captureLoop() {
        val buffer = ByteArray(source.sampleRate / 10 * 2) // 100 ms
        val maxSamples = source.sampleRate.toLong() * 60 * MAX_MINUTES
        var reason: String? = null
        while (capturing) {
            val n = source.read(buffer)
            if (n < 0) {
                reason = "The microphone stopped working, so the recording was stopped and saved."
                break
            }
            if (n == 0) continue
            try {
                writer?.write(buffer, n)
            } catch (e: Exception) {
                reason = "The audio couldn't be written, so the recording was stopped."
                break
            }
            samples += n / 2
            val level = levelOf(buffer, n)
            transcriber?.feed(buffer.copyOf(n), level > 0.25)
            main.post { listener.onLevel(level) }
            if (samples >= maxSamples) {
                reason = "Recordings are limited to $MAX_MINUTES minutes, so this one was stopped and saved."
                break
            }
        }
        val message = reason
        if (message != null && capturing) {
            capturing = false
            main.post { listener.onCaptureEnded(message) }
        }
    }

    /** Finishes the file and the transcript. False when a stop is already under way. */
    fun stop(callback: (Result) -> Unit): Boolean {
        if (stopping) return false
        stopping = true
        capturing = false
        val t = transcriber
        Thread {
            thread?.join(2_000)
            source.close()
            val saved = writer?.finish() ?: false
            writer = null
            val durationMs = samples * 1000 / source.sampleRate
            main.post {
                val done: (String, String?) -> Unit = { text, problem ->
                    if (!saved) file.delete()
                    callback(Result(file.absolutePath, durationMs, text, saved, problem))
                }
                if (t == null) done("", null) else t.finish(done)
            }
        }.start()
        return true
    }

    /** Stops and deletes the recording. */
    fun cancel() {
        stopping = true
        capturing = false
        transcriber?.cancel()
        Thread {
            thread?.join(2_000)
            source.close()
            writer?.abort()
            writer = null
            file.delete()
        }.start()
    }

    private companion object {
        const val MAX_MINUTES = 30

        /** RMS loudness mapped from -60..0 dBFS to 0..1. */
        fun levelOf(pcm: ByteArray, length: Int): Double {
            var sum = 0.0
            var i = 0
            while (i + 1 < length) {
                val sample = ((pcm[i + 1].toInt() shl 8) or (pcm[i].toInt() and 0xff)).toShort().toDouble()
                sum += sample * sample
                i += 2
            }
            val count = length / 2
            if (count == 0) return 0.0
            val rms = sqrt(sum / count)
            if (rms < 1.0) return 0.0
            val db = 20 * log10(rms / 32768.0)
            return ((db + 60) / 60).coerceIn(0.0, 1.0)
        }
    }
}
