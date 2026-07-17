package com.menooo.cozinha

import java.io.IOException
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors

/**
 * Falha de impressão com a causa distinguida.
 *
 * A distinção não é cosmética: TIMEOUT quer dizer "a impressora não está
 * alcançável" (subrede errada, isolamento de clientes no WiFi) e REFUSED quer
 * dizer "está alcançável mas nada escuta nessa porta" (IP certo, porta errada,
 * ou impressora desligada). A acção do utilizador é diferente em cada caso.
 */
class PrinterException(val kind: Kind, message: String) : Exception(message) {
    enum class Kind { TIMEOUT, REFUSED, IO }
}

/**
 * Envia ESC/POS cru para uma térmica TCP/IP (porta 9100).
 *
 * Kotlin puro de propósito: nem uma dependência Android, para poder ser testado
 * na JVM contra um ServerSocket local (ver PrinterClientTest). A cola do
 * Capacitor vive no KitchenPrinterPlugin, que é fino e não tem lógica.
 */
object PrinterClient {
    private const val CONNECT_TIMEOUT_MS = 4_000
    private const val READ_TIMEOUT_MS = 4_000

    /**
     * Uma única thread = um único socket de cada vez.
     *
     * A maioria das térmicas só aceita UMA ligação. Duas encomendas ao mesmo
     * tempo abririam dois sockets e um dos talões perdia-se em silêncio. Não se
     * pode confiar na ordem nem na concorrência das chamadas vindas do JS.
     */
    private val fila = Executors.newSingleThreadExecutor { r ->
        Thread(r, "menooo-printer").apply { isDaemon = true }
    }

    /**
     * Costura de teste: quem faz o envio de facto.
     *
     * Existe porque a serialização não é observável através de um ServerSocket
     * sem corridas — o cliente fecha o socket e vai-se embora antes de o
     * servidor conseguir medir o que quer que seja. Com isto, o teste da FILA
     * troca o envio por um duplo determinístico, e o teste do SOCKET usa o
     * envio real. Duas propriedades, dois testes, zero adivinhação.
     */
    internal var sender: (String, Int, ByteArray) -> Unit = ::enviar

    @Throws(PrinterException::class)
    fun print(ip: String, port: Int, bytes: ByteArray) {
        try {
            fila.submit(Callable { sender(ip, port, bytes) }).get()
        } catch (e: ExecutionException) {
            throw (e.cause as? PrinterException)
                ?: PrinterException(
                    PrinterException.Kind.IO,
                    e.cause?.message ?: "Erro de impressão.",
                )
        } catch (e: InterruptedException) {
            // O .get() também lança isto. Sem o apanhar, saía cru: o
            // KitchenPrinterPlugin só apanha PrinterException, o web ficava sem o
            // code TIMEOUT/REFUSED, e a flag de interrupção ficava engolida.
            Thread.currentThread().interrupt()
            throw PrinterException(
                PrinterException.Kind.IO,
                "Impressão interrompida antes de terminar.",
            )
        }
    }

    /** Envio real. `internal` só para o teste o poder repor depois de o trocar. */
    internal fun enviar(ip: String, port: Int, bytes: ByteArray) {
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(ip, port), CONNECT_TIMEOUT_MS)
                socket.soTimeout = READ_TIMEOUT_MS
                // Dar tempo ao FIN de levar os últimos bytes: fechar a seco corta
                // talões a meio em algumas térmicas.
                socket.setSoLinger(true, 2)
                socket.getOutputStream().apply {
                    write(bytes)
                    flush()
                }
            }
        } catch (e: SocketTimeoutException) {
            throw PrinterException(
                PrinterException.Kind.TIMEOUT,
                "A impressora não respondeu em $ip:$port. Confirma que está ligada e na mesma rede do tablet.",
            )
        } catch (e: ConnectException) {
            throw PrinterException(
                PrinterException.Kind.REFUSED,
                "Ligação recusada por $ip:$port. Confirma o IP e a porta da impressora.",
            )
        } catch (e: IOException) {
            throw PrinterException(
                PrinterException.Kind.IO,
                e.message ?: "Não foi possível imprimir em $ip:$port.",
            )
        }
    }
}
