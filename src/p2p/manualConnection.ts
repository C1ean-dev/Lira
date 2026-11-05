import { decodeDirectInvite, encodeDirectInvite, type DirectInvite } from './directInvite'

type OnLink = (remote: string, channel: RTCDataChannel, pc: RTCPeerConnection) => void

export class ManualConnection {
  private pc?: RTCPeerConnection
  private invite?: DirectInvite
  private timer?: ReturnType<typeof setTimeout>
  private cancelIceCollection?: () => void
  private accepted = false
  private linked = false
  constructor(private create: () => RTCPeerConnection, private onLink: OnLink, private onFailure?: (error: Error) => void) {}

  private fail(pc: RTCPeerConnection, message: string) {
    if (this.pc !== pc) return
    this.close()
    this.onFailure?.(new Error(message))
  }

  private bind(channel: RTCDataChannel, remote: string, pc: RTCPeerConnection) {
    channel.addEventListener('open', () => {
      if (this.pc !== pc || this.linked) return
      this.linked = true
      clearTimeout(this.timer)
      this.onLink(remote, channel, pc)
    }, { once: true })
    channel.addEventListener('close', () => this.fail(pc, 'O canal de conexão direta foi encerrado. Gere um novo convite.'), { once: true })
  }
  private begin(invite: DirectInvite) {
    this.close()
    this.accepted = false
    this.linked = false
    this.invite = invite
    this.pc = this.create()
    const pc = this.pc
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.fail(pc, 'A rede não permitiu estabelecer a conexão direta. Tente um novo convite ou outra rede.')
      }
    })
    this.timer = setTimeout(() => this.fail(pc, 'O convite direto expirou. Peça um novo convite ao anfitrião.'), Math.max(0, invite.expiresAt - Date.now()))
    return pc
  }
  private async description(pc: RTCPeerConnection): Promise<RTCSessionDescriptionInit> {
    if (pc.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve, reject) => {
        const clean = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', state); this.cancelIceCollection = undefined }
        const done = () => { clean(); resolve() }
        const state = () => { if (pc.iceGatheringState === 'complete') done() }
        const timer = setTimeout(done, 8000)
        this.cancelIceCollection = () => { clean(); reject(new Error('Conexão direta cancelada.')) }
        pc.addEventListener('icegatheringstatechange', state)
        state()
      })
    }
    if (this.pc !== pc || !pc.localDescription) throw new Error('Conexão direta cancelada.')
    return { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
  }
  async offer(room: string): Promise<string> {
    const invite: DirectInvite = { version: 1, kind: 'offer', session: crypto.randomUUID(), room,
      host: `lira-${room}-host`, guest: `lira-${room}-peer-${crypto.randomUUID()}`,
      expiresAt: Date.now() + 10 * 60000, description: { type: 'offer', sdp: '' } }
    const pc = this.begin(invite)
    this.bind(pc.createDataChannel('lira-direct-signaling', { ordered: true }), invite.guest, pc)
    try {
      await pc.setLocalDescription(await pc.createOffer())
      const description = await this.description(pc)
      return encodeDirectInvite({ ...invite, description })
    } catch (error) { this.close(); throw error }
  }
  async answer(text: string): Promise<string> {
    const invite = decodeDirectInvite(text)
    if (invite.kind !== 'offer') throw new Error('Cole o convite do anfitrião para gerar uma resposta.')
    const pc = this.begin(invite)
    pc.addEventListener('datachannel', event => {
      if (event.channel.label === 'lira-direct-signaling') this.bind(event.channel, invite.host, pc)
    })
    try {
      await pc.setRemoteDescription(invite.description)
      await pc.setLocalDescription(await pc.createAnswer())
      return encodeDirectInvite({ ...invite, kind: 'answer', description: await this.description(pc) })
    } catch (error) { this.close(); throw error }
  }
  async accept(text: string): Promise<void> {
    const answer = decodeDirectInvite(text), offer = this.invite, pc = this.pc
    if (!offer || !pc || this.accepted || answer.kind !== 'answer' || offer.kind !== 'offer'
      || answer.session !== offer.session || answer.room !== offer.room || answer.host !== offer.host
      || answer.guest !== offer.guest || answer.expiresAt !== offer.expiresAt) {
      throw new Error('Esta resposta não corresponde ao convite atual. Gere um novo convite se necessário.')
    }
    this.accepted = true
    try { await pc.setRemoteDescription(answer.description) }
    catch (error) { this.accepted = false; throw error }
  }
  isLinked() { return this.linked }
  close() {
    clearTimeout(this.timer)
    this.cancelIceCollection?.()
    const pc = this.pc
    this.pc = undefined
    this.invite = undefined
    pc?.close()
  }
}
