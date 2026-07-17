package com.menooo.cozinha

import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // OBRIGATÓRIO antes do super.onCreate().
        //
        // O KitchenPrinter é uma classe LOCAL deste projeto, não um pacote npm,
        // logo nunca entra no capacitor.plugins.json (que o `cap sync` regenera
        // por inteiro a partir das dependências). O super.onCreate() é quem cria
        // o bridge: registar depois dele deixa Capacitor.Plugins.KitchenPrinter
        // a undefined. A app instala, arranca e parece bem — e só falha no
        // primeiro talão, que é o pior sítio para descobrir isto.
        registerPlugin(KitchenPrinterPlugin::class.java)
        super.onCreate(savedInstanceState)

        // A fila de encomendas não pode adormecer no balcão.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
