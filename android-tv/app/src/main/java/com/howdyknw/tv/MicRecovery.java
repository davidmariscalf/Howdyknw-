package com.howdyknw.tv;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

/**
 * Tries regular Android microphone input configurations one at a time, but never
 * bypasses RECORD_AUDIO or privacy switches. Every failed recorder is released.
 * A successful open only confirms that AudioRecord started, not audible PCM.
 */
final class MicRecovery {
    private MicRecovery() {}

    static final class Result {
        final AudioRecord recorder;
        final String routeLabel;
        final String error;

        private Result(AudioRecord recorder, String routeLabel, String error) {
            this.recorder = recorder;
            this.routeLabel = routeLabel;
            this.error = error;
        }

        static Result success(AudioRecord recorder, String label) {
            return new Result(recorder, label, null);
        }

        static Result failure(String error) {
            return new Result(null, null, error);
        }
    }

    static String nameFor(int source) {
        if (source == MediaRecorder.AudioSource.MIC) return "MIC";
        if (source == MediaRecorder.AudioSource.VOICE_RECOGNITION) return "VOICE_RECOGNITION";
        if (source == MediaRecorder.AudioSource.DEFAULT) return "DEFAULT";
        return "ORIGEN " + source;
    }

    static Result open(int sampleRate, int frameBytes) {
        final int min = AudioRecord.getMinBufferSize(
                sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (min <= 0) {
            return Result.failure("Android no admite PCM16 mono a " + sampleRate
                    + " Hz en este dispositivo.");
        }

        // Each option is a standard public AudioRecord source. None reads audio
        // privately reserved for Google Assistant, the remote, or the OS.
        final int[] sources = {
                MediaRecorder.AudioSource.MIC,
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                MediaRecorder.AudioSource.DEFAULT
        };
        StringBuilder failures = new StringBuilder();
        for (int source : sources) {
            AudioRecord candidate = null;
            try {
                candidate = new AudioRecord(
                        source, sampleRate, AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT, Math.max(min, frameBytes * 8));
                if (candidate.getState() == AudioRecord.STATE_INITIALIZED) {
                    candidate.startRecording();
                    if (candidate.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                        return Result.success(candidate, nameFor(source));
                    }
                }
                if (failures.length() > 0) failures.append("; ");
                failures.append(nameFor(source)).append(": no inició");
            } catch (SecurityException e) {
                // When the OS forbids microphone input, do not iterate ways
                // around that decision or launch background capture.
                if (candidate != null) release(candidate);
                return Result.failure("Android ha bloqueado el acceso al micrófono. "
                        + "Revisa permiso y controles de privacidad.");
            } catch (Exception e) {
                if (failures.length() > 0) failures.append("; ");
                failures.append(nameFor(source)).append(": ")
                        .append(e.getClass().getSimpleName());
            }
            if (candidate != null) release(candidate);
        }
        return Result.failure("No hay una entrada de audio PCM accesible. "
                + failures + ". Prueba el dictado o teclado del sistema.");
    }

    private static void release(AudioRecord recorder) {
        try {
            if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING)
                recorder.stop();
        } catch (Exception ignored) {}
        try { recorder.release(); } catch (Exception ignored) {}
    }
}
