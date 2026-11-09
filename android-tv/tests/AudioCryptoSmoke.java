package com.howdyknw.tv;

import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** JVM-only crypto compatibility test, runs without Android hardware. */
public final class AudioCryptoSmoke {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
    private static String hex(byte[] bytes) {
        char[] chars = "0123456789abcdef".toCharArray();
        StringBuilder out = new StringBuilder();
        for (byte value : bytes) {
            out.append(chars[(value & 255) >>> 4]);
            out.append(chars[value & 15]);
        }
        return out.toString();
    }
    public static void main(String[] args) throws Exception {
        String secret = "MY-SEPARATE-VOICE-SECRET";
        String room = "TESTRM123456";
        SecretKey key = AudioCrypto.deriveKey(secret, room);
        check(hex(key.getEncoded()).equals(
            "0cbc040ba0377736241dcf0b3c72ff7909028ace6040431f25373ca00a6efb87"
        ), "PBKDF2 incompatibility with independent Python AES-GCM vector");
        byte[] frame = new byte[640];
        for (int i=0;i<frame.length;i++) frame[i]=(byte)i;
        byte[] iv = new byte[12];
        for (int i=0;i<12;i++) iv[i]=(byte)i;
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,key,new GCMParameterSpec(128,iv));
        byte[] encrypted=cipher.doFinal(frame);
        byte[] envelope=new byte[668];
        System.arraycopy(iv,0,envelope,0,12);
        System.arraycopy(encrypted,0,envelope,12,encrypted.length);
        check(hex(MessageDigest.getInstance("SHA-256").digest(envelope)).equals(
            "cc1ff75d9926da82963446ad0a0cb4aab60ab874308e7fdd02b7fe1722fff766"
        ), "AES-GCM frame incompatible with independent Python vector");
        check(Arrays.equals(AudioCrypto.decryptFrame(key,Base64.getEncoder().encodeToString(envelope)),frame),
            "Cannot decode encrypted reference frame");
        String transmitted=AudioCrypto.encryptFrame(key,frame);
        check(transmitted.length()==892,"Unexpected packet size");
        check(Arrays.equals(AudioCrypto.decryptFrame(key,transmitted),frame),"Roundtrip failed");
        try {
            AudioCrypto.decryptFrame(AudioCrypto.deriveKey("A-WRONG-AUDIO-SECRET",room),transmitted);
            throw new AssertionError("Tampered key must fail");
        }catch(javax.crypto.AEADBadTagException expected){}
        byte[] tvAudio=new byte[640];
        Arrays.fill(tvAudio,(byte)55);
        String voicePacket=AudioCrypto.encryptMedia(key,frame,"voice");
        String tvPacket=AudioCrypto.encryptMedia(key,tvAudio,"tv");
        byte[] screenData=new byte[]{(byte)255,(byte)216,1,2,3,(byte)255,(byte)217};
        String screenPacket=AudioCrypto.encryptMedia(key,screenData,"screen");
        check(Arrays.equals(AudioCrypto.decryptMedia(key,voicePacket,"voice"),frame),
            "Microphone E2EE failed");
        check(Arrays.equals(AudioCrypto.decryptMedia(key,tvPacket,"tv"),tvAudio),
            "TV playback E2EE failed");
        check(Arrays.equals(AudioCrypto.decryptMedia(key,screenPacket,"screen"),screenData),
            "Screen JPEG encryption failed");
        try{
            AudioCrypto.decryptMedia(key,tvPacket,"voice");
            throw new AssertionError("The TV channel must never be mistaken for speech");
        }catch(javax.crypto.AEADBadTagException expected){}
        String fresh=AudioCrypto.newSecret();
        check(fresh.matches("[0-9A-F]{32}"),"Weak/invalid generated secret");
        System.out.println("AudioCrypto: interoperable reference vectors and failure tests PASSED");
    }
}
