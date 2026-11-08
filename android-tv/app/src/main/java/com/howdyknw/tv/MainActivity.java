package com.howdyknw.tv;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.net.URI;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Captures the local Android microphone only while this visible Activity is active.
 * Requires user action and RECORD_AUDIO permission. Does not read system assistant
 * or remote-control-only mic streams. Does not auto-start or record to disk.
 */
public final class MainActivity extends Activity {
    private static final int PERMISSION_REQUEST = 51;
    private static final int SAMPLE_RATE = 16000;
    private static final int FRAME_BYTES = 640; // 20 ms mono PCM16 at 16kHz
    private final AtomicBoolean running = new AtomicBoolean(false);
    private OkHttpClient client;
    private WebSocket socket;
    private AudioRecord recorder;
    private Thread audioThread;
    private EditText urlInput;
    private EditText roomInput;
    private TextView statusView;
    private TextView micView;
    private TextView levelView;
    private Button startButton;
    private Button stopButton;
    private boolean pendingStart = false;
    private String roomCode;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(8, 17, 28));
        client = new OkHttpClient.Builder()
                .pingInterval(20, TimeUnit.SECONDS)
                .build();
        showInterface();
    }

    private TextView label(String text, int size, int color) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(color);
        view.setTextSize(size);
        view.setPadding(0, 0, 0, 14);
        return view;
    }

    private void showInterface() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(8, 17, 28));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int)(36 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root);

        TextView title = label("HOWDYKNW  ·  TV AUDIO", 30, Color.rgb(130, 228, 209));
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title);
        root.addView(label("Transmite el micrófono disponible en este dispositivo a tu sala de Howdyknw. Solo funciona mientras esta pantalla está abierta y activada.", 17, Color.WHITE));

        root.addView(label("Dirección WSS del servidor (HTTPS privado o certificado válido)", 16, 0xFFB8D5DF));
        urlInput = new EditText(this);
        urlInput.setSingleLine(true);
        urlInput.setText("wss://tu-servidor.ts.net/");
        urlInput.setTextColor(Color.WHITE);
        urlInput.setHintTextColor(0xFF8296A8);
        urlInput.setHint("wss://equipo.ts.net/");
        root.addView(urlInput);

        root.addView(label("Código de sala (8–16 letras/números)", 16, 0xFFB8D5DF));
        roomInput = new EditText(this);
        roomInput.setSingleLine(true);
        roomInput.setTextColor(Color.WHITE);
        roomInput.setHint("El mismo código que en el móvil receptor");
        roomInput.setHintTextColor(0xFF8296A8);
        root.addView(roomInput);

        TextView consent = label("Al pulsar INICIAR confirmas que todas las personas presentes conocen y aceptan esta transmisión de audio.", 16, 0xFFFFCC9C);
        root.addView(consent);

        startButton = new Button(this);
        startButton.setText("INICIAR AUDIO · SOLICITAR PERMISO");
        root.addView(startButton);
        stopButton = new Button(this);
        stopButton.setText("DETENER Y APAGAR MICRÓFONO");
        stopButton.setEnabled(false);
        root.addView(stopButton);

        statusView = label("INACTIVO · EL MICRÓFONO NO ESTÁ TRANSMITIENDO", 18, 0xFFCCDDE7);
        root.addView(statusView);
        micView = label("Comprobando entradas de audio…", 14, 0xFF93B0C2);
        root.addView(micView);
        levelView = label("Nivel de entrada: —", 14, 0xFF93B0C2);
        root.addView(levelView);
        root.addView(label("No hay grabación local ni ejecución en segundo plano. El audio del mando o del asistente puede estar restringido por el fabricante; la app no elude esos límites.", 14, 0xFF93B0C2));

        startButton.setOnClickListener(v -> requestStart());
        stopButton.setOnClickListener(v -> stopStreaming("Micrófono desactivado manualmente."));
        setContentView(scroll);
        showMicDevices();
    }

    private void showMicDevices() {
        AudioManager manager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (manager == null) { micView.setText("No se pudo consultar el sistema de audio."); return; }
        AudioDeviceInfo[] inputs = manager.getDevices(AudioManager.GET_DEVICES_INPUTS);
        StringBuilder text = new StringBuilder("Entradas de audio anunciadas: ");
        if (inputs.length == 0) text.append("ninguna");
        for (int i = 0; i < inputs.length; i++) {
            if (i > 0) text.append(" · ");
            text.append(inputs[i].getProductName()).append(" (tipo ").append(inputs[i].getType()).append(")");
        }
        micView.setText(text.toString());
    }

    private void requestStart() {
        if (running.get() || pendingStart) return;
        final String url = urlInput.getText().toString().trim();
        final String room = roomInput.getText().toString().trim().toUpperCase(Locale.ROOT);
        if (!room.matches("[A-Z0-9]{8,16}")) {
            setStatus("Código de sala incorrecto.", false); return;
        }
        try {
            URI uri = URI.create(url);
            if (!"wss".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getUserInfo() != null || uri.getFragment() != null
                    || (uri.getPath() != null && !uri.getPath().isEmpty()
                        && !"/".equals(uri.getPath()))) {
                setStatus("Usa wss://host/ con certificado válido; sin ruta adicional.", false);
                return;
            }
        } catch (IllegalArgumentException ex) {
            setStatus("Dirección del servidor inválida.", false); return;
        }
        roomCode = room;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingStart = true;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, PERMISSION_REQUEST);
            return;
        }
        connect(url);
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != PERMISSION_REQUEST) return;
        pendingStart = false;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            requestStart();
        } else {
            setStatus("Permiso de micrófono denegado. No se ha capturado audio.", false);
        }
    }

    private void connect(String url) {
        startButton.setEnabled(false);
        stopButton.setEnabled(true);
        setStatus("Conectando al servidor… micrófono todavía inactivo.", false);
        Request request;
        try { request = new Request.Builder().url(url).build(); }
        catch (IllegalArgumentException ex) {
            startButton.setEnabled(true);
            stopButton.setEnabled(false);
            setStatus("La dirección WSS no es válida.", false);
            return;
        }
        socket = client.newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(WebSocket ws, Response response) {
                JSONObject join = new JSONObject();
                try {
                    join.put("type", "join");
                    join.put("role", "source");
                    join.put("transport", "pcm16");
                    join.put("room", roomCode);
                    ws.send(join.toString());
                } catch (Exception e) {
                    runOnUiThread(() -> stopStreaming("Error al entrar en la sala."));
                }
            }
            @Override public void onMessage(WebSocket ws, String text) {
                try {
                    JSONObject msg = new JSONObject(text);
                    String type = msg.optString("type");
                    if ("joined".equals(type)) runOnUiThread(() -> {
                        if (socket == ws) startCapture();
                    });
                    else if ("error".equals(type)) runOnUiThread(() -> stopStreaming(
                            "Servidor: " + msg.optString("message", "Error")));
                } catch (Exception e) {
                    runOnUiThread(() -> stopStreaming("Respuesta inválida del servidor."));
                }
            }
            @Override public void onFailure(WebSocket ws, Throwable error, Response response) {
                runOnUiThread(() -> {
                    if (socket == ws) stopStreaming("Falló la conexión WSS: " + error.getMessage());
                });
            }
            @Override public void onClosed(WebSocket ws, int code, String reason) {
                runOnUiThread(() -> {
                    if (socket == ws) stopStreaming("Servidor desconectado.");
                });
            }
        });
    }

    private void startCapture() {
        if (running.get() || socket == null) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            stopStreaming("Sin permiso de micrófono.");
            return;
        }
        final int min = AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (min <= 0) { stopStreaming("No hay entrada PCM 16 kHz disponible."); return; }
        try {
            recorder = new AudioRecord(MediaRecorder.AudioSource.MIC,
                    SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                    Math.max(min, FRAME_BYTES * 8));
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                stopStreaming("El fabricante no permite abrir este micrófono.");
                return;
            }
            recorder.startRecording();
            if (recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                stopStreaming("La entrada de audio no ha comenzado.");
                return;
            }
        } catch (Exception ex) {
            stopStreaming("No se pudo activar la entrada de audio: " + ex.getMessage()); return;
        }
        running.set(true);
        setStatus("● TRANSMITIENDO · MICRÓFONO ACTIVO · CÓDIGO " + roomCode, true);
        AudioDeviceInfo route = recorder.getRoutedDevice();
        if (route != null) micView.setText("Entrada realmente utilizada: "
                + route.getProductName() + " (tipo " + route.getType() + ")");
        final AudioRecord activeRecorder = recorder;
        final WebSocket activeSocket = socket;
        audioThread = new Thread(() -> captureLoop(activeRecorder, activeSocket), "howdyknw-mic");
        audioThread.start();
    }

    private void captureLoop(AudioRecord input, WebSocket ws) {
        byte[] frame = new byte[FRAME_BYTES];
        int position = 0;
        long lastMeter = System.currentTimeMillis();
        while (running.get()) {
            int n;
            try { n = input.read(frame, position, frame.length - position, AudioRecord.READ_BLOCKING); }
            catch (Exception ex) { n = -1; }
            if (n <= 0) break;
            position += n;
            if (position < FRAME_BYTES) continue;
            position = 0;
            if (ws.queueSize() > 256_000) continue; // Drop, do not accumulate raw audio.
            String encoded = Base64.encodeToString(frame, Base64.NO_WRAP);
            JSONObject packet = new JSONObject();
            try {
                packet.put("type", "audio-frame");
                packet.put("pcm", encoded);
                if (!ws.send(packet.toString())) break;
            } catch (Exception ex) { break; }
            if (System.currentTimeMillis() - lastMeter >= 600) {
                long sum = 0;
                for (int i = 0; i < FRAME_BYTES; i += 2) {
                    int v = (frame[i] & 255) | (frame[i + 1] << 8);
                    short pcm = (short)v;
                    sum += (long)pcm * pcm;
                }
                int level = (int)Math.sqrt(sum / (FRAME_BYTES / 2.0));
                runOnUiThread(() -> {
                    if (running.get()) levelView.setText(
                            "Nivel de micrófono: " + level + " / 32768 (PCM)");
                });
                lastMeter = System.currentTimeMillis();
            }
        }
        if (running.get()) runOnUiThread(() ->
                stopStreaming("El micrófono dejó de entregar audio o se cortó la conexión."));
    }

    private void setStatus(String message, boolean streaming) {
        statusView.setText(message);
        statusView.setTextColor(streaming ? 0xFF8AF3CB : 0xFFFFCC9C);
    }

    private void stopStreaming(String message) {
        pendingStart = false;
        running.set(false);
        WebSocket oldSocket = socket;
        socket = null;
        if (oldSocket != null) oldSocket.close(1000, "User stopped mic");
        AudioRecord old = recorder;
        recorder = null;
        if (old != null) {
            try { old.stop(); } catch (Exception ignored) {}
            try { old.release(); } catch (Exception ignored) {}
        }
        startButton.setEnabled(true);
        stopButton.setEnabled(false);
        levelView.setText("Nivel de entrada: —");
        setStatus(message, false);
    }

    @Override protected void onPause() {
        super.onPause();
        // No foreground service: cannot continue listening with this Activity hidden.
        if (socket != null || running.get()) stopStreaming("Micrófono detenido: la aplicación perdió el primer plano.");
    }

    @Override protected void onDestroy() {
        stopStreaming("Micrófono apagado.");
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
        super.onDestroy();
    }
}
