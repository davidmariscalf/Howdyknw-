package com.howdyknw.tv;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.speech.RecognizerIntent;
import android.view.inputmethod.InputMethodManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.net.URI;
import java.util.ArrayList;
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
    private static final int SPEECH_REQUEST = 52;
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
    private TextView viewerView;
    private TextView dictationStatus;
    private EditText dictationInput;
    private CheckBox dictationConsent;
    private Button shareTranscriptButton;
    private WebSocket transcriptSocket;
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
        viewerView = label("Receptores conectados a la sala: 0", 16, 0xFFB6E9D9);
        root.addView(viewerView);
        root.addView(label("No hay grabación local ni ejecución en segundo plano. El audio del mando o del asistente puede estar restringido por el fabricante; la app no elude esos límites.", 14, 0xFF93B0C2));

        TextView keyboardHeader = label("ALTERNATIVA: TECLADO Y DICTADO DEL SISTEMA", 23, 0xFF86E8D1);
        keyboardHeader.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(keyboardHeader);
        root.addView(label("Si Android bloquea la captura PCM, el teclado oficial de la TV puede ofrecer un botón de micrófono para dictar. Esta vía devuelve TEXTO, no el audio del micrófono. Algunos modelos no incluyen dictado.", 15, Color.WHITE));

        dictationInput = new EditText(this);
        dictationInput.setSingleLine(false);
        dictationInput.setMinLines(2);
        dictationInput.setMaxLines(5);
        dictationInput.setTextColor(Color.WHITE);
        dictationInput.setHintTextColor(0xFF93B0C2);
        dictationInput.setHint("Aquí aparecerá el texto dictado o escrito manualmente.");
        dictationInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        root.addView(dictationInput);

        Button systemKeyboard = new Button(this);
        systemKeyboard.setText("ABRIR TECLADO DE LA TV (DICTADO SI EXISTE)");
        root.addView(systemKeyboard);
        Button voiceIntent = new Button(this);
        voiceIntent.setText("PROBAR RECONOCIMIENTO DE VOZ DEL SISTEMA");
        root.addView(voiceIntent);

        dictationConsent = new CheckBox(this);
        dictationConsent.setText("Confirmo que los presentes conocen y aceptan esta prueba y el envío del texto que seleccione compartir.");
        dictationConsent.setTextColor(0xFFFFD7B3);
        root.addView(dictationConsent);
        shareTranscriptButton = new Button(this);
        shareTranscriptButton.setText("COMPARTIR SOLO EL TEXTO CON MI SALA");
        root.addView(shareTranscriptButton);

        dictationStatus = label("Texto local: aún no se ha compartido nada.", 14, 0xFF93B0C2);
        root.addView(dictationStatus);
        root.addView(label("IMPORTANTE: el reconocedor de voz del fabricante puede usar servidores externos. Howdyknw no recibe el audio que usa el teclado; solo comparte el texto si pulsas el botón anterior.", 13, 0xFF93B0C2));

        systemKeyboard.setOnClickListener(v -> showSystemKeyboard());
        voiceIntent.setOnClickListener(v -> launchSystemDictation());
        shareTranscriptButton.setOnClickListener(v -> shareTranscript());

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
                    else if ("listener-count".equals(type)) {
                        int count = Math.max(0, Math.min(4, msg.optInt("count", 0)));
                        runOnUiThread(() -> {
                            if (socket == ws)
                                viewerView.setText("Receptores conectados a la sala: " + count);
                        });
                    }
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


    /** Focus an ordinary EditText; Android TV Gboard may offer its own voice-input key. */
    private void showSystemKeyboard() {
        if (socket != null || running.get()) {
            stopStreaming("Micrófono PCM detenido antes de abrir el teclado.");
        }
        dictationInput.requestFocus();
        InputMethodManager imm =
                (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm == null) {
            dictationStatus.setText("El sistema no expone un teclado utilizable.");
            return;
        }
        boolean shown = imm.showSoftInput(dictationInput, InputMethodManager.SHOW_IMPLICIT);
        dictationStatus.setText(shown
                ? "Teclado del sistema solicitado. Pulsa el icono de micrófono si existe."
                : "El teclado no se ha mostrado. Comprueba los ajustes del teclado de la TV.");
    }

    /** Ask the TV's installed recognition activity for words, never raw microphone bytes. */
    private void launchSystemDictation() {
        if (socket != null || running.get()) {
            stopStreaming("Micrófono PCM detenido antes de usar dictado.");
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,
                Locale.getDefault().toLanguageTag());
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT,
                "Prueba de dictado voluntaria de Howdyknw");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(intent, SPEECH_REQUEST);
            dictationStatus.setText(
                    "Reconocimiento solicitado. Puede procesar voz mediante un servicio externo.");
        } catch (ActivityNotFoundException ex) {
            dictationStatus.setText(
                    "Esta TV no tiene instalada una actividad de reconocimiento de voz compatible.");
        } catch (SecurityException ex) {
            dictationStatus.setText(
                    "Android o el fabricante han bloqueado la función de dictado.");
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SPEECH_REQUEST) return;
        if (resultCode != RESULT_OK || data == null) {
            dictationStatus.setText("Dictado cancelado o no disponible. Nada compartido.");
            return;
        }
        ArrayList<String> words = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (words == null || words.isEmpty() || words.get(0) == null
                || words.get(0).trim().isEmpty()) {
            dictationStatus.setText("El reconocedor no ha devuelto texto.");
            return;
        }
        String transcript = words.get(0).trim();
        dictationInput.setText(transcript);
        dictationStatus.setText("Texto recibido del reconocedor del sistema. No es audio."
                + " No se ha enviado a Howdyknw.");
    }

    /** Share only the user-visible words, after another explicit tap. */
    private void shareTranscript() {
        if (running.get() || socket != null) {
            dictationStatus.setText("Detén primero la transmisión de audio PCM.");
            return;
        }
        if (!dictationConsent.isChecked()) {
            dictationStatus.setText("Confirma el consentimiento antes de compartir el texto.");
            return;
        }
        String transcript = dictationInput.getText().toString().trim();
        if (transcript.isEmpty() || transcript.length() > 1000) {
            dictationStatus.setText("Introduce entre 1 y 1000 caracteres antes de compartir.");
            return;
        }
        String room = roomInput.getText().toString().trim().toUpperCase(Locale.ROOT);
        if (!room.matches("[A-Z0-9]{8,16}")) {
            dictationStatus.setText("El código de sala debe tener entre 8 y 16 caracteres.");
            return;
        }
        String url = urlInput.getText().toString().trim();
        try {
            URI uri = URI.create(url);
            if (!"wss".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getUserInfo() != null || uri.getQuery() != null
                    || uri.getFragment() != null || (uri.getPath() != null
                    && !uri.getPath().isEmpty() && !"/".equals(uri.getPath()))) {
                dictationStatus.setText("Indica una URL WSS válida sin ruta ni parámetros.");
                return;
            }
        } catch (IllegalArgumentException ex) {
            dictationStatus.setText("La URL del servidor no es válida.");
            return;
        }
        if (transcriptSocket != null) {
            dictationStatus.setText("Ya se está compartiendo una transcripción.");
            return;
        }
        shareTranscriptButton.setEnabled(false);
        dictationStatus.setText("Conectando para compartir solo texto…");
        Request request;
        try {
            request = new Request.Builder().url(url).build();
        } catch (IllegalArgumentException ex) {
            shareTranscriptButton.setEnabled(true);
            dictationStatus.setText("Dirección WSS no válida.");
            return;
        }
        transcriptSocket = client.newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(WebSocket ws, Response response) {
                try {
                    JSONObject join = new JSONObject();
                    join.put("type", "join");
                    join.put("role", "source");
                    join.put("transport", "text");
                    join.put("room", room);
                    ws.send(join.toString());
                } catch (Exception ex) {
                    runOnUiThread(() -> closeTranscript(
                            "No se pudo entrar en la sala."));
                }
            }
            @Override public void onMessage(WebSocket ws, String data) {
                try {
                    JSONObject response = new JSONObject(data);
                    String type = response.optString("type");
                    if ("joined".equals(type)) {
                        JSONObject payload = new JSONObject();
                        payload.put("type", "transcript");
                        payload.put("text", transcript);
                        ws.send(payload.toString());
                    } else if ("transcript-sent".equals(type)) {
                        int listeners = response.optInt("listeners", 0);
                        runOnUiThread(() -> closeTranscript(
                                "Texto compartido con " + listeners
                                + " receptor(es). Esto no incluye audio."));
                    } else if ("error".equals(type)) {
                        runOnUiThread(() -> closeTranscript(
                                "Servidor: " + response.optString("message", "Error")));
                    }
                } catch (Exception ex) {
                    runOnUiThread(() -> closeTranscript(
                            "Respuesta de texto inválida."));
                }
            }
            @Override public void onFailure(WebSocket ws, Throwable error, Response response) {
                runOnUiThread(() -> {
                    if (transcriptSocket == ws) closeTranscript(
                            "No se pudo compartir el texto: " + error.getMessage());
                });
            }
            @Override public void onClosed(WebSocket ws, int code, String reason) {
                runOnUiThread(() -> {
                    if (transcriptSocket == ws) closeTranscript(
                            "Se cerró la sesión de texto sin confirmación.");
                });
            }
        });
    }

    private void closeTranscript(String message) {
        WebSocket old = transcriptSocket;
        transcriptSocket = null;
        if (old != null) old.close(1000, "Text share ended");
        shareTranscriptButton.setEnabled(true);
        dictationStatus.setText(message);
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
        viewerView.setText("Receptores conectados a la sala: 0");
        setStatus(message, false);
    }

    @Override protected void onPause() {
        super.onPause();
        if (transcriptSocket != null) closeTranscript(
                "Envío detenido: aplicación fuera de primer plano.");
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
