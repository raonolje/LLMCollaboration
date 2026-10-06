// A separate process waits for normal exit. It never terminates another process.
export const windowsUpdateScript = String.raw`param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
$update = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$folder = [IO.Path]::GetFullPath($update.folder)
$target = [IO.Path]::GetFullPath($update.target)
$source = [IO.Path]::GetFullPath($update.filePath)
$backup = Join-Path $folder 'backup'
$statusFile = Join-Path $folder 'status.json'
$readyFile = Join-Path $folder 'ready.json'
$oldExe = Join-Path $backup 'previous.exe'
$staged = Join-Path ([IO.Path]::GetDirectoryName($target)) ('.llm-update-' + $update.nonce + '.exe')
$swapped = $false
$trustedOriginal = $false
function Status([string]$state,[string]$message='') {
  @{state=$state;message=$message;version=$update.version;timestamp=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding UTF8
}
function Hash([string]$file) {
  $stream=[IO.File]::OpenRead($file);$algorithm=[Security.Cryptography.SHA256]::Create()
  try {return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
  finally {$stream.Dispose();$algorithm.Dispose()}
}
function Unlocked([string]$file) {
  try { $handle=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None);$handle.Dispose();return $true } catch {return $false}
}
try {
  if ($folder -ne [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Manifest)) -or $update.nonce -notmatch '^[0-9a-f-]{36}$' -or $source -eq $target -or $target -notmatch '^[A-Za-z]:\\' -or $source -notmatch '^[A-Za-z]:\\') {throw 'Invalid update paths'}
  $updatesRoot=[IO.Path]::GetFullPath($update.updatesDirectory) + [IO.Path]::DirectorySeparatorChar
  if ([IO.Path]::GetFileName($update.updatesDirectory) -ne 'updates') {throw 'Invalid private updates folder'}
  if (-not $source.StartsWith($updatesRoot,[StringComparison]::OrdinalIgnoreCase) -or -not $folder.StartsWith($updatesRoot,[StringComparison]::OrdinalIgnoreCase)) {throw 'Source must stay inside the private updates folder'}
  if ([IO.Path]::GetFileName($target) -notmatch '^LLM[ .]Collaboration(?:[ .]\d+\.\d+\.\d+)?\.exe$') {throw 'Invalid executable target'}
  $trustedOriginal = (Hash $target) -eq $update.targetHash
  if(-not $trustedOriginal -or (Hash $source) -ne $update.sha256) {throw 'Executable SHA256 verification failed'}
  $sourceInfo=[Diagnostics.FileVersionInfo]::GetVersionInfo($source)
  $sourceVersion=$sourceInfo.ProductVersion -replace '^(\d+\.\d+\.\d+)(?:\.\d+)?(?:.*)$','$1'
  if($sourceInfo.ProductName -ne 'LLM Collaboration' -or $sourceVersion -ne $update.version){throw 'Executable product or version does not match the trusted release'}
  Status 'waiting-exit'
  $deadline=[DateTime]::UtcNow.AddMinutes(5)
  do {
    $runtime=Get-Process -Id $update.runtimePid -ErrorAction SilentlyContinue
    $launcher=if($update.portable){Get-Process -Id $update.launcherPid -ErrorAction SilentlyContinue}else{$null}
    if (-not $runtime -and -not $launcher -and (Unlocked $target)) {break}
    if ([DateTime]::UtcNow -gt $deadline) {throw 'Normal application exit timed out; executable was not changed'}
    Start-Sleep -Milliseconds 200
  } while($true)
  if ((Hash $target) -ne $update.targetHash) {throw 'Installed executable changed while the update was waiting'}
  Status 'backing-up'
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  Copy-Item -LiteralPath $target -Destination $oldExe
  $settingsBackup=Join-Path $backup 'settings'; New-Item -ItemType Directory -Path $settingsBackup | Out-Null
  foreach($name in @('projects.json','projects.json.backup','remote-settings.json','session-host-id','Preferences','Local State','Local Storage','Session Storage','update-draft.json')) {
    $item=Join-Path $update.directory $name
    if(Test-Path -LiteralPath $item){Copy-Item -LiteralPath $item -Destination (Join-Path $settingsBackup $name) -Recurse}
  }
  $index=0
  foreach($project in $update.projectPaths) {
    $metadata=Join-Path $project '.llm-collaboration'
    if(Test-Path -LiteralPath $metadata){Copy-Item -LiteralPath $metadata -Destination (Join-Path $backup ('project-' + $index)) -Recurse};$index++
  }
  if(-not $update.portable){Copy-Item -LiteralPath ([IO.Path]::GetDirectoryName($target)) -Destination (Join-Path $backup 'installed-app') -Recurse}
  if((Hash $source) -ne $update.sha256){throw 'Update source changed before installation'}
  Status 'installing'
  if($update.portable){
    Copy-Item -LiteralPath $source -Destination $staged
    if((Hash $staged) -ne $update.sha256){throw 'Staged executable verification failed'}
    [IO.File]::Replace($staged,$target,(Join-Path $backup 'replaced.exe'));$swapped=$true
    if((Hash $target) -ne $update.sha256){throw 'Installed executable verification failed'}
  } else {
    $swapped=$true
    $installer=Start-Process -FilePath $source -ArgumentList '/S' -WindowStyle Hidden -PassThru
    $installer.WaitForExit(); if($installer.ExitCode -ne 0){throw ('Installer exit ' + $installer.ExitCode)}
  }
  Status 'starting'
  $env:LLM_COLLAB_UPDATE_HANDOFF=$Manifest
  $restarted=Start-Process -FilePath $target -WindowStyle Normal -PassThru
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  do {
    if(Test-Path -LiteralPath $readyFile){
      $ready=Get-Content -LiteralPath $readyFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if($ready.version -eq $update.version -and $ready.nonce -eq $update.nonce -and $ready.ui.sidebarViewport -and $ready.ui.independentScroll -and $ready.ui.draftRestored){try{Status 'complete'}catch{};exit 0}
    }
    if([DateTime]::UtcNow -gt $deadline){throw 'The restarted application did not confirm successful startup'}
    Start-Sleep -Milliseconds 200
  } while($true)
} catch {
  $failure=$_.Exception.Message
  if($swapped){
    try {
      if($restarted -and -not $restarted.HasExited){
        $owned=Get-CimInstance Win32_Process | Where-Object {$_.ParentProcessId -eq $restarted.Id -and $_.Name -eq 'LLM Collaboration.exe'}
        foreach($ownedProcess in $owned){$normal=Get-Process -Id $ownedProcess.ProcessId -ErrorAction SilentlyContinue;if($normal){$null=$normal.CloseMainWindow()}}
        $null=$restarted.CloseMainWindow()
      }
      $deadline=[DateTime]::UtcNow.AddSeconds(30)
      while(-not (Unlocked $target)){if([DateTime]::UtcNow -gt $deadline){throw 'Rollback is waiting for normal exit; backup was preserved'};Start-Sleep -Milliseconds 200}
      if($update.portable){Copy-Item -LiteralPath $oldExe -Destination $staged;[IO.File]::Replace($staged,$target,(Join-Path $backup 'failed-update.exe'))}
      else {Get-ChildItem -LiteralPath (Join-Path $backup 'installed-app') | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination ([IO.Path]::GetDirectoryName($target)) -Recurse -Force}}
      if((Hash $target) -ne $update.targetHash){throw 'Rollback executable verification failed'}
      Remove-Item Env:LLM_COLLAB_UPDATE_HANDOFF -ErrorAction SilentlyContinue
      Start-Process -FilePath $target -WindowStyle Normal
      Status 'rolled-back' $failure
    } catch {Status 'rollback-blocked' ($failure + '; ' + $_.Exception.Message)}
  } else {
    if($trustedOriginal -and -not (Get-Process -Id $update.runtimePid -ErrorAction SilentlyContinue) -and (Unlocked $target)) {
      Remove-Item Env:LLM_COLLAB_UPDATE_HANDOFF -ErrorAction SilentlyContinue
      Start-Process -FilePath $target -WindowStyle Normal
    }
    Status 'failed' $failure
  }
  exit 1
}
`;
