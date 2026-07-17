package com.menooo.cozinha

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.ServerSocket
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * Duas propriedades, testadas separadamente de propósito:
 *
 *  - A FILA serializa (nunca dois envios ao mesmo tempo) — com um duplo do
 *    envio, porque através de um ServerSocket isto não é observável sem
 *    corridas: o cliente fecha o socket e sai antes de o servidor medir.
 *  - O SOCKET envia os bytes tal e qual e distingue as falhas — contra um
 *    ServerSocket a sério.
 *
 * Nada disto prova que uma térmica real interpreta os bytes. Isso precisa da
 * impressora.
 */
class PrinterClientTest {

    @After
    fun reporSender() {
        PrinterClient.sender = PrinterClient::enviar
    }

    // ---------- a fila ----------

    @Test
    fun `a fila serializa - nunca dois envios ao mesmo tempo`() {
        val emCurso = AtomicInteger(0)
        val maxSimultaneos = AtomicInteger(0)
        PrinterClient.sender = { _, _, _ ->
            val agora = emCurso.incrementAndGet()
            maxSimultaneos.updateAndGet { m -> maxOf(m, agora) }
            Thread.sleep(60)
            emCurso.decrementAndGet()
        }

        val threads = (1..5).map { i ->
            thread { PrinterClient.print("127.0.0.1", 9100, byteArrayOf(i.toByte())) }
        }
        threads.forEach { it.join(15_000) }

        assertEquals(
            "a maioria das termicas so aceita UMA ligacao — dois envios ao mesmo tempo = talao perdido",
            1,
            maxSimultaneos.get(),
        )
    }

    @Test
    fun `a fila propaga o erro a quem chamou`() {
        PrinterClient.sender = { _, _, _ ->
            throw PrinterException(PrinterException.Kind.REFUSED, "recusado de propósito")
        }
        try {
            PrinterClient.print("127.0.0.1", 9100, byteArrayOf(1))
            fail("o erro tem de chegar a quem chamou, senao a falha e engolida")
        } catch (e: PrinterException) {
            assertEquals(PrinterException.Kind.REFUSED, e.kind)
        }
    }

    // ---------- o socket ----------

    @Test
    fun `envia os bytes tal e qual para a impressora`() {
        val recebidos = Collections.synchronizedList(mutableListOf<ByteArray>())
        val latch = CountDownLatch(1)
        val server = ServerSocket(0)
        thread(isDaemon = true) {
            try {
                server.accept().use { s ->
                    recebidos.add(s.getInputStream().readBytes())
                    latch.countDown()
                }
            } catch (e: Exception) {
                // servidor fechado no fim do teste
            }
        }

        val payload = byteArrayOf(0x1B, 0x40, 'O'.code.toByte(), 'K'.code.toByte(), 0x0A)
        PrinterClient.print("127.0.0.1", server.localPort, payload)

        assertTrue("a impressora falsa nunca recebeu nada", latch.await(5, TimeUnit.SECONDS))
        assertEquals(1, recebidos.size)
        assertArrayEquals(payload, recebidos[0])
        server.close()
    }

    @Test
    fun `porta fechada da erro REFUSED, nao TIMEOUT`() {
        // Porta que esteve aberta e fechou: garantidamente ninguém a escuta.
        val portaLivre = ServerSocket(0).let { val p = it.localPort; it.close(); p }
        try {
            PrinterClient.print("127.0.0.1", portaLivre, byteArrayOf(1))
            fail("devia ter lancado PrinterException")
        } catch (e: PrinterException) {
            assertEquals(PrinterException.Kind.REFUSED, e.kind)
            assertTrue("a mensagem tem de dizer o que fazer", e.message!!.contains("Confirma o IP"))
        }
    }

    @Test
    fun `talao vazio nao rebenta`() {
        val latch = CountDownLatch(1)
        val server = ServerSocket(0)
        thread(isDaemon = true) {
            try {
                server.accept().use { it.getInputStream().readBytes(); latch.countDown() }
            } catch (e: Exception) {
                // fim do teste
            }
        }

        PrinterClient.print("127.0.0.1", server.localPort, ByteArray(0))

        assertTrue(latch.await(5, TimeUnit.SECONDS))
        server.close()
    }
}
