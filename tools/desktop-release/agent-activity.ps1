# Display-only trace. No arguments, credentials or private reasoning are rendered.
# 单行持续刷新：默认显示最新一步；刚学到经验时让那条学习行短暂优先显示，
# 否则它会被紧随其后的工具调用顶掉，玩家看不到“学到了什么”。
function Select-AgentActivityRow($rows,[int]$stickyMs=5000){
 $all=@($rows|Where-Object {$_ -and $_.id})
 if(!$all.Count){return @()}
 $learn=$all | Where-Object {[string]$_.topic -eq '我记点经验'} | Select-Object -Last 1
 if($learn -and $null -ne $learn.at){
  try{$age=([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())-[double]$learn.at;if($age -ge 0 -and $age -lt $stickyMs){return @($learn)}}catch{}
 }
 # 规定：动态只占一行，随事件持续刷新（事件已并入这里，不再单独开一行/一块）。
 # 视图里的行是「最新在前」，取第一条就是最新。
 $active=$all | Where-Object {$_.phase -eq 'running'} | Select-Object -First 1
 if($active){return @($active)}
 return @($all | Select-Object -First 1)
}
foreach($name in @('AgentActivityPanel','AgentActivityScroll','AgentActivityRows','AgentActivityLatest')){$controls[$name]=$window.FindName($name)}
$script:activityRevision=-1;$script:activityScope='';$script:activityNodes=@{};$script:activityFollow=$true;$script:activityRendering=$false;$script:activityJob=$null
$controls.ActivityMenuItem=New-Object Windows.Controls.MenuItem
$controls.ActivityMenuItem.Header='显示智能体当前步骤';$controls.ActivityMenuItem.IsCheckable=$true
$controls.ActivityMenuItem.ToolTip='在大框战况页单行显示智能体当前步骤，随进度替换；网页设置中也可以开启。'
$controls.SettingsButton.ContextMenu.Items.Add($controls.ActivityMenuItem)|Out-Null
function Update-ActivityJump {
 $scroll=$controls.AgentActivityScroll
 $controls.AgentActivityLatest.Visibility=if(!$script:activityFollow -and $scroll.ScrollableHeight-$scroll.VerticalOffset -gt 8){'Visible'}else{'Collapsed'}
}
$controls.AgentActivityScroll.Add_ScrollChanged({param($sender,$e)
 if(!$script:activityRendering -and $e.VerticalChange -ne 0){$script:activityFollow=$sender.ScrollableHeight-$sender.VerticalOffset -lt 12}
 Update-ActivityJump
})
$controls.AgentActivityLatest.Add_Click({$script:activityFollow=$true;$controls.AgentActivityScroll.ScrollToEnd();Update-ActivityJump})
$controls.ActivityMenuItem.Add_Click({
 if($script:activityJob){return}
 try{
  $link=[IO.File]::ReadAllText((Join-Path $StateDir 'settings-link.txt')).Trim()
  if($link -notmatch '^http://127\.0\.0\.1:[0-9]+/#[a-f0-9]{64}$'){throw 'invalid local link'}
  $uri=[Uri]$link;$endpoint=$uri.GetLeftPart([UriPartial]::Authority)+'/api/agent-activity'
  $body=@{enabled=[bool]$controls.ActivityMenuItem.IsChecked}|ConvertTo-Json -Compress
  $script:activityJob=Start-Job -ArgumentList $endpoint,$uri.Fragment.Substring(1),$body -ScriptBlock {
   param($endpoint,$nonce,$body)
   try{Invoke-RestMethod -Uri $endpoint -Method Post -Headers @{'x-jinbao-setup'=$nonce} -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 5|Out-Null;@{ok=$true}}catch{@{ok=$false}}
  }
  $controls.ActivityMenuItem.IsEnabled=$false
 }catch{$controls.HintText.Text='设置保存失败，请在网页设置中重试。'}
})
function New-AgentActivityEquipment($equipment,[double]$size=16){
 $panel=New-Object Windows.Controls.StackPanel
 $panel.Orientation='Horizontal';$panel.VerticalAlignment='Center';$panel.Margin='0,0,4,0'
 $hero=[string]$equipment.hero
 $avatar=New-Object Windows.Controls.Border
 $avatar.Width=$size;$avatar.Height=$size;$avatar.CornerRadius=[Windows.CornerRadius]::new([double]($size/2))
 $avatar.Margin='0,0,3,0';$avatar.VerticalAlignment='Center';$avatar.ToolTip=$hero
 $image=Get-ChampionIconImage $hero
 if($image){$brush=New-Object Windows.Media.ImageBrush($image);$brush.Stretch=[Windows.Media.Stretch]::UniformToFill;$avatar.Background=$brush}
 else{
  $avatar.Background=New-OverlaySurfaceBrush '#2A3642'
  $initial=New-OverlayLabel $(if($hero){$hero.Substring(0,1)}else{'?'}) 8 '#C9D3DD'
  $initial.TextWrapping='NoWrap';$initial.LineHeight=11;$initial.HorizontalAlignment='Center';$initial.VerticalAlignment='Center';$avatar.Child=$initial
 }
 $panel.Children.Add($avatar)|Out-Null
 foreach($item in @($equipment.items)){
  if(!$item -or !$item.id){continue}
  $panel.Children.Add((New-OverlayItemTile ([string]$item.id) ([string]$item.name)))|Out-Null
 }
 return $panel
}
function Set-AgentActivityEquipment($line,$equipment){
 $line.Inlines.Clear()
 $container=New-Object Windows.Documents.InlineUIContainer
 $container.Child=(New-AgentActivityEquipment $equipment 16)
 $line.Inlines.Add($container)
 $line.Inlines.Add((New-Object Windows.Documents.Run(' ')))
}
function Update-AgentActivity {
 if($script:activityJob -and $script:activityJob.State -ne 'Running'){
  $result=Receive-Job $script:activityJob -ErrorAction SilentlyContinue;Remove-Job $script:activityJob -Force -ErrorAction SilentlyContinue;$script:activityJob=$null
  if(!$result.ok){$controls.HintText.Text='设置保存失败，请在网页设置中重试。'}
 }
 $activity=$script:snapshot.agentActivity
 $scope=([string]$activity.instanceId)+'|'+([string]$script:snapshot.game)+'|'+([string]$script:snapshot.match)
 if($scope -ne $script:activityScope){$script:activityScope=$scope;$script:activityRevision=-1;$script:activityFollow=$true;$script:activityNodes=@{};$controls.AgentActivityRows.Children.Clear()}
 $controls.ActivityMenuItem.IsEnabled=($activity.supported -eq $true -and !$script:activityJob)
 if(!$script:activityJob){$controls.ActivityMenuItem.IsChecked=$activity.enabled -eq $true}
 $visible=$activity.enabled -eq $true -and $script:tab -eq 'advice' -and $script:displayMode -eq 'large' -and !$script:collapsed
 $controls.AgentActivityPanel.Visibility=if($visible){'Visible'}else{'Collapsed'}
 $controls.AgentActivityPanel.Height=27;$controls.AgentActivityPanel.MaxHeight=27
 if(!$activity.enabled){$controls.AgentActivityRows.Children.Clear();$script:activityNodes=@{};$script:activityRevision=-1;return}
 if(!$visible -or $script:activityRevision -eq $activity.revision){return}
 $script:activityRevision=$activity.revision;$scroll=$controls.AgentActivityScroll;$offset=$scroll.VerticalOffset
 $script:activityRendering=$true
 try{
  $rows=@(Select-AgentActivityRow $activity.rows 5000);$ids=@{}
  foreach($row in $rows){
   $id=[string]$row.id;$ids[$id]=$true
   if(!$script:activityNodes.ContainsKey($id)){
    $line=New-Object Windows.Controls.TextBlock;$line.TextWrapping='NoWrap';$line.TextTrimming='CharacterEllipsis';$line.FontSize=10.5;$line.LineHeight=15;$line.Margin='0,2,6,3'
    $script:activityNodes[$id]=$line;$controls.AgentActivityRows.Children.Add($line)|Out-Null
   }
   $line=$script:activityNodes[$id]
   $phase=switch([string]$row.phase){'running'{'进行中'}'queued'{'等待'}'done'{'完成'}'failed'{'失败'}'unavailable'{'不可用'}'cancelled'{'已取消'}'draft'{'草稿'}default{''}}
   $duration=if($null -ne $row.elapsedMs){' · '+([Math]::Round([double]$row.elapsedMs/1000,1))+'秒'}else{''}
   $learn=([string]$row.topic -eq '我记点经验')
   $line.ToolTip=([string]$row.clock)+'  '+([string]$row.label)+$(if($row.phase -in @('failed','unavailable','cancelled')){' · '+$phase+$duration}else{''})
   $lineText=if($learn){'✔ '+([string]$row.label)}else{([string]$row.clock)+'  '+([string]$row.label)+$(if($row.task -eq 'events'){''}elseif($row.phase -in @('failed','unavailable','cancelled')){' · '+$phase+$duration}else{''})}
   if($row.equipment){
    Set-AgentActivityEquipment $line $row.equipment
    $line.Inlines.Add((New-Object Windows.Documents.Run($lineText)))
   }else{$line.Text=$lineText}
   # row.text is deliberately not rendered: it is what made each entry several lines.
   $line.Foreground=if($row.task -eq 'events'){switch -Regex ([string]$row.kind){'augment'{'#C8A6FF'}'inventory|purchase'{'#E7BE79'}'Ace|kill|Kill|Death|death'{'#F5AD91'}default{'#7FD1A0'}}}elseif($learn){'#7FD1A0'}else{switch([string]$row.phase){'running'{'#E7BE79'}'failed'{'#F5AD91'}'draft'{'#AEBECE'}default{'#94A3B8'}}}
  }
  foreach($id in @($script:activityNodes.Keys)){if(!$ids.ContainsKey($id)){$controls.AgentActivityRows.Children.Remove($script:activityNodes[$id]);$script:activityNodes.Remove($id)}}
  if(!$rows.Count){$line=New-Object Windows.Controls.TextBlock;$line.Text='等待新事件或下一步分析';$line.Foreground='#94A3B8';$line.FontSize=11;$line.TextWrapping='NoWrap';$line.TextTrimming='CharacterEllipsis';$controls.AgentActivityRows.Children.Clear();$controls.AgentActivityRows.Children.Add($line)|Out-Null}
  elseif($controls.AgentActivityRows.Children.Count -gt $script:activityNodes.Count){for($i=$controls.AgentActivityRows.Children.Count-1;$i -ge 0;$i--){if($controls.AgentActivityRows.Children[$i] -notin @($script:activityNodes.Values)){$controls.AgentActivityRows.Children.RemoveAt($i)}}}
  $scroll.UpdateLayout();if($script:activityFollow){$scroll.ScrollToEnd()}else{$scroll.ScrollToVerticalOffset($offset)}
 }finally{$script:activityRendering=$false}
 Update-ActivityJump
}
$window.Add_Closed({if($script:activityJob){Stop-Job $script:activityJob -ErrorAction SilentlyContinue;Remove-Job $script:activityJob -Force -ErrorAction SilentlyContinue;$script:activityJob=$null}})
function Test-AgentActivitySurface {
 $before=$script:snapshot
 $script:snapshot=$script:snapshot|ConvertTo-Json -Depth 12|ConvertFrom-Json
 $activity=@{supported=$true;enabled=$true;revision=1;rows=@(1..40|ForEach-Object {@{id="trace-$_";topic='主动提醒';clock='08:32';label="读取关键事件 $_";phase='done';elapsedMs=400}})}
 $script:snapshot|Add-Member -Force NoteProperty agentActivity $activity
 Set-DisplayMode 'large';Set-Tab 'advice';Update-AgentActivity;$window.UpdateLayout()
 $script:testResult.activityLargeOnly=$controls.AgentActivityPanel.IsVisible -and $controls.AgentActivityRows.Children.Count -eq 1 -and $controls.AgentActivityPanel.ActualHeight -le 27
 $node=$script:activityNodes['trace-1'];$controls.AgentActivityScroll.ScrollToTop();$window.UpdateLayout();$script:activityFollow=$false
 $activity.rows[0].label='读取阵容完成';$activity.revision++;Update-AgentActivity;$window.UpdateLayout()
 $script:testResult.activityIncremental=$node -eq $script:activityNodes['trace-1'] -and $node.Text.Contains('读取阵容完成')
 $script:testResult.activityScrollHeld=$controls.AgentActivityScroll.ScrollableHeight -le 1 -and $controls.AgentActivityLatest.Visibility -eq 'Collapsed'
 $controls.AgentActivityLatest.RaiseEvent((New-Object Windows.RoutedEventArgs([Windows.Controls.Button]::ClickEvent)));$window.UpdateLayout()
 $script:testResult.activityLatestWorks=$controls.AgentActivityScroll.ScrollableHeight-$controls.AgentActivityScroll.VerticalOffset -lt 2
 $activity.instanceId='restarted-backend';$activity.rows=@();Update-AgentActivity
 $script:testResult.activityRestartClears=$script:activityNodes.Count -eq 0 -and !$controls.AgentActivityRows.Children[0].Text.Contains('读取关键事件')
 Set-Tab 'players';$script:testResult.activityHiddenOtherPage=$script:tab -eq 'advice' -and $controls.AgentActivityPanel.Visibility -eq 'Visible'
 Set-Tab 'advice';Set-DisplayMode 'narrow';$script:testResult.activityHiddenNarrow=$controls.AgentActivityPanel.Visibility -eq 'Collapsed'
 Set-DisplayMode 'large';$activity.enabled=$false;Update-AgentActivity
 $script:testResult.activityOffClears=$controls.AgentActivityPanel.Visibility -eq 'Collapsed' -and $controls.AgentActivityRows.Children.Count -eq 0
 $activity.enabled=$false;$activity.rows=@();$activity.instanceId='equipment-test'
 $equipTest=[pscustomobject]@{hero='皮城女警';items=@([pscustomobject]@{id='3031';name='无尽之刃'})}
 $equipPanel=New-AgentActivityEquipment $equipTest 16
 $script:testResult.activityEquipmentInline=($null -ne $equipPanel) -and ($equipPanel.Children.Count -ge 2)
 $script:snapshot=$before;Update-Page
}
