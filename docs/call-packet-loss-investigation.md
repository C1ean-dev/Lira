# Perda de pacotes e atraso na chamada de 10/11/2026

## Evidências

O Lira instalado estava na versão 1.1.206. Os logs locais confirmaram perda real
no áudio recebido por uma rota direta UDP. Em uma janela de dez segundos,
`packetsReceived` aumentou de 6638 para 6904 e `packetsLost` de 5358 para 5593.
Isso corresponde a 235 pacotes perdidos entre 501 esperados, ou 46,9%, com RTT
próximo de 30 ms. O teste de velocidade apresentado não mede essa rota entre os
participantes.

A comparação foi feita em uma instância local separada, com autorização para
compilar e testar na sala. Foram mantidos os contadores e a indicação de rota
do WebRTC, sem esconder a perda no indicador.

| Rota observada | Resultado observado |
| --- | --- |
| Direta UDP | Janelas próximas de 50% de perda |
| Cloudflare TURN por UDP | Aproximadamente 10% de perda nas janelas comparadas |
| Cloudflare TURN por TCP | Nenhum pacote perdido nas amostras coletadas |

A compilação final também detectou perda sustentada sozinha. Às 23:12:37 UTC,
registrou `redial-relay` após uma janela de 51% de perda. A nova chamada passou
a usar uma candidata `relay` com `relayProtocol: tls`, recebendo 8496 pacotes sem
perda durante aproximadamente três minutos. O campo `protocol: udp` da candidata não identifica sozinho
o transporte entre o cliente e o serviço TURN.

Os resultados comprovam uma diferença entre as rotas medidas. Não identificam
qual roteador, operadora ou equipamento provoca o descarte. TCP/TLS pode trazer
espera por retransmissões, e ausência de perda RTP não garante ausência de atraso
ou de ocultação de áudio pelo buffer interno do WebRTC.

A direção de envio ainda apresentou perda residual informada pelo outro lado,
com frações recentes entre aproximadamente 7% e 12%. O RTT do relay também
oscilou. A melhora observada no recebimento não significa que toda a chamada ou
todos os participantes ficaram sem perda ou sem atraso. É necessário distribuir
a correção e comparar as duas pontas atualizadas para concluir essa verificação.

## Alterações

- O buffer de voz passa a responder ao jitter, preservando o piso de 40 ms. A
  perda isolada deixa de acrescentar até 500 ms ao alvo de reprodução.
- Cada relatório RTP mantém sua própria amostra anterior. Uma conexão nova não
  reutiliza os contadores da chamada anterior. O ping vem da rota selecionada.
- O monitor evita consultas simultâneas e continua medindo qualidade no modo de
  buffer manual, sem alterar o atraso escolhido pelo usuário.
- A recuperação por perda sustentada também cobre o lado que recebeu a chamada.
  Esse lado prepara a próxima negociação normal com TURN, sem exigir que um
  cliente anterior aceite uma oferta de reinício com os papéis invertidos.
- Nessas tentativas de recuperação, TCP/TLS é usado quando o provedor oferece
  essas opções. Provedores somente UDP continuam utilizáveis. A negociação
  inicial saudável mantém sua preferência existente por conexão direta.
- A preferência temporária por relay fica restrita ao participante afetado e
  deixa de ser aplicada às próximas chamadas caso a tentativa falhe.
- Os logs passam a registrar `relayProtocol` para distinguir UDP, TCP e TLS.

## Verificação

86 testes de voz, buffer, medição, reconexão, DJ, sinalização, transporte e tipagem
passaram. A aplicação foi compilada e testada na sala real. A publicação de uma
release não fez parte deste diagnóstico.

O trabalho de convite por link está salvo separadamente no stash identificado
como `WIP convite por link pausado para investigar lag`.
