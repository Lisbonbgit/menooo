package com.menooo.cozinha

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Ponte de impressão entre o painel (WebView remota) e a térmica da LAN.
 *
 * O contrato está fixado do lado web em
 * apps/dashboard/src/lib/kitchen-printer.ts — não mudar aqui sem lá mexer, e
 * sem incrementar o INTERFACE_VERSION.
 *
 * Fino de propósito: a lógica toda (fila, sockets, timeouts) está no
 * PrinterClient, que é Kotlin puro e testado na JVM.
 */
@CapacitorPlugin(name = "KitchenPrinter")
class KitchenPrinterPlugin : Plugin() {

    companion object {
        /**
         * Versão da INTERFACE do plugin, não da app.
         *
         * O web usa-a para feature-detetar antes de mandar argumentos novos: sem
         * ela, um APK antigo responde isPluginAvailable=true, aceita a chamada, e
         * o Kotlin ignora o argumento novo em silêncio — o talão sai errado e
         * ninguém percebe porquê. Incrementar sempre que uma assinatura mudar.
         */
        private const val INTERFACE_VERSION = 1
    }

    @PluginMethod
    fun getVersion(call: PluginCall) {
        call.resolve(JSObject().put("version", INTERFACE_VERSION))
    }

    @PluginMethod
    fun print(call: PluginCall) {
        val ip = call.getString("ip")
        val dataBase64 = call.getString("dataBase64")
        val port = call.getInt("port") ?: 9100

        if (ip.isNullOrBlank()) {
            call.reject("Falta o IP da impressora.")
            return
        }
        if (dataBase64.isNullOrBlank()) {
            call.reject("Talão vazio.")
            return
        }

        val bytes = try {
            Base64.decode(dataBase64, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            call.reject("Talão corrompido (base64 inválido).")
            return
        }

        // O Capacitor chama os @PluginMethod fora da main thread, e o
        // PrinterClient serializa por dentro — bloquear aqui é seguro.
        try {
            PrinterClient.print(ip, port, bytes)
            call.resolve()
        } catch (e: PrinterException) {
            // O `code` deixa o web distinguir rede de impressora sem ler a frase.
            call.reject(e.message, e.kind.name)
        }
    }
}
