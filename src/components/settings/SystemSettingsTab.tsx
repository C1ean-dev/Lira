import React from 'react'
import {
  Monitor,
  Power,
  Minimize2,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  LogOut,
  Cpu,
} from 'lucide-react'
import { useAppSettings } from '../../hooks/useAppSettings'
import { useFirewallStatus } from '../../hooks/useFirewallStatus'
import { useMediaStore } from '../../store/useMediaStore'

export const SystemSettingsTab: React.FC = () => {
  const { settings, isElectron, updateSettings, minimizeToTray, quitApp } = useAppSettings()
  const { isAllowed: isFirewallAllowed, isChecking: isFirewallChecking, isRequesting: isFirewallRequesting, feedback: firewallFeedback, requestAccess: requestFirewallAccess, checkStatus: checkFirewallStatus } = useFirewallStatus()
  const isHardwareAccelerationEnabled = useMediaStore((s) => s.isHardwareAccelerationEnabled)
  const setHardwareAccelerationEnabled = useMediaStore((s) => s.setHardwareAccelerationEnabled)

  return (
    <div className="space-y-6 text-slate-200 select-none pb-4">
      {/* Non-Electron notice if running purely in browser */}
      {!isElectron && (
        <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-400" />
          <div>
            <div className="font-semibold">Modo Navegador Web detectado</div>
            <div className="text-[11px] text-amber-300/80 mt-0.5">
              As opções de bandeja do sistema e inicialização com o Windows requerem o aplicativo desktop Electron do Lira.
            </div>
          </div>
        </div>
      )}

      {/* Card 1: Inicialização com o Windows */}
      <div className="p-5 rounded-2xl bg-[#12151d]/70 border border-[#2a3142] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Power className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100">Inicialização Automática</div>
              <div className="text-xs text-slate-400">
                Iniciar o Lira com o Windows
              </div>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.openAtLogin}
              onChange={(e) => updateSettings({ openAtLogin: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>
      </div>

      {/* Card 2: Bandeja do Sistema (Ícones Ocultos) */}
      <div className="p-5 rounded-2xl bg-[#12151d]/70 border border-[#2a3142] space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <Monitor className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100">Bandeja do Windows (Ícones Ocultos)</div>
            <div className="text-xs text-slate-400">
              Comportamento do aplicativo em segundo plano
            </div>
          </div>
        </div>

        {/* Option: Close to Tray */}
        <div className="pt-2 border-t border-[#2a3142]/60 flex items-center justify-between">
          <div className="pr-4">
            <div className="text-xs font-semibold text-slate-200">
              Manter rodando nos ícones ocultos ao fechar (X)
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Ao clicar no <span className="font-mono text-indigo-400">X</span>, o aplicativo não fecha: ele continua em segundo plano para você receber chamadas, notificações e mensagens.
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={settings.closeToTray}
              onChange={(e) => updateSettings({ closeToTray: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>

        {/* Option: Minimize to Tray */}
        <div className="pt-3 border-t border-[#2a3142]/60 flex items-center justify-between">
          <div className="pr-4">
            <div className="text-xs font-semibold text-slate-200">
              Minimizar para a bandeja ao clicar em minimizar
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Remove a janela da barra de tarefas principal, mantendo apenas o ícone na área de notificação.
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={settings.minimizeToTray}
              onChange={(e) => updateSettings({ minimizeToTray: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>

        {/* Quick action: Test hide now */}
        {isElectron && (
          <div className="pt-3 border-t border-[#2a3142]/60 flex items-center justify-between">
            <div className="text-[11px] text-slate-400">
              Quer testar como o app se comporta na bandeja?
            </div>
            <button
              onClick={minimizeToTray}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-all hover:scale-105 active:scale-95"
            >
              <Minimize2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Ocultar para a Bandeja Agora</span>
            </button>
          </div>
        )}
      </div>

      {/* Card 3: Aceleração por Hardware GPU */}
      <div className="p-5 rounded-2xl bg-[#12151d]/70 border border-[#2a3142] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors ${
                isHardwareAccelerationEnabled
                  ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>Aceleração por Hardware GPU (Live & Vídeo)</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-extrabold tracking-wider border transition-colors ${
                    isHardwareAccelerationEnabled
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-slate-700/60 text-slate-400 border-slate-600'
                  }`}
                >
                  {isHardwareAccelerationEnabled ? 'Ativada (GPU H.264)' : 'Desativada (CPU VP8)'}
                </span>
              </div>
              <div className="text-xs text-slate-400">
                {isHardwareAccelerationEnabled
                  ? 'Codificação e decodificação H.264 via GPU (NVIDIA NVENC, AMD AMF/VCN, Intel QuickSync)'
                  : 'Codificação via software libvpx na CPU (útil se a GPU for incompatível)'}
              </div>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
            <input
              type="checkbox"
              checked={isHardwareAccelerationEnabled}
              onChange={(e) => setHardwareAccelerationEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>

        <div className="text-[11.5px] text-slate-400 pl-1 pt-1 leading-relaxed">
          {isHardwareAccelerationEnabled
            ? 'A codificação da live (compartilhamento de tela e câmera) e a decodificação dos vídeos recebidos são processadas diretamente nos núcleos dedicados da sua placa de vídeo (GPU) com WebRTC Zero-Copy, aliviando o uso do processador (CPU) para jogos e programas pesados.'
            : 'A aceleração por hardware está desligada. O vídeo será codificado e decodificado pelo processador do computador (CPU). Pode causar maior uso de CPU durante jogos ou transmissões pesadas.'}
        </div>
      </div>

      {/* Card 4: Windows Defender Firewall */}
      <div className="p-5 rounded-2xl bg-[#12151d]/70 border border-[#2a3142] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl border flex items-center justify-center ${
                isFirewallAllowed
                  ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-500/20 border-amber-500/30 text-amber-400'
              }`}
            >
              {isFirewallAllowed ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100">Windows Defender Firewall</div>
              <div className="text-xs text-slate-400">
                Permissão de conexões diretas P2P e chamadas de voz/vídeo locais
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={checkFirewallStatus}
              disabled={isFirewallChecking}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-all"
              title="Verificar status do firewall"
            >
              <RefreshCw
                className={`w-4 h-4 ${isFirewallChecking ? 'animate-spin text-indigo-400' : ''}`}
              />
            </button>

            <span
              className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                isFirewallAllowed
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}
            >
              {isFirewallAllowed ? 'Permitido' : 'Pendente'}
            </span>
          </div>
        </div>

        {!isFirewallAllowed && isElectron && (
          <div className="pt-2 flex items-center justify-between">
            <div className="text-[11px] text-amber-300/90 max-w-sm">
              Para garantir que chamadas e voz não sejam bloqueadas pelo Windows, adicione a regra de liberação.
            </div>
            <button
              onClick={requestFirewallAccess}
              disabled={isFirewallRequesting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white transition-all shadow-md shadow-indigo-600/20"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{isFirewallRequesting ? 'Solicitando...' : 'Liberar no Firewall'}</span>
            </button>
          </div>
        )}

        {firewallFeedback && (
          <div
            className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
              firewallFeedback.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                : 'bg-red-500/10 border border-red-500/20 text-red-300'
            }`}
          >
            {firewallFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            )}
            <span>{firewallFeedback.text}</span>
          </div>
        )}
      </div>

      {/* Card 4: Instruções de uso da bandeja e saída completa */}
      <div className="p-4 rounded-2xl bg-indigo-950/20 border border-indigo-500/20 text-xs text-slate-300 space-y-2">
        <div className="flex items-center gap-2 text-indigo-300 font-bold">
          <HelpCircle className="w-4 h-4" />
          <span>Como funciona a Bandeja do Sistema:</span>
        </div>
        <ul className="list-disc list-inside space-y-1 text-[11.5px] text-slate-400 pl-1">
          <li>
            <strong className="text-slate-200">Clique com botão esquerdo</strong> no ícone do Lira na barra de tarefas para alternar rapidamente entre mostrar ou ocultar a janela.
          </li>
          <li>
            <strong className="text-slate-200">Clique com botão direito</strong> no ícone para acessar o menu rápido de configurações ou sair totalmente.
          </li>
          <li>
            Para <strong className="text-slate-200">fechar por completo</strong> o aplicativo sem deixá-lo em segundo plano, selecione <em>"Sair do Lira"</em> no menu do ícone da bandeja.
          </li>
        </ul>

        {isElectron && (
          <div className="pt-2 border-t border-indigo-500/10 flex justify-end">
            <button
              onClick={quitApp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-semibold transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Encerrar Aplicativo Completamente</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
