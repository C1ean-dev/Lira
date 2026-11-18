# Protótipo GStreamer P2P

O apresentador usa GStreamer no Windows. Na captura real, a imagem passa da
captura D3D11 para a conversão NV12 e para o encoder H.264 AMD AMF. O
`webrtcsink` entrega o vídeo por WebRTC diretamente ao navegador do
espectador. A página HTTP e a sinalização WebSocket rodam no computador do
apresentador. O teste usa loopback ou LAN, com ICE local e sem STUN ou TURN.

Escopo do protótipo: vídeo, um espectador de teste e bitrate configurado no
encoder. A tela ou janela selecionada é a única fonte. O protótipo roda
separado do Lira, com GStreamer e Node no apresentador e Chrome ou Edge no
espectador. Áudio, salas do Lira, internet fora da LAN e adaptação automática
de bitrate ficam para uma etapa posterior.

## Preparar o apresentador

1. Instale o runtime **GStreamer MSVC x86_64 1.28.x** com os plugins, incluindo
   os Rust plugins. O encoder AMF depende de uma GPU AMD compatível e do
   driver correspondente.
   [Download oficial do GStreamer](https://gstreamer.freedesktop.org/download/#windows)
2. Na raiz do Lira, confira os elementos necessários:

   ```powershell
   node scripts/gstreamer-p2p/publish.mjs --check --source screen
   ```

   Se o comando não localizar o runtime, use `--gst-bin "C:\caminho\do\gstreamer\bin"`.
   A checagem indica o primeiro elemento indisponível. Com `amfh264enc`
   indisponível, o teste não inicia outro encoder automaticamente.

## Rodar

Para o primeiro teste, inicie apenas o padrão sintético. O alvo padrão é
**1920 × 1080, 60 FPS, 8 Mbps**.

```powershell
node scripts/gstreamer-p2p/publish.mjs
```

Abra no Chrome ou Edge o endereço que o terminal mostrar e clique em
**Conectar**. O esperado é aparecer a imagem sintética, H.264 e **P2P
direto (host / host)**. Use `Ctrl+C` no terminal do transmissor para encerrar.

Para testar o jogo de outro computador, use o IPv4 privado do apresentador
no exemplo abaixo. O monitor principal é o padrão. `--monitor 0` e
`--monitor 1` selecionam por índice. Rode em uma rede local em que você
confia, pois a página e a sinalização do protótipo não autenticam o espectador.

```powershell
node scripts/gstreamer-p2p/publish.mjs --source screen --host 192.168.1.25
```

O espectador abre o endereço impresso pelo transmissor. Se não conectar,
confira se ambos estão na mesma rede, se o firewall do Windows permite o
GStreamer na rede privada e se as portas TCP 8080 e 8443 estão disponíveis.
O WebRTC também precisa estabelecer o caminho direto de mídia entre os
dispositivos.

Para capturar só a janela do jogo, consulte seu `MainWindowHandle` e passe
esse valor em `--window-handle` junto de `--source screen`. Essa opção usa
Windows Graphics Capture. O modo monitor usa DXGI.

```powershell
Get-Process -Name NomeDoJogo | Select-Object ProcessName, MainWindowHandle
node scripts/gstreamer-p2p/publish.mjs --source screen --host 192.168.1.25 --window-handle 123456
```

Use `--bitrate-kbps 6000` ou `--bitrate-kbps 12000` para comparar outros
alvos, `--fps 30` para 30 FPS e `--resolution 720` para 720p. As portas
podem ser substituídas com `--port` e `--signal-port`.

## Como comparar

1. Capture o mesmo jogo com as duas soluções, em execuções separadas, com o
   mesmo espectador e a mesma rota. Use uma cena com movimento por 60 segundos
   e mantenha o vídeo do receptor visível durante a medição.
2. No receptor, compare **FPS exibido**, **tempo congelado** e **quadros
   descartados**. Compare também resolução e bitrate recebido. O FPS
   decodificado ajuda a distinguir problemas na entrega de problemas na
   apresentação. Observe também a nitidez e os blocos de compressão no movimento.
3. Clique em **Baixar métricas** para exportar até 600 amostras de aproximadamente
   um segundo. No apresentador, anote o uso de CPU e de **Video Encode** da GPU
   durante cada execução. No modo sintético, o bitrate recebido pode variar com
   a cena e a implementação do controle de taxa do encoder.

O painel lê os contadores de congelamento do WebRTC quando fornecidos pelo
navegador. O FPS exibido usa o contador de quadros enviados para composição
do player. Quando ele não está disponível, usa o total de quadros processados
menos os descartes. Campos indisponíveis aparecem como `—`.

Testes automatizados sem capturar tela ou abrir navegador:

```powershell
node --test scripts/gstreamer-p2p/prototype.test.mjs
```

[Captura D3D11](https://gstreamer.freedesktop.org/documentation/d3d11/d3d11screencapturesrc.html) ·
[Encoder AMD AMF](https://gstreamer.freedesktop.org/documentation/amfcodec/amfh264enc.html) ·
[`webrtcsink`](https://gstreamer.freedesktop.org/documentation/rswebrtc/webrtcsink.html)
