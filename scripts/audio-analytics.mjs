import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'node_modules/.cache/audio-analytics-v2')
await fs.mkdir(output, { recursive: true })
const logPath = path.join(output, 'test.log')
const log = await fs.open(logPath, 'w')
let code
try {
  code = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', path.join(root, 'scripts/conversation-plan.test.mjs'), path.join(root, 'scripts/conversation-latency.electron.test.mjs')], {
      cwd: root, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
      env: { ...process.env, LIRA_RUN_CONVERSATION_BENCHMARK: '1', LIRA_AUDIO_OUTPUT: output,
        LIRA_AUDIO_REPLAY_ONLY: '0', LIRA_CONVERSATION_SMOKE: '0',
        LIRA_AUDIO_SNAPSHOTS: '', LIRA_EXPECT_WORKER_CONDITION: '',
        LIRA_CONVERSATION_ENGINES: 'bypass,classic,rnnoise,deepfilter',
        LIRA_CONVERSATION_PAIRS: '0,1,2,3', LIRA_CONVERSATION_VARIANT: 'normal',
        LIRA_CONVERSATION_REPETITIONS: '2', LIRA_CONVERSATION_WARMUP_MS: '6000',
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
  console.log('\nÁudio WebRTC — duas repetições, ordem alternada, mesma topologia e aquecimento de 6 s')
  console.log('Custo local do motor: saída processada menos entrada do motor, antes de Opus/RTP.')
  console.table(comparisons.map(row => ({
    Motor: row.engine, 'Motor média ms': number(row.engineDelayMeanMs, 2),
    'Motor p95 ms': number(row.engineDelayP95Ms, 2),
    'Variação entre repetições ms': number(row.engineDelayRepeatSpreadMaxMs, 2),
    Válidas: `${row.engineDelayMeasuredCaptures}/${row.captures}`,
  })))
  console.log('Atraso remoto total: inclui buffers WebRTC. Não representa o custo do supressor.')
  console.table(comparisons.map(row => ({
    Motor: row.engine, 'Total médio ms': number(row.delayMeanMs, 2),
    'Buffer receptor ms': number(row.receiverBufferMeanMs, 2),
    'Δ ms vs referência': number(row.pairedDelayDeltaMeanMs, 2),
    'Total p95 ms': number(row.remoteDelayP95Ms, 2),
    'Variação repetida ms': number(row.remoteDelayRepeatSpreadMaxMs, 2),
    'Latências válidas': `${row.measurableDelayCaptures}/${row.captures}`,
  })))
  console.table(comparisons.map(row => ({
    Motor: row.engine,
    'STOI local limpo': number(row.cleanLocalStoi), 'STOI local ruído': number(row.mixedLocalStoi),
    'STOI remoto limpo': number(row.cleanStoi),
    'Δ STOI limpo': number(row.cleanStoiDelta),
    'STOI remoto ruído': number(row.mixedStoi),
    'Δ STOI ruído': number(row.mixedStoiDelta),
  })))
  console.log('Latência: caminho virtual até reprodução remota; exclui dispositivos físicos e internet.')
  console.log('STOI: comparado à voz limpa; valores maiores são melhores. Δ latência menor é melhor.')
  console.log('Latência indisponível não entra na média; STOI e perdas de voz permanecem no relatório.')
  if (comparisons.some(row => row.remoteDelayRepeatSpreadMaxMs > 30)) {
    console.log('Comparação remota instável: há casos com variação acima de 30 ms. Não concluir ganho de latência a partir do delta total.')
  }
  console.log('Relatório: ' + path.join(output, 'conversation-report.json'))
}
