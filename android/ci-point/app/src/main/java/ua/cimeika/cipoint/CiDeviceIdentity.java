package ua.cimeika.cipoint;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.Certificate;

final class CiDeviceIdentity {
    private static final String STORE = "AndroidKeyStore";
    private static final String ALIAS = "ci_device_identity_v1";

    private CiDeviceIdentity() { }

    static String keyId() {
        try {
            KeyStore keyStore = KeyStore.getInstance(STORE);
            keyStore.load(null);
            if (!keyStore.containsAlias(ALIAS)) {
                KeyPairGenerator generator = KeyPairGenerator.getInstance(
                        KeyProperties.KEY_ALGORITHM_EC,
                        STORE
                );
                generator.initialize(new KeyGenParameterSpec.Builder(
                        ALIAS,
                        KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY
                ).setDigests(KeyProperties.DIGEST_SHA256).build());
                generator.generateKeyPair();
                keyStore.load(null);
            }
            Certificate certificate = keyStore.getCertificate(ALIAS);
            if (certificate == null) return "";
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(certificate.getPublicKey().getEncoded());
            StringBuilder value = new StringBuilder("ci-key-");
            for (int i = 0; i < 12 && i < digest.length; i++) {
                value.append(String.format(java.util.Locale.ROOT, "%02x", digest[i] & 0xff));
            }
            return value.toString();
        } catch (Exception ignored) {
            return "";
        }
    }
}
