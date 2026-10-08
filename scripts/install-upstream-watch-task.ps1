# Creates a low-privilege, weekly, login-session-only Windows Task Scheduler task.
# Does NOT start new Docker containers or update production.
$ErrorActionPreference = 'Stop'
$script = (Resolve-Path (Join-Path $PSScriptRoot 'check-upstreams.ps1')).Path
$taskName = 'BabyTracker - Upstream Release Watch'
$powershell = Join-Path $PSHOME 'powershell.exe'
$action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $script + '"')
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '09:00'
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Description 'Checks Baby Buddy and Sprout Track release tags and files BabyTracker GitHub review issues. Does not update production.' -Force | Out-Null
Write-Host "TASK_INSTALLED=$taskName"
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
