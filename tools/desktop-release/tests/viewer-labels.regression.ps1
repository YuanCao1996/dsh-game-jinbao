$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'overlay-categories.ps1')
function Get-OverlayCategoryColor { return @{'观众提问'='#8FB4D8';'观众回复'='#93A3B4';'提问'='#8FB4D8'} }
$script:snapshot=@{}
foreach($case in @(
 @{row=@{role='user';origin='viewer';text='下一件出什么'};want='观众提问'},
 @{row=@{role='assistant';origin='viewer';text='先补装备'};want='观众回复'},
 @{row=@{role='user';origin='desktop';text='你好'};want='提问'}
)){
 $result=Get-OverlayTagCategory $case.row
 if($result.label -ne $case.want){throw 'Viewer label mismatch'}
 if(!$result.tags[0].color){throw 'Viewer label color missing'}
}
Write-Output 'viewer label regression passed: 3 cases'
