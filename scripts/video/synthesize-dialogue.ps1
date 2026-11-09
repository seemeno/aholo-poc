param(
  [Parameter(Mandatory=$true)][string]$DialogueFile,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
$streamType = [Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetGenericArguments().Count -eq 1
} | Select-Object -First 1
$voices = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
$dialogue = Get-Content -LiteralPath $DialogueFile -Raw -Encoding UTF8 | ConvertFrom-Json
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
foreach ($line in $dialogue) {
  $synth = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::new()
  $voiceName = if ($line.speaker -eq 'A') { 'Microsoft Kangkang' } else { 'Microsoft Yaoyao' }
  $synth.Voice = $voices | Where-Object DisplayName -eq $voiceName | Select-Object -First 1
  $synth.Options.SpeakingRate = 1.08
  $operation = $synth.SynthesizeTextToStreamAsync([string]$line.text)
  $task = $asTask.MakeGenericMethod($streamType).Invoke($null, @($operation))
  $task.Wait()
  $speechStream = $task.Result
  $inputStream = $speechStream.GetInputStreamAt(0)
  $reader = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($inputStream)
  $fileName = '{0:D2}-{1}.wav' -f [int]$line.id, $line.speaker
  $target = [System.IO.File]::Create((Join-Path $OutputDirectory $fileName))
  try { $reader.CopyTo($target) } finally { $target.Dispose(); $reader.Dispose(); $speechStream.Dispose(); $synth.Dispose() }
  Write-Output $fileName
}
