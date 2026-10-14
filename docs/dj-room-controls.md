# DJ compartilhado por sala

Uma pessoa fornece o áudio do Spotify para cada sala. A sessão é reservada antes
de abrir o navegador e iniciar a captura. Em inícios simultâneos, todos os
participantes escolhem a mesma sessão por horário e identificador; a fonte que
perde a reserva cancela sua captura.

O dono mantém o player e sua conta no próprio computador. Os demais participantes
veem o nome da faixa, artista, progresso e controles. Pausar, reproduzir, avançar,
voltar, alternar aleatório/repetição e buscar uma posição enviam comandos ao dono.
O volume e o mute continuam individuais, sem modificar a fonte transmitida.

A leitura do player pertence à sessão, independente do painel estar aberto ou
recolhido. O anfitrião encaminha mensagens validadas e envia o estado atual para
novas conexões. Comandos são executados em sequência e recebem confirmação;
mensagens duplicadas, de outra sala ou de uma sessão anterior são descartadas.

Ao sair da sala, encerrar o aplicativo ou perder a conexão, o dono deixa de manter
o DJ. Os participantes removem a sessão, o bot, os controles e seu áudio quando
detectam a saída. Fechar a janela do Spotify para a bandeja continua preservando
a transmissão, como antes.

Donos e administradores podem usar **Remover da sala** no menu do participante
ou na lista de pessoas. O participante vai para um ponto livre do corredor,
encerra sua chamada/transmissão e permanece conectado ao espaço. Administradores
de uma sala só têm essa permissão nas salas em que estão cadastrados. O dono do
espaço e o bot DJ não são alvos dessa ação. Se o participante removido for o dono
do DJ, a sessão também termina.

Os controles compartilhados exigem que o dono e os participantes usem esta versão
do protocolo. Os testes automatizados usam conexões e APIs de player simuladas;
a reprodução entre computadores não foi validada manualmente.
