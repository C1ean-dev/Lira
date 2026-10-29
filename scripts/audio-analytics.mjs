import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'node_modules/.cache/audio-analytics')
await fs.mkdir(output, { recursive: true })
const logPath = path.join(output, 'test.log')
const log = await fs.open(logPath, 'w')
let code
try {
  code = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', path.join(root, 'scripts/conversation-latency.electron.test.mjs')], {
      cwd: root, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
      env: { ...process.env, LIRA_RUN_CONVERSATION_BENCHMARK: '1', LIRA_AUDIO_OUTPUT: output,
        LIRA_AUDIO_REPLAY_ONLY: '0', LIRA_CONVERSATION_SMOKE: '0',
        LIRA_CONVERSATION_ENGINES: 'bypass,classic,rnnoise,deepfilter',
        LIRA_CONVERSATION_PAIRS: '0,1,2,3', LIRA_CONVERSATION_VARIANT: 'normal',
        LIRA_CONVERSATION_ENCODED_PROBE: '0', LIRA_CONVERSATION_TRACE: '0', LIRA_CONVERSATION_CDP_TRACE: '0' },
    })
    child.once('error', error => { console.error(error.message); resolve(1) })
    child.once('close', result => resolve(result ?? 1))
  })
} finally { await log.close() }
if (code !== 0) {
  console.error(await fs.readFile(logPath, 'utf8'))
  process.exitCode = code
} else {
  const report = JSON.parse(await fs.readFile(path.join(output, 'conversation-report.json'), 'utf8'))
  const comparisons = report.comparisons
  if (comparisons?.length !== 4) throw new Error('Incomplete paired audio analytics')
  const number = (value, digits = 3) => value === null ? 'indisponível' : value.toFixed(digits)
  console.log('\nÁudio WebRTC — média por captura, referência = mesmo áudio sem supressor')
  console.table(comparisons.map(row => ({
    Motor: row.engine, 'Latência média ms': number(row.delayMeanMs, 2),
    'Ref. pareada ms': number(row.pairedReferenceDelayMeanMs, 2),
    'Δ ms vs referência': number(row.pairedDelayDeltaMeanMs, 2),
    'Latências válidas': `${row.measurableDelayCaptures}/${row.captures}`,
    'Pares de latência': row.pairedLatencyCaptures,
  })))
  console.table(comparisons.map(row => ({
    Motor: row.engine,
    'STOI limpo': number(row.cleanStoi), 'Ref. limpo': number(row.cleanReferenceStoi),
    'Δ STOI limpo': number(row.cleanStoiDelta),
    'STOI ruído': number(row.mixedStoi), 'Ref. ruído': number(row.mixedReferenceStoi),
    'Δ STOI ruído': number(row.mixedStoiDelta),
  })))
  console.log('Latência: caminho virtual até reprodução remota; exclui dispositivos físicos e internet.')
  console.log('STOI: comparado à voz limpa; valores maiores são melhores. Δ latência menor é melhor.')
  console.log('Latência indisponível não entra na média; STOI e perdas de voz permanecem no relatório.')
  console.log('Relatório: ' + path.join(output, 'conversation-report.json'))
}
