type InstanceOptions = {
  defaultUserData: string
  isPackaged: boolean
  argv?: string[]
  instanceEnv?: string
}

export function resolveAppInstance({ defaultUserData, isPackaged, argv = [], instanceEnv }: InstanceOptions) {
  const instanceArg = argv.find(arg => arg.startsWith('--instance='))?.split('=')[1]
  const multiFlag = argv.includes('--multi')
  const instanceId = instanceEnv || instanceArg || (multiFlag ? '2' : '1')
  const isMultiInstance = multiFlag || instanceId !== '1'
  const name = isPackaged ? 'Lira' : 'Lira — Desenvolvimento'
  const base = isPackaged ? defaultUserData : `${defaultUserData}-dev`
  return {
    instanceId,
    isMultiInstance,
    userData: isMultiInstance ? `${base}-inst-${instanceId}` : base,
    title: isMultiInstance ? `${name} (Instância ${instanceId})` : name,
    appUserModelId: isPackaged ? 'com.lira.app' : 'com.lira.app.dev',
  }
}
