type PetQuestion = { apiKey: string; personality: string; petName: string; question: string }
type ErrorCode = 'missing-key' | 'invalid-key' | 'credits' | 'rate-limit' | 'provider-rate-limit' | 'daily-limit' | 'model-unavailable' | 'privacy-settings' | 'access-denied' | 'network' | 'service-unavailable' | 'invalid-response' | 'invalid-request'

const messages: Record<ErrorCode, string> = {
  'missing-key': 'A chave OpenRouter ainda não foi configurada nesta sessão. O responsável pela sala deve informá-la em Pet IA, ao lado do Jam.',
  'invalid-key': 'A OpenRouter recusou a chave da sala. O responsável deve atualizar a chave em Pet IA.',
  credits: 'A OpenRouter recusou a solicitação por falta de créditos ou pelo limite de gasto da chave. Confira o painel da conta.',
  'rate-limit': 'A OpenRouter limitou temporariamente as solicitações. Aguarde um pouco e tente novamente.',
  'provider-rate-limit': 'Os provedores dos modelos gratuitos estão sobrecarregados. Tente novamente em instantes.',
  'daily-limit': 'A cota diária de solicitações gratuitas da OpenRouter foi atingida. Tente novamente após a renovação da cota.',
  'model-unavailable': 'Nenhum modelo gratuito de conversa está disponível na OpenRouter neste momento. Tente novamente mais tarde.',
  'privacy-settings': 'As configurações de privacidade da conta OpenRouter não permitem os provedores disponíveis. O responsável deve revisar essas opções na OpenRouter.',
  'access-denied': 'A OpenRouter não permitiu esta solicitação. Confira as permissões da conta e da chave.',
  network: 'Não foi possível conectar à OpenRouter. Confira a conexão e tente novamente.',
  'service-unavailable': 'A OpenRouter ou o provedor está temporariamente indisponível. Tente novamente em instantes.',
  'invalid-response': 'O modelo não retornou uma resposta de conversa válida. Tente perguntar novamente.',
  'invalid-request': 'A OpenRouter rejeitou os parâmetros da conversa. Atualize o Lira ou tente novamente mais tarde.',
}

export class PetOpenRouterError extends Error {
  constructor(public readonly code: ErrorCode) { super(messages[code]); this.name = 'PetOpenRouterError' }
}

const isSafetyClassification = (text: string) => /^\s*(?:user|assistant|response)\s+safety\s*:\s*(?:safe|unsafe)\b/i.test(text)

function apiError(status: number, data: any): PetOpenRouterError {
  const detail = typeof data?.error?.message === 'string' ? data.error.message.toLowerCase() : ''
  if (/data policy|privacy|data collection|zdr/.test(detail)) return new PetOpenRouterError('privacy-settings')
  if (status === 400) return new PetOpenRouterError('invalid-request')
  if (status === 401) return new PetOpenRouterError('invalid-key')
  if (status === 402) return new PetOpenRouterError('credits')
  if (status === 429) {
    if (data?.error?.metadata?.provider_name || /provider returned error|upstream/.test(detail)) return new PetOpenRouterError('provider-rate-limit')
    return new PetOpenRouterError(/per.day|daily|quota/.test(detail) ? 'daily-limit' : 'rate-limit')
  }
  if (status === 403) return new PetOpenRouterError('access-denied')
  if (status === 404) return new PetOpenRouterError('model-unavailable')
  return new PetOpenRouterError('service-unavailable')
}

async function request(fetcher: typeof fetch, url: string, options?: RequestInit) {
  let response: Response
  try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(30000) }) }
  catch { throw new PetOpenRouterError('network') }
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.error) throw apiError(Number(data?.error?.code) || response.status, data)
  return data
}

export async function askPet({ apiKey, personality, petName, question }: PetQuestion, fetcher: typeof fetch = fetch): Promise<string> {
  if (!apiKey.trim()) throw new PetOpenRouterError('missing-key')
  let failure = new PetOpenRouterError('invalid-response')
  for (let attempt = 0; attempt < 3; attempt++) {
    let data: any
    try {
      data = await request(fetcher, 'https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model: 'openrouter/free', max_tokens: 2048,
          messages: [
            { role: 'system', content: `Você é o pet ${petName}. Responda de forma breve e apropriada para ser falada em voz alta. Personalidade: ${personality || 'amigável e prestativo'}` },
            { role: 'user', content: question },
          ],
        }),
      })
    } catch (error) {
      failure = error instanceof PetOpenRouterError ? error : new PetOpenRouterError('service-unavailable')
      continue
    }
    const answer = data?.choices?.[0]?.message?.content
    if (typeof answer === 'string' && answer.trim() && !isSafetyClassification(answer)) {
      return answer.trim().slice(0, 2000)
    }
    failure = new PetOpenRouterError('invalid-response')
  }
  throw failure
}
