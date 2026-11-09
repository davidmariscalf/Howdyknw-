package com.howdyknw.tv;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.*;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.*;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import javax.crypto.SecretKey;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * User-approved foreground screen-share session.
 * MediaProjection must be granted freshly by the TV's system UI.
 * No recording to disk, silent startup, or bypass of protected content.
 * Separate streams: microphone ("voice") and allowed application playback ("tv").
 */
public final class ScreenShareService extends Service {
    static final String ACTION_START = "com.howdyknw.tv.SHARE_START";
    static final String ACTION_STOP = "com.howdyknw.tv.SHARE_STOP";
    static final String EXTRA_RESULT = "projectionResult";
    static final String EXTRA_DATA = "projectionData";
    static final String EXTRA_URL = "serverUrl";
    static final String EXTRA_ROOM = "roomCode";
    static final String EXTRA_SECRET = "audioSecret";
    private static final String CHANNEL_ID = "howdyknw_screenshare";
    private static final int NOTIFICATION_ID = 409;
    private static final int WIDTH = 640;
    private static final int HEIGHT = 360;
    private static final int FRAME_BYTES = 640;
    private static final int SAMPLE_RATE = 16000;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicInteger listeners = new AtomicInteger(0);
    private final AtomicBoolean closing = new AtomicBoolean(false);

    private OkHttpClient client;
    private WebSocket socket;
    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader reader;
    private HandlerThread imageThread;
    private AudioRecord micRecorder;
    private AudioRecord tvRecorder;
    private Thread micThread;
    private Thread tvThread;
    private SecretKey key;
    private long previousImageTime;
    private String lastStatus = "Iniciando emisión autorizada";

    @Override public void onCreate() {
        super.onCreate();
        client = new OkHttpClient.Builder().pingInterval(20,TimeUnit.SECONDS).build();
        NotificationManager manager =
                (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel(
                CHANNEL_ID,"Howdyknw: pantalla y audio",NotificationManager.IMPORTANCE_LOW));
    }

    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if (intent==null || ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(intent.getAction()) || running.get() || closing.get())
            return START_NOT_STICKY;

        // Foreground projection and microphone are explicitly user initiated.
        try {
            int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION |
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            startForeground(NOTIFICATION_ID,notification("Permiso concedido. Preparando captura…"),types);
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        int result=intent.getIntExtra(EXTRA_RESULT,Activity.RESULT_CANCELED);
        Intent data;
        if (Build.VERSION.SDK_INT>=33)
            data=intent.getParcelableExtra(EXTRA_DATA,Intent.class);
        else data=intent.getParcelableExtra(EXTRA_DATA);
        final String url=intent.getStringExtra(EXTRA_URL);
        final String room=intent.getStringExtra(EXTRA_ROOM);
        final String secret=intent.getStringExtra(EXTRA_SECRET);
        if (result!=Activity.RESULT_OK || data==null ||url==null ||room==null ||
                secret==null ||checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED) {
            stopSelf();
            return START_NOT_STICKY;
        }
        running.set(true);
        new Thread(()->startSession(result,data,url,room,secret),"howdy-screen-start").start();
        return START_NOT_STICKY;
    }

    private Notification notification(String text) {
        Intent stopIntent=new Intent(this,ScreenShareService.class).setAction(ACTION_STOP);
        int flag=PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent stop=PendingIntent.getService(this,1,stopIntent,flag);
        return new Notification.Builder(this,CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setContentTitle("Howdyknw · compartiendo pantalla y audio")
                .setContentText(text)
                .setOngoing(true)
                .addAction(android.R.drawable.ic_media_pause,"DETENER AHORA",stop)
                .build();
    }

    private void updateStatus(String status){
        lastStatus=status;
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE))
                .notify(NOTIFICATION_ID,notification(status));
        try {
            WebSocket ws=socket;
            if(ws!=null &&running.get()){
                JSONObject message=new JSONObject();
                message.put("type","media-status");
                message.put("text",status.length()>180?status.substring(0,180):status);
                ws.send(message.toString());
            }
        }catch(Exception ignored){}
    }

    private void startSession(int result,Intent data,String url,String room,String secret) {
        try {
            key=AudioCrypto.deriveKey(secret,room);
            // Explicit consent + notification must precede getMediaProjection.
            MediaProjectionManager manager=(MediaProjectionManager)
                    getSystemService(MEDIA_PROJECTION_SERVICE);
            projection=manager.getMediaProjection(result,data);
            if(projection==null)throw new IllegalStateException("MediaProjection no disponible");
            imageThread=new HandlerThread("howdy-screen-capture");
            imageThread.start();
            Handler handler=new Handler(imageThread.getLooper());
            projection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop(){stopSelf();}
            },handler);
            reader=ImageReader.newInstance(WIDTH,HEIGHT,PixelFormat.RGBA_8888,2);
            reader.setOnImageAvailableListener(this::handleImage,handler);
            // On Android 14+, call createVirtualDisplay only once per user consent.
            virtualDisplay=projection.createVirtualDisplay(
                    "Howdyknw authorized share",WIDTH,HEIGHT,
                    getResources().getDisplayMetrics().densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    reader.getSurface(),null,handler);
            if(virtualDisplay==null)throw new IllegalStateException("La TV bloqueó pantalla compartida");
            Request request=new Request.Builder().url(url).build();
            socket=client.newWebSocket(request,new WebSocketListener(){
                @Override public void onOpen(WebSocket ws,Response response){
                    try {
                        JSONObject join=new JSONObject();
                        join.put("type","join");join.put("role","source");
                        join.put("transport","pcm-e2ee");join.put("room",room);
                        ws.send(join.toString());
                    }catch(Exception e){stopSelf();}
                }
                @Override public void onMessage(WebSocket ws,String raw){
                    try {
                        JSONObject m=new JSONObject(raw);
                        String type=m.optString("type");
                        if("joined".equals(type)){
                            listeners.set(m.optInt("listenerCount",0));
                            startAudio();
                            updateStatus("Pantalla autorizada · audio TV y micrófono separados");
                        }else if("listener-count".equals(type)){
                            int count=Math.max(0,Math.min(4,m.optInt("count")));
                            listeners.set(count);
                            updateStatus(count>0?
                                "Compartiendo con "+count+" receptor(es). Toca DETENER.":
                                "Captura autorizada · sin oyentes · no se envían imágenes ni sonido");
                        }else if("error".equals(type)){
                            updateStatus("Servidor rechazó conexión: "+m.optString("message"));
                            stopSelf();
                        }
                    }catch(Exception e){stopSelf();}
                }
                @Override public void onFailure(WebSocket ws,Throwable t,Response r){
                    updateStatus("Conexión WSS perdida. Captura detenida.");
                    stopSelf();
                }
                @Override public void onClosed(WebSocket ws,int code,String reason){
                    stopSelf();
                }
            });
        } catch(Exception e) {
            updateStatus("Error de captura: "+e.getClass().getSimpleName());
            stopSelf();
        }
    }

    private void handleImage(ImageReader source) {
        Image img=null;
        try {
            img=source.acquireLatestImage();
            if(img==null)return;
            long now=System.currentTimeMillis();
            WebSocket ws=socket;
            if(!running.get() ||listeners.get()==0 ||ws==null ||
                    ws.queueSize()>140000 ||now-previousImageTime<1000)return;
            previousImageTime=now;
            Image.Plane plane=img.getPlanes()[0];
            int pixelStride=plane.getPixelStride(),rowStride=plane.getRowStride();
            if(pixelStride!=4 ||rowStride < WIDTH*4)return;
            // Row padding is normal for ImageReader RGBA frames.
            Bitmap full=Bitmap.createBitmap(rowStride/pixelStride,HEIGHT,Bitmap.Config.ARGB_8888);
            full.copyPixelsFromBuffer(plane.getBuffer());
            Bitmap cropped=Bitmap.createBitmap(full,0,0,WIDTH,HEIGHT);
            ByteArrayOutputStream jpeg=new ByteArrayOutputStream(35000);
            cropped.compress(Bitmap.CompressFormat.JPEG,48,jpeg);
            cropped.recycle();full.recycle();
            byte[] bytes=jpeg.toByteArray();
            if(bytes.length>85000)return; // Bounded encrypted preview.
            sendMedia(ws,"screen-frame",null,bytes,"screen");
        }catch(Exception ignored){
            // Unsupported capture or DRM content can be black/empty; never bypass.
        }finally{
            if(img!=null)img.close();
        }
    }

    private synchronized void startAudio() {
        if(!running.get()||micThread!=null)return;
        // Separately capture public playback audio (only apps that allow capture).
        if(Build.VERSION.SDK_INT>=29){
            try {
                AudioPlaybackCaptureConfiguration config=
                    new AudioPlaybackCaptureConfiguration.Builder(projection)
                        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                        .addMatchingUsage(AudioAttributes.USAGE_GAME)
                        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                        .build();
                AudioFormat format=new AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_IN_MONO).build();
                int min=AudioRecord.getMinBufferSize(SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
                tvRecorder=new AudioRecord.Builder()
                        .setAudioPlaybackCaptureConfig(config)
                        .setAudioFormat(format).setBufferSizeInBytes(Math.max(min,5120)).build();
                tvRecorder.startRecording();
                if(tvRecorder.getRecordingState()==AudioRecord.RECORDSTATE_RECORDING){
                    final AudioRecord input=tvRecorder;
                    tvThread=new Thread(()->audioLoop(input,"tv"),"howdy-tv-playback");
                    tvThread.start();
                }else{
                    tvRecorder.release();tvRecorder=null;
                }
            }catch(Exception e){
                if(tvRecorder!=null){try{tvRecorder.release();}catch(Exception ignored){}}
                tvRecorder=null;
                updateStatus("Audio TV no capturable. Se mantiene pantalla y se probará micrófono.");
            }
        }
        try {
            MicRecovery.Result result=MicRecovery.open(SAMPLE_RATE,FRAME_BYTES,0);
            if(result.recorder!=null){
                micRecorder=result.recorder;
                final AudioRecord input=micRecorder;
                micThread=new Thread(()->audioLoop(input,"voice"),"howdy-microphone");
                micThread.start();
            }else updateStatus("Micrófono restringido; solo pantalla y reproducción autorizada.");
        }catch(Exception ignored){
            updateStatus("No se pudo iniciar el canal de voz.");
        }
    }

    private void audioLoop(AudioRecord input,String kind) {
        byte[] frame=new byte[FRAME_BYTES];
        int position=0;
        while(running.get()){
            int n;
            try{n=input.read(frame,position,FRAME_BYTES-position,AudioRecord.READ_BLOCKING);}
            catch(Exception e){break;}
            if(n<=0)break;
            position+=n;
            if(position<FRAME_BYTES)continue;
            position=0;
            if(listeners.get()==0)continue;
            WebSocket ws=socket;
            if(ws==null||ws.queueSize()>250000)continue;
            // Captured playback and microphone samples never share a channel.
            sendMedia(ws,"media-frame",kind,frame,kind);
        }
    }

    private void sendMedia(WebSocket ws,String type,String channel,byte[] bytes,String kind){
        try{
            String payload=AudioCrypto.encryptMedia(key,bytes,kind);
            JSONObject message=new JSONObject();
            message.put("type",type);
            if(channel!=null)message.put("channel",channel);
            message.put("data",payload);
            if(running.get()&&listeners.get()>0&&ws.queueSize()<280000)
                ws.send(message.toString());
        }catch(Exception ignored){}
    }

    @Override public android.os.IBinder onBind(Intent intent){return null;}

    @Override public void onDestroy(){
        running.set(false);
        listeners.set(0);
        if(!closing.compareAndSet(false,true)){super.onDestroy();return;}
        if(socket!=null){socket.close(1000,"Captura finalizada");socket=null;}
        for(AudioRecord record:new AudioRecord[]{micRecorder,tvRecorder}){
            if(record!=null){
                try{record.stop();}catch(Exception ignored){}
                try{record.release();}catch(Exception ignored){}
            }
        }
        micRecorder=null;tvRecorder=null;
        if(reader!=null){reader.setOnImageAvailableListener(null,null);reader.close();reader=null;}
        if(virtualDisplay!=null){virtualDisplay.release();virtualDisplay=null;}
        if(projection!=null){projection.stop();projection=null;}
        if(imageThread!=null){imageThread.quitSafely();imageThread=null;}
        if(client!=null){client.dispatcher().executorService().shutdown();
            client.connectionPool().evictAll();}
        key=null;
        super.onDestroy();
    }
}
