import ts from 'typescript'
import path from 'node:path'

/** Persist compiler dependency/signature information, never a cached pass/fail result. */
export function checkTypeScriptProject(configPath: string, cacheFile: string): string[] {
  const root = path.dirname(configPath)
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const program = ts.createIncrementalProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true, incremental: true, tsBuildInfoFile: cacheFile },
  })
  const diagnostics = [
    ...parsed.errors,
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...(parsed.options.declaration || parsed.options.composite ? program.getDeclarationDiagnostics() : []),
  ]
  // noEmit still writes compiler build information, without emitting application code.
  program.emit()
  return diagnostics.map(diagnostic => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    if (!diagnostic.file || diagnostic.start === undefined) return `TS${diagnostic.code}: ${message}`
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    return `${path.relative(root, diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} TS${diagnostic.code}: ${message}`
  })
}
