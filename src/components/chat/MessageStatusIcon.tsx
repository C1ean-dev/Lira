import React from 'react'
import { Check, CheckCheck } from 'lucide-react'
import { MessageDeliveryStatus } from '../../types/chat'

interface MessageStatusIconProps {
  status?: MessageDeliveryStatus
  className?: string
}

export const MessageStatusIcon: React.FC<MessageStatusIconProps> = ({
  status = 'sent',
  className = '',
}) => {
  if (status === 'read') {
    return (
      <span
        title="Lido"
        className={`inline-flex items-center text-sky-400 text-lira-accent select-none ${className}`}
      >
        <CheckCheck className="w-3.5 h-3.5" />
      </span>
    )
  }

  if (status === 'delivered') {
    return (
      <span
        title="Entregue"
        className={`inline-flex items-center text-slate-400 text-lira-muted select-none ${className}`}
      >
        <CheckCheck className="w-3.5 h-3.5" />
      </span>
    )
  }

  return (
    <span
      title="Enviado"
      className={`inline-flex items-center text-slate-400 text-lira-muted select-none ${className}`}
    >
      <Check className="w-3.5 h-3.5" />
    </span>
  )
}
