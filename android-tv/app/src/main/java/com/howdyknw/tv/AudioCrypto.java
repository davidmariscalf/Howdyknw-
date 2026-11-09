package com.howdyknw.tv;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * End-to-end AES-256-GCM encryption. Identical wire format to public/e2ee.js.
 * The separate audio secret NEVER travels over WebSocket, not even in "join".
 * 12 byte random nonce || AES-GCM(ciphertext[640] + tag[16]), Base64.
 */
public final class AudioCrypto {
    private static final int ITERATIONS = 150000;
    private static final int PCM_BYTES = 640;
    private static final int ENVELOPE_BYTES = 668;
    private static final SecureRandom RANDOM = new SecureRandom();

    private AudioCrypto() {}

    public static boolean validSecret(String secret) {
        return secret != null && secret.length() >= 16 && secret.length() <= 128;
    }

    public static String newSecret() {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        char[] alphabet = "0123456789ABCDEF".toCharArray();
        char[] output = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            output[i * 2] = alphabet[(bytes[i] & 0xff) >>> 4];
            output[i * 2 + 1] = alphabet[bytes[i] & 0x0f];
        }
        return new String(output);
    }

    public static SecretKey deriveKey(String secret, String room)
            throws GeneralSecurityException {
        if (!validSecret(secret) || room == null
                || !room.matches("[A-Z0-9]{8,16}")) {
            throw new GeneralSecurityException("Clave o código de sala inválidos");
        }
        char[] password = secret.toCharArray();
        byte[] salt = ("howdyknw-e2ee-v1|" + room).getBytes(StandardCharsets.UTF_8);
        PBEKeySpec spec = new PBEKeySpec(password, salt, ITERATIONS, 256);
        Arrays.fill(password, '\0');
        try {
            byte[] key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                    .generateSecret(spec).getEncoded();
            SecretKey result = new SecretKeySpec(key, "AES");
            Arrays.fill(key, (byte) 0);
            return result;
        } finally {
            spec.clearPassword();
        }
    }

    public static String encryptFrame(SecretKey key, byte[] frame)
            throws GeneralSecurityException {
        if (key == null || frame == null || frame.length != PCM_BYTES)
            throw new GeneralSecurityException("Trama PCM inválida");
        byte[] iv = new byte[12];
        RANDOM.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
        byte[] ciphertext = cipher.doFinal(frame);
        if (ciphertext.length != 656)
            throw new GeneralSecurityException("Tamaño de cifrado inesperado");
        byte[] envelope = new byte[ENVELOPE_BYTES];
        System.arraycopy(iv, 0, envelope, 0, iv.length);
        System.arraycopy(ciphertext, 0, envelope, 12, ciphertext.length);
        return Base64.getEncoder().encodeToString(envelope);
    }

    /**
     * V2 multimedia envelope with authenticated channel metadata.
     * Allowed kinds: voice, tv and screen. Audio frames are 640 bytes,
     * screen images may contain up to 90 KB compressed JPEG data.
     */
    public static String encryptMedia(SecretKey key, byte[] data, String kind)
            throws GeneralSecurityException {
        if (key == null || data == null || data.length < 1 || data.length > 90000
                || (!"voice".equals(kind) && !"tv".equals(kind)
                    && !"screen".equals(kind)))
            throw new GeneralSecurityException("Canal multimedia no válido");
        if (!"screen".equals(kind) && data.length != PCM_BYTES)
            throw new GeneralSecurityException("Trama de audio incorrecta");
        byte[] iv = new byte[12];
        RANDOM.nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
        cipher.updateAAD(("howdyknw-media-v2|" + kind).getBytes(StandardCharsets.UTF_8));
        byte[] encrypted = cipher.doFinal(data);
        byte[] envelope = new byte[12 + encrypted.length];
        System.arraycopy(iv, 0, envelope, 0, 12);
        System.arraycopy(encrypted, 0, envelope, 12, encrypted.length);
        return Base64.getEncoder().encodeToString(envelope);
    }

    public static byte[] decryptMedia(SecretKey key, String base64, String kind)
            throws GeneralSecurityException {
        if (key == null || base64 == null || base64.length() > 130000
                || !base64.matches("[A-Za-z0-9+/]+={0,2}")
                || (!"screen".equals(kind) && !"voice".equals(kind)
                    && !"tv".equals(kind)))
            throw new GeneralSecurityException("Sobre multimedia no válido");
        byte[] envelope = Base64.getDecoder().decode(base64);
        if (envelope.length < 29 || envelope.length > 90028)
            throw new GeneralSecurityException("Longitud multimedia inválida");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key,
                new GCMParameterSpec(128, Arrays.copyOfRange(envelope, 0, 12)));
        cipher.updateAAD(("howdyknw-media-v2|" + kind).getBytes(StandardCharsets.UTF_8));
        byte[] raw = cipher.doFinal(envelope, 12, envelope.length - 12);
        if (!"screen".equals(kind) && raw.length != PCM_BYTES)
            throw new GeneralSecurityException("PCM incorrecto");
        return raw;
    }

    public static byte[] decryptFrame(SecretKey key, String base64)
            throws GeneralSecurityException {
        if (key == null || base64 == null
                || !base64.matches("[A-Za-z0-9+/]{891}="))
            throw new GeneralSecurityException("Trama cifrada inválida");
        byte[] envelope = Base64.getDecoder().decode(base64);
        if (envelope.length != ENVELOPE_BYTES)
            throw new GeneralSecurityException("Tamaño de trama cifrada inválido");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key,
                new GCMParameterSpec(128, Arrays.copyOfRange(envelope, 0, 12)));
        byte[] raw = cipher.doFinal(envelope, 12, 656);
        if (raw.length != PCM_BYTES)
            throw new GeneralSecurityException("Tamaño PCM incorrecto");
        return raw;
    }
}
