package com.jj.kartiseret

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Stores only AES-GCM ciphertext in app-private preferences. The key never leaves Android Keystore. */
class SessionStore(context: Context) {
    private val preferences = context.getSharedPreferences("kartiseret_secure_session", Context.MODE_PRIVATE)
    private val alias = "com.jj.kartiseret.session.${BuildConfig.APPLICATION_ID}"

    fun read(): String? = runCatching {
        val iv = preferences.getString("iv", null)?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return null
        val encrypted = preferences.getString("value", null)?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
        cipher.doFinal(encrypted).toString(Charsets.UTF_8).takeIf(String::isNotBlank)
    }.getOrElse { clear(); null }

    fun save(value: String) {
        require(value.isNotBlank())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        check(preferences.edit().putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP)).putString("value", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) { "Could not securely store the account session." }
    }

    @Suppress("ApplySharedPref") // Clear the bearer token synchronously before reporting the user as signed out.
    fun clear() {
        preferences.edit().clear().commit()
        runCatching { keyStore().deleteEntry(alias) }
    }

    private fun getOrCreateKey(): SecretKey {
        val store = keyStore()
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build())
        return generator.generateKey()
    }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
}
