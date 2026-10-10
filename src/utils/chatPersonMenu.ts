import { ChatPerson } from './chatPeople'
import { isUserId } from './userId'

export type ChatPersonAction =
  | 'message'
  | 'goto'
  | 'invite'
  | 'join'
  | 'add-friend'
  | 'remove-friend'
  | 'close-conversation'
  | 'copy-name'

export interface ChatPersonMenuItem {
  action: ChatPersonAction
  label: string
  tone?: 'danger'
  disabled?: boolean
}

interface ChatPersonMenuContext {
  roomId: string | null
  requestPending: boolean
}

const sameRoom = (a?: string | null, b?: string | null): boolean =>
  !!a && !!b && a.toUpperCase() === b.toUpperCase()

export function getChatPersonMenu(person: ChatPerson, ctx: ChatPersonMenuContext): ChatPersonMenuItem[] {
  const firstName = person.name.trim().split(/\s+/)[0] || person.name
  const items: ChatPersonMenuItem[] = [{ action: 'message', label: 'Enviar mensagem' }]

  if (person.inSpace) {
    items.push({ action: 'goto', label: `Ir até ${firstName}` })
  }

  if (person.kind === 'friend') {
    const alreadyHere = person.inSpace || sameRoom(person.room?.code, ctx.roomId)
    if (ctx.roomId) {
      items.push(
        alreadyHere
          ? { action: 'invite', label: 'Convidar (já está aqui)', disabled: true }
          : person.isOnline
          ? { action: 'invite', label: 'Convidar para este espaço' }
          : { action: 'invite', label: 'Convidar (offline)', disabled: true }
      )
    }
    if (person.room && !alreadyHere) {
      items.push({ action: 'join', label: `Entrar no espaço de ${firstName}` })
    }
  }

  if (person.kind === 'friend') {
    items.push({ action: 'remove-friend', label: 'Remover dos amigos', tone: 'danger' })
  } else if (person.inSpace || isUserId(person.contactId)) {
    items.push(
      ctx.requestPending
        ? { action: 'add-friend', label: 'Solicitação pendente', disabled: true }
        : { action: 'add-friend', label: 'Adicionar aos amigos' }
    )
  }

  if (person.kind === 'conversation') {
    items.push({ action: 'close-conversation', label: 'Fechar conversa' })
  }

  items.push({ action: 'copy-name', label: 'Copiar nome' })
  return items
}
