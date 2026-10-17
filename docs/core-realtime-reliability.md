# Regressões de call, conexão e compartilhamento

Os testes de regressão usam os gerenciadores reais de mídia e conexão. Os testes
unitários controlam dispositivos, relógios e transportes para provocar falhas;
o teste de navegador estabelece WebRTC real entre dois contextos independentes,
com sinalização PeerJS local e áudio/vídeo sintéticos.

## Executar

Requer Node.js 22 ou posterior e `npm ci`.

```sh
npm test
npm run test:core
```

O AGENTS.md exige consultar o usuário antes de usar navegador. Após autorização:

```sh
npx playwright install chromium
npm run test:core:browser
```

Para usar Chrome já instalado no Windows, configure
`LIRA_CHROMIUM_EXECUTABLE` com o caminho do executável. O teste inicia e encerra
seus próprios servidores locais, sem microfone ou captura de tela reais. A opção
`--test-force-exit` encerra também os temporizadores internos do servidor PeerJS,
que não disponibiliza uma API pública para pará-los. Executar o arquivo Node
diretamente sem `LIRA_RUN_BROWSER_TESTS=1` apenas o marca como ignorado.

## Cobertura dos cenários

| Cenário | Teste |
| --- | --- |
| Entrada de anfitrião e participante, áudio e câmera nos dois sentidos | Navegador: conexão real e contadores RTP |
| Compartilhar tela e continuar falando | Navegador: vídeo decodificado em 640×360 e sinais de áudio recebidos nas duas chamadas |
| Silenciar/desmutar microfone sem silenciar a transmissão | Navegador: mede separadamente o sinal recebido de voz e da tela |
| Perder sinalização com a call ativa | Navegador: reconecta a mesma sessão e preserva a chamada; unitário: ID público nulo do PeerJS |
| Reconexão sem resposta do servidor | Unitário: watchdog, atraso progressivo e limite de tentativas |
| Sinalização volta depois de esgotar tentativas de mídia | Unitário: retoma chamadas falhas e voz auxiliar sem recriar chamadas estabelecidas |
| Call fechada inesperadamente | Navegador: restabelece uma chamada nova; unitário: atualizações de jogador respeitam o atraso e limite |
| Voz auxiliar fechada, com erro ou negociação travada | Unitário: recuperação limitada e cancelamento ao sair/parar/trocar sessão |
| Parar compartilhamento | Navegador: restaura câmera 320×240, áudio do microfone e remove a call auxiliar |
| Sair da sala | Navegador: remove participante e chamada do anfitrião |
| Captura atrasada depois de cancelar/parar | Unitário: libera faixas e contexto de áudio, sem reativar compartilhamento |
| Trocas de fonte fora de ordem e recuperação atrasada | Unitário: mantém a fonte mais recente e libera capturas antigas |
| Cancelar seleção de uma nova fonte | Unitário: preserva a transmissão anterior e seu tratamento de encerramento |
| Sequências de iniciar/parar/resolver captura | Unitário: 12 sementes, 60 eventos por sequência, sem encerrar o microfone |

O workflow `core-realtime.yml` executa toda a suíte e o teste de navegador em
Windows e Linux a cada push/PR. O workflow de release também exige ambos antes
de gerar o pacote. Esses arquivos ficam ativos quando a branch for enviada ao
GitHub; não configuram proteção de branch no servidor.

## Limites da evidência

O teste de navegador importa os módulos de produção, sem percorrer a interface
completa. Ele comprova transporte, decodificação e áudio em duas sessões locais;
não exercita o seletor nativo do Windows, captura de áudio por processo, drivers,
dispositivos físicos nem redes externas/NAT. Os testes existentes desses caminhos
com dispositivos simulados continuam na suíte. A conectividade em redes que
bloqueiam caminhos diretos depende de TURN válido; veja `call-relays.md`.

Uma suíte aprovada protege os cenários descritos. Não é uma garantia de ausência
de falhas em todos os computadores e redes.

## Verificação local de 17/10/2026

- Windows, Node.js 24.20.0, Chrome instalado e Playwright 1.64.1.
- Suíte completa consolidada: 253 arquivos, 2.588 testes aprovados, zero falhas e quatro
  variações condicionais de cursor ignoradas. Execução final com
  `npx vitest run src/__tests__ --maxWorkers=4` e relatório JSON.
- 44 novos testes de regressão de captura, call, voz e sinalização aprovados.
- Quatro execuções finais do cenário de navegador aprovadas com o mesmo código
  de produção. A última também usa um prazo de conexão de 60 segundos, cobrindo
  as quatro janelas de negociação de 12 segundos e seus intervalos de recuperação.
- O cenário verifica áudio e vídeo nos dois sentidos, tela decodificada, voz e
  áudio da transmissão independentes, mute, reconexão, restauração da câmera,
  recuperação de call fechada e saída da sala.
