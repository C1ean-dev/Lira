# STUN próprio do Lira

Este serviço usa [Coturn](https://github.com/coturn/coturn), em modo somente STUN.
Ele precisa de uma VM Linux com IP público e entrada UDP na porta 3478.
Não pode ser exposto pelo web service `lira-signaling.onrender.com`, pois a
[Render só encaminha uma porta HTTP pública](https://render.com/docs/web-services#port-binding).
A sinalização pode continuar na Render.

## Oracle Always Free

Uma VM elegível para Always Free pode hospedar este serviço. Crie a VM na região
principal da conta, dentro dos limites gratuitos, com uma subnet pública, IP
público e rota para o Internet Gateway. Pode ser usado o próprio IP, sem comprar
um domínio. Caso use DNS, o registro deve apontar diretamente para o IP da VM,
sem proxy HTTP/CDN.

Na Security List ou NSG da VM, adicione uma regra de entrada **stateful**:

| Campo | Valor |
| --- | --- |
| Origem | `0.0.0.0/0` |
| Protocolo | UDP |
| Porta de origem | Todas |
| Porta de destino | `3478` |

Libere a mesma porta no firewall do sistema operacional. Preserve a regra SSH
para administrar a VM. Neste modo não são necessárias portas de relay TURN.

Instale Docker Engine e Compose na VM Linux e copie esta pasta para ela. Execute
na pasta que contém `compose.yaml`:

```sh
docker compose up -d
```

O Compose usa rede do host para preservar o endereço de origem dos pacotes UDP e
reinicia o serviço após reinicializações. A imagem oficial está fixada na versão
`4.18.0-r0`; revise as atualizações do Coturn antes de futuras implantações.
Os logs têm rotação e o Coturn não habilita relay anônimo nem console remoto.

Depois de disponibilizar o IP/hostname, configure no ambiente do **cliente Lira**:

```dotenv
VITE_STUN_FALLBACK_URLS=stun:SEU_IP_OU_DOMINIO:3478
```

Substitua o exemplo pelo endereço real antes de gerar/distribuir o aplicativo.
O cliente inicia com Google e Twilio. Após falha de ICE/conexão, inclui o servidor
próprio nas novas negociações durante dois minutos; depois volta à configuração
principal. Conexões funcionando não são fechadas ao mudar a configuração.
Sem essa variável, nenhum endereço STUN próprio é usado.

Uma falha de conexão é o gatilho do fallback; ela não comprova que os dois STUN
públicos estão fora do ar. Apenas ordenar uma lista `iceServers` não implementa
fallback, porque o navegador pode consultar os servidores simultaneamente.

STUN não retransmite mídia. Para NAT simétrico ou redes que bloqueiam P2P, será
necessário TURN autenticado: consulte [a configuração de relays](../../docs/call-relays.md).
Esta configuração não habilita TURN; isso exige portas de relay, autenticação e
uma configuração própria.

A Oracle pode ficar sem capacidade gratuita na região e pode recolher VMs
Always Free ociosas. Portanto, este serviço gratuito aumenta a redundância,
mas não oferece garantia de disponibilidade permanente.

Fontes: [Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[Security Lists](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm),
[Coturn Docker](https://github.com/coturn/coturn/tree/master/docker/coturn).

## Estado de implantação

Os arquivos estão preparados; nenhuma VM foi criada e nenhum serviço foi
publicado. Antes de habilitar o endereço no pacote do Lira, valide o STUN de uma
rede externa à VM. Neste projeto, validação manual/de rede depende de autorização
do usuário conforme `AGENTS.md`.
