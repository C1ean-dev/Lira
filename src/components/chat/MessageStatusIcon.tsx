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
        className={`inline-flex items-center text-sky-400 select-none ${className}`}
      >
        <CheckCheck className="w-3.5 h-3.5" />
      </span>
    )
  }

  if (status === 'delivered') {
    return (
      <span
        title="Entregue"
        className={`inline-flex items-center text-slate-400 select-none ${className}`}
      >
        <CheckCheck className="w-3.5 h-3.5" />
      </span>
    )
  }

  // Default: 'sent' (1 check)
  return (
    <span
      title="Enviado"
      className={`inline-flex items-center text-slate-400 select-none ${className}`}
    >
      <Check className="w-3.5 h-3.5" />
    </span>
  )
}
