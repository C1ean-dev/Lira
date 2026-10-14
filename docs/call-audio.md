# Áudio da pessoa e da live

As chamadas novas negociam duas trilhas de áudio desde a primeira oferta: microfone primeiro e live depois. Antes do compartilhamento, a segunda trilha usa silêncio. Iniciar, assistir ou parar uma live substitui apenas essa segunda trilha; trocar ou mutar o microfone preserva a live. A captura da aplicação não mistura o microfone em seu destino.

A oferta identifica o formato com `metadata.audioChannels = 2`. No recebimento, as trilhas são separadas pela ordem dos transceivers de áudio, mesmo quando chegam em outra ordem no MediaStream. A voz fica em `peerStreams` e a live em `peerScreenStreams`. A grade, o mini display e a tela cheia reproduzem a live com `liveStreamVolume`, e a pessoa com `participantVolumes`. O áudio da live na grade fica silencioso enquanto a tela cheia reproduz a mesma live, evitando duplicação. Recolher ou fechar a prévia flutuante mantém a escuta independente da prévia.

Depois de atualizar os clientes, saia e entre novamente na chamada para negociar as duas trilhas. Chamadas antigas com apenas uma trilha não permitem separar uma mistura que já foi transmitida; o cliente atualizado preserva o canal do microfone e não o substitui pelo som da live.

Volumes acima de 100% usam um ganho Web Audio na reprodução local, porque o volume nativo do elemento HTML tem limite de 1. O elemento permanece silencioso quando esse ganho está ativo. Mudo e seleção de saída também são aplicados ao ganho. O processamento é liberado ao trocar ou desmontar a reprodução, sem parar as trilhas remotas.

Os testes simulam as trilhas e os processadores; cobrem seleção de transceiver, reserva anterior ao compartilhamento, troca de microfone, consentimento para assistir, volumes independentes, amplificação, saída de áudio e encerramento. Não substituem um teste auditivo entre computadores.
