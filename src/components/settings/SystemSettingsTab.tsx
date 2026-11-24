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
    <div className="space-y-6 text-lira-ink font-mono select-none pb-4">
      {!isElectron && (
        <div className="flex items-center gap-3 p-3.5 rounded-[12px] bg-lira-amber/10 border border-dashed border-lira-amber/40 text-lira-amber text-xs">
          <AlertCircle className="w-5 h-5 shrink-0 text-lira-amber" />
          <div>
            <div className="font-semibold">Modo Navegador Web detectado</div>
            <div className="text-[11px] text-lira-amber/80 mt-0.5">
              As opções de bandeja do sistema e inicialização com o Windows requerem o aplicativo desktop Electron do Lira.
            </div>
          </div>
        </div>
      )}

      <div className="p-5 rounded-[12px] bg-lira-ground border border-dashed border-lira-rule/60 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[8px] bg-lira-surface border border-lira-rule flex items-center justify-center text-lira-accent">
              <Power className="w-4 h-4" />
            </div>
            <div>
              <div className="font-display text-base font-bold text-lira-ink">Inicialização Automática</div>
              <div className="text-xs text-lira-muted">
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
            <div className="w-11 h-6 bg-lira-surface border border-lira-rule peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-lira-ground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-lira-ink peer-checked:after:bg-lira-ground after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-lira-accent peer-checked:border-lira-accent"></div>
          </label>
        </div>

        <div className="pt-3 border-t border-dashed border-lira-rule/60 flex items-center justify-between">
          <div className="pr-4">
            <div className="text-xs font-semibold text-lira-ink">
              Atualizar automaticamente ao ligar o PC
            </div>
            <div className="text-[11px] text-lira-muted mt-0.5">
              Verifica e baixa apenas os arquivos alterados em segundo plano ao iniciar o Windows, para você já entrar no Lira atualizado.
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={settings.autoUpdateAtLogin}
              onChange={(e) => updateSettings({ autoUpdateAtLogin: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-lira-surface border border-lira-rule peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-lira-ground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-lira-ink peer-checked:after:bg-lira-ground after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-lira-accent peer-checked:border-lira-accent"></div>
          </label>
        </div>
      </div>

      <div className="p-5 rounded-[12px] bg-lira-ground border border-dashed border-lira-rule/60 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[8px] bg-lira-surface border border-lira-rule flex items-center justify-center text-lira-accent">
            <Monitor className="w-4 h-4" />
          </div>
          <div>
            <div className="font-display text-base font-bold text-lira-ink">Bandeja do Windows (Ícones Ocultos)</div>
            <div className="text-xs text-lira-muted">
              Comportamento do aplicativo em segundo plano
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-dashed border-lira-rule/60 flex items-center justify-between">
          <div className="pr-4">
            <div className="text-xs font-semibold text-lira-ink">
              Manter rodando nos ícones ocultos ao fechar (X)
            </div>
            <div className="text-[11px] text-lira-muted mt-0.5">
              Ao clicar no <span className="font-mono text-lira-accent">X</span>, o aplicativo não fecha: ele continua em segundo plano para você receber chamadas, notificações e mensagens.
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={settings.closeToTray}
              onChange={(e) => updateSettings({ closeToTray: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-lira-surface border border-lira-rule peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-lira-ground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-lira-ink peer-checked:after:bg-lira-ground after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-lira-accent peer-checked:border-lira-accent"></div>
          </label>
        </div>

        <div className="pt-3 border-t border-dashed border-lira-rule/60 flex items-center justify-between">
          <div className="pr-4">
            <div className="text-xs font-semibold text-lira-ink">
              Minimizar para a bandeja ao clicar em minimizar
            </div>
            <div className="text-[11px] text-lira-muted mt-0.5">
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
            <div className="w-11 h-6 bg-lira-surface border border-lira-rule peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-lira-ground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-lira-ink peer-checked:after:bg-lira-ground after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-lira-accent peer-checked:border-lira-accent"></div>
          </label>
        </div>

        {isElectron && (
          <div className="pt-3 border-t border-dashed border-lira-rule/60 flex items-center justify-between">
            <div className="text-[11px] text-lira-muted">
              Quer testar como o app se comporta na bandeja?
            </div>
            <button
              onClick={minimizeToTray}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-xs font-mono font-semibold text-lira-ink hover:text-lira-accent transition-colors"
            >
              <Minimize2 className="w-3.5 h-3.5 text-lira-accent" />
              <span>Ocultar para a Bandeja Agora</span>
            </button>
          </div>
        )}
      </div>

      <div className="p-5 rounded-[12px] bg-lira-ground border border-dashed border-lira-rule/60 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-[8px] border flex items-center justify-center transition-colors ${
                isHardwareAccelerationEnabled
                  ? 'bg-lira-online/15 border-lira-online/40 text-lira-online'
                  : 'bg-lira-surface border-lira-quiet text-lira-muted'
              }`}
            >
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <div className="font-display text-base font-bold text-lira-ink flex items-center gap-2">
                <span>Aceleração por Hardware GPU (Live & Vídeo)</span>
                <span
                  className={`text-[10px] font-mono tabular-nums px-2 py-0.5 rounded-[6px] uppercase font-extrabold tracking-wider border transition-colors ${
                    isHardwareAccelerationEnabled
                      ? 'bg-lira-online/15 text-lira-online border-lira-online/40'
                      : 'bg-lira-surface text-lira-muted border-lira-quiet'
                  }`}
                >
                  {isHardwareAccelerationEnabled ? 'Ativada (GPU H.264)' : 'Desativada (CPU VP8)'}
                </span>
              </div>
              <div className="text-xs text-lira-muted">
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
            <div className="w-11 h-6 bg-lira-surface border border-lira-rule peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-lira-ground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-lira-ink peer-checked:after:bg-lira-ground after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-lira-online peer-checked:border-lira-online"></div>
          </label>
        </div>

        <div className="text-[11.5px] text-lira-muted pl-1 pt-1 leading-relaxed">
          {isHardwareAccelerationEnabled
            ? 'A codificação da live (compartilhamento de tela e câmera) e a decodificação dos vídeos recebidos são processadas diretamente nos núcleos dedicados da sua placa de vídeo (GPU) com WebRTC Zero-Copy, aliviando o uso do processador (CPU) para jogos e programas pesados.'
            : 'A aceleração por hardware está desligada. O vídeo será codificado e decodificado pelo processador do computador (CPU). Pode causar maior uso de CPU durante jogos ou transmissões pesadas.'}
        </div>
      </div>

      <div className="p-5 rounded-[12px] bg-lira-ground border border-dashed border-lira-rule/60 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-[8px] border flex items-center justify-center ${
                isFirewallAllowed
                  ? 'bg-lira-online/15 border-lira-online/40 text-lira-online'
                  : 'bg-lira-amber/15 border-lira-amber/40 text-lira-amber'
              }`}
            >
              {isFirewallAllowed ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="font-display text-base font-bold text-lira-ink">Windows Defender Firewall</div>
              <div className="text-xs text-lira-muted">
                Permissão de conexões diretas P2P e chamadas de voz/vídeo locais
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={checkFirewallStatus}
              disabled={isFirewallChecking}
              className="p-2 rounded-[8px] bg-lira-surface border border-lira-rule hover:border-lira-accent text-lira-muted hover:text-lira-ink transition-colors"
              title="Verificar status do firewall"
            >
              <RefreshCw
                className={`w-4 h-4 ${isFirewallChecking ? 'animate-spin text-lira-accent' : ''}`}
              />
            </button>

            <span
              className={`text-xs font-mono px-2.5 py-1 rounded-[6px] font-bold uppercase tracking-wider ${
                isFirewallAllowed
                  ? 'bg-lira-online/15 text-lira-online border border-lira-online/40'
                  : 'bg-lira-amber/15 text-lira-amber border border-lira-amber/40'
              }`}
            >
              {isFirewallAllowed ? 'Permitido' : 'Pendente'}
            </span>
          </div>
        </div>

        {!isFirewallAllowed && isElectron && (
          <div className="pt-2 flex items-center justify-between">
            <div className="text-[11px] text-lira-amber max-w-sm">
              Para garantir que chamadas e voz não sejam bloqueadas pelo Windows, adicione a regra de liberação.
            </div>
            <button
              onClick={requestFirewallAccess}
              disabled={isFirewallRequesting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-xs font-mono font-bold text-lira-ground border border-lira-accent hover:border-lira-ink transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{isFirewallRequesting ? 'Solicitando...' : 'Liberar no Firewall'}</span>
            </button>
          </div>
        )}

        {firewallFeedback && (
          <div
            className={`p-2.5 rounded-[8px] text-xs flex items-center gap-2 ${
              firewallFeedback.type === 'success'
                ? 'bg-lira-online/10 border border-lira-online/30 text-lira-online'
                : 'bg-lira-error/10 border border-lira-error/30 text-lira-error'
            }`}
          >
            {firewallFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-lira-online" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-lira-error" />
            )}
            <span>{firewallFeedback.text}</span>
          </div>
        )}
      </div>

      <div className="p-4 rounded-[12px] bg-lira-surface/50 border border-dashed border-lira-rule/60 text-xs text-lira-ink space-y-2">
        <div className="flex items-center gap-2 text-lira-accent font-bold">
          <HelpCircle className="w-4 h-4" />
          <span>Como funciona a Bandeja do Sistema:</span>
        </div>
        <ul className="list-disc list-inside space-y-1 text-[11.5px] text-lira-muted pl-1">
          <li>
            <strong className="text-lira-ink">Clique com botão esquerdo</strong> no ícone do Lira na barra de tarefas para alternar rapidamente entre mostrar ou ocultar a janela.
          </li>
          <li>
            <strong className="text-lira-ink">Clique com botão direito</strong> no ícone para acessar o menu rápido de configurações ou sair totalmente.
          </li>
          <li>
            Para <strong className="text-lira-ink">fechar por completo</strong> o aplicativo sem deixá-lo em segundo plano, selecione <em>"Sair do Lira"</em> no menu do ícone da bandeja.
          </li>
        </ul>

        {isElectron && (
          <div className="pt-2 border-t border-dashed border-lira-rule/60 flex justify-end">
            <button
              onClick={quitApp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-lira-error/15 hover:bg-lira-error/25 border border-lira-error/40 text-lira-error text-xs font-mono font-semibold transition-colors"
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
