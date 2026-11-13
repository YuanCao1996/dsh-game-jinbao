# A message owns its playback cursor until completed, explicitly interrupted by
# urgency, or the match changes. Queue age is not a playback timeout.
$script:playbackPhase='idle';$script:lineElapsed=0.0;$script:playbackLastTick=0L
$script:scrollOffset=0.0;$script:scrollEnd=0.0;$script:playbackAccelerated=$false
$script:subtitleRows=New-Object 'Collections.Generic.List[string]'
$script:renderedSubtitleMode=$true;$script:playbackLayoutDirty=$false;$script:playbackInitialized=$false
function Get-PlaybackNow {
 if($SelfTest -and $null -ne $script:playbackTestNow){return [double]$script:playbackTestNow}
 return [double][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
function Clear-PlaybackRows {
 $script:subtitleRows.Clear()
 foreach($name in @('NarrowText','PreviousSubtitle','OutgoingSubtitle')){
  $view=$controls[$name];if(!$view){continue};$view.BeginAnimation([Windows.UIElement]::OpacityProperty,$null);$view.Tag=$null;$view.Text='';$view.Opacity=1;$view.Visibility='Visible';$view.RenderTransform=New-Object Windows.Media.TranslateTransform
 }
 $controls.NarrowCanvas.BeginAnimation([Windows.UIElement]::OpacityProperty,$null);$controls.NarrowCanvas.Opacity=1
}
# 字幕/滚动都按这个宽度排版。面板刚展开时 ActualWidth 仍是 0，用 120 兜底会把一句话
# 切成很多碎行、滚动终点也算成 0；先强制一次布局，再退回按窗口宽度推算。
function Get-NarrowWidth {
  $width=0
  try{$width=[double]$controls.NarrowCanvas.ActualWidth}catch{}
  if($width -lt 160){try{$window.UpdateLayout()}catch{};try{$width=[double]$controls.NarrowCanvas.ActualWidth}catch{}}
  if($width -lt 160){try{$width=[double]$window.Width-40}catch{$width=0}}
  return [Math]::Max(160,$width)
}
function Set-NarrowMetrics {
 $size=[double]$controls.FontSlider.Value
 # 字幕/跑马灯比正文大半号：收起后只有这一行，抬一眼就要看清（原来完全跟随正文字号，最小只有 11）。
 $subtitleSize=[Math]::Min(24,$size+1)
 foreach($name in @('NarrowText','PreviousSubtitle','OutgoingSubtitle')){if($controls[$name]){$controls[$name].FontSize=$subtitleSize}}
 $script:subtitleRowHeight=[Math]::Ceiling($subtitleSize*1.6+4)
 # 收起时如果是字幕模式，也要排字幕条尺寸（原来收起后不再排版，结果停在 56×56）。
 if($script:displayMode -eq 'narrow' -and (!$script:collapsed -or $script:subtitleMode)){
  $window.MinWidth=[Math]::Min(260,$area.Width-20);$window.MinHeight=40
  $window.Width=[Math]::Min([Math]::Max($window.MinWidth,$script:narrowWidth),$area.Width-20)
  $window.Height=if($script:subtitleMode){2*$script:subtitleRowHeight+24}else{$script:subtitleRowHeight+24}
  $controls.MainBorder.Padding=if($script:subtitleMode){'8,6'}else{'12,8'}
  if($script:subtitleMode){$controls.MainBorder.Background=[Windows.Media.Brushes]::Transparent;$controls.MainBorder.BorderThickness=0}
  else{Set-BackgroundOpacity;$controls.MainBorder.BorderThickness=1}
  $window.Left=[Math]::Max($area.Left,[Math]::Min($window.Left,$area.Right-$window.Width))
  $window.Top=[Math]::Max($area.Top,[Math]::Min($window.Top,$area.Bottom-$window.Height))
 }
 $script:playbackLayoutDirty=$true
}
function Split-Subtitle([string]$value,[double]$width){
 $measure=New-Object Windows.Controls.TextBlock;$measure.FontSize=$controls.NarrowText.FontSize;$measure.FontFamily=$controls.NarrowText.FontFamily
 $lines=New-Object 'Collections.Generic.List[string]';$line='';$value=$value.Replace("`r`n","`n").Replace("`r","`n")
 $words=@($script:snapshot.keywords|Where-Object {$_ -and $_.Length -ge 2}|Sort-Object Length -Descending|Select-Object -First 64)
 $position=0
 while($position -lt $value.Length){
  $part=[Globalization.StringInfo]::GetNextTextElement($value,$position)
  foreach($word in $words){if($value.Substring($position).StartsWith([string]$word,[StringComparison]::Ordinal)){$measure.Text=[string]$word;$measure.Measure((New-Object Windows.Size([double]::PositiveInfinity,[double]::PositiveInfinity)));if($measure.DesiredSize.Width -le $width){$part=[string]$word};break}}
  # 数字与单位、No.22、15/6/16 这类整体不拆开，避免「53.5」和「%」分到两行。
  $numberMatch=[regex]::Match($value.Substring($position),'^(?:No\.\d+|\d+/\d+/\d+|\d+(?:\.\d+)?(?:%|秒|分钟|杀|个|层)?)')
  if($numberMatch.Success -and $numberMatch.Value.Length -gt 1){$part=$numberMatch.Value}
  $position+=$part.Length
  if($part -eq "`n"){if($line){$lines.Add($line);$line=''};continue}
  $measure.Text=$line+$part;$measure.Measure((New-Object Windows.Size([double]::PositiveInfinity,[double]::PositiveInfinity)))
  # 中文排版：标点不放在行首，宁可让它跟着上一行一起断。
  $punctuation='，。；！？、：）】”'
  if($line -and $measure.DesiredSize.Width -gt $width){
   if($punctuation.Contains($part)-and $line.Length -gt 1){$lines.Add($line+$part);$line='';continue}
   # 宽度超了先找语义边界：从行尾往回找最近的标点或分隔符，尽量不在词中间断开。
   $cut=-1
   for($k=$line.Length-1;$k -ge 1;$k--){if('，。；！？、：·｜| '.Contains($line[$k])){$cut=$k;break}}
   if($cut -ge [Math]::Max(2,[int]($line.Length*0.5))){
    $lines.Add($line.Substring(0,$cut+1))
    $line=$line.Substring($cut+1)+$part
   }else{
    $lines.Add($line);$line=$part
   }
  }else{$line+=$part}
 }
 if($line){$lines.Add($line)};return $lines.ToArray()
}
function Push-Subtitle([string]$line,[bool]$animate=$true){
 $characters=0;$elements=[Globalization.StringInfo]::GetTextElementEnumerator($line);while($elements.MoveNext()){$characters++}
  # 句号/问号结尾多停一会儿，逗号处略停，读起来更像说话。
 $tailBonus=if($line -match '[。！？]$'){600}elseif($line -match '[，；：]$'){250}else{0}
 $script:subtitleBaseHold=[Math]::Max(900,[Math]::Min(4200,950+$characters*75+$tailBonus))
 $script:subtitleRows.Add($line);while($script:subtitleRows.Count -gt 3){$script:subtitleRows.RemoveAt(0)}
 $height=$script:subtitleRowHeight;$duration=if($script:playbackAccelerated){120}else{240}
 $names=@('OutgoingSubtitle','PreviousSubtitle','NarrowText');$count=$script:subtitleRows.Count
 for($i=0;$i -lt 3;$i++){
  $view=$controls[$names[$i]];if(!$view){continue};$index=$count-3+$i
  $view.BeginAnimation([Windows.UIElement]::OpacityProperty,$null);$view.RenderTransform=New-Object Windows.Media.TranslateTransform
  if($index -lt 0){$view.Text='';$view.Tag=$null;continue}
  # 字幕模式只显示两行：最旧那行（Outgoing）留空，视线上只有上一句和当前句。
  if($i -eq 0 -and $script:subtitleMode){$view.Text='';$view.BeginAnimation([Windows.UIElement]::OpacityProperty,$null);$view.Opacity=0;continue}
  Set-HighlightedText $view $script:subtitleRows[$index]
  $view.Width=(Get-NarrowWidth);$view.TextAlignment='Center'
  [Windows.Controls.Canvas]::SetTop($view,($i-1)*$height);[Windows.Controls.Canvas]::SetLeft($view,0)
  $view.Opacity=if($i -eq 0){0}else{1}
  if($animate -and !$SelfTest){
   $shift=New-Object Windows.Media.Animation.DoubleAnimation;$shift.From=$height;$shift.To=0;$shift.Duration=[TimeSpan]::FromMilliseconds($duration)
   $view.RenderTransform.BeginAnimation([Windows.Media.TranslateTransform]::YProperty,$shift)
   if($i -ne 1){$fade=New-Object Windows.Media.Animation.DoubleAnimation;$fade.From=if($i -eq 0){1}else{0};$fade.To=if($i -eq 0){0}else{1};$fade.Duration=[TimeSpan]::FromMilliseconds($duration);$view.BeginAnimation([Windows.UIElement]::OpacityProperty,$fade)}
  }
 }
}
function Prepare-PlaybackLayout([bool]$resume=$false){
 $sameScroll=$resume -and !$script:renderedSubtitleMode -and !$script:subtitleMode
 $remaining=([string]$script:activePlayback.text -replace '\s*\r?\n\s*','  ')
 if($resume -and $script:renderedSubtitleMode -and $script:subtitleLines.Count -and $script:subtitleIndex -lt $script:subtitleLines.Count){
  $remaining=($script:subtitleLines[$script:subtitleIndex..($script:subtitleLines.Count-1)] -join '')
 }elseif($resume -and !$script:renderedSubtitleMode -and $script:scrollText){
  $remaining=$script:scrollText
  if($script:subtitleMode){
   # Only skip text that has completely passed the left edge; keep visible text.
   $measure=New-Object Windows.Controls.TextBlock;$measure.FontSize=$controls.NarrowText.FontSize;$measure.FontFamily=$controls.NarrowText.FontFamily
   $offset=0;$next=0
   while($next -lt $remaining.Length){
    $next+=[Globalization.StringInfo]::GetNextTextElement($remaining,$next).Length
    $measure.Text=$remaining.Substring(0,$next);$measure.Measure((New-Object Windows.Size([double]::PositiveInfinity,[double]::PositiveInfinity)))
    if($measure.DesiredSize.Width -gt $script:scrollOffset){break};$offset=$next
   }
   $remaining=$remaining.Substring($offset)
  }
 }
 if($resume -or !$script:subtitleMode -or $script:renderedSubtitleMode -ne $script:subtitleMode){Clear-PlaybackRows}
 $script:renderedSubtitleMode=$script:subtitleMode;$script:playbackLayoutDirty=$false
 $width=(Get-NarrowWidth)
 if($script:subtitleMode){
  $script:subtitleLines=@(Split-Subtitle $remaining $width);$script:subtitleIndex=0
  if($script:subtitleLines.Count){Push-Subtitle $script:subtitleLines[0]}
 }else{
  $controls.PreviousSubtitle.Visibility='Collapsed';$controls.OutgoingSubtitle.Visibility='Collapsed'
  $controls.NarrowText.Width=[double]::NaN;$controls.NarrowText.TextAlignment='Left'
  [Windows.Controls.Canvas]::SetTop($controls.NarrowText,0);[Windows.Controls.Canvas]::SetLeft($controls.NarrowText,0)
  $script:scrollText=$remaining
  Set-HighlightedText $controls.NarrowText $remaining
  $controls.NarrowText.Measure((New-Object Windows.Size([double]::PositiveInfinity,[double]::PositiveInfinity)))
  $script:scrollEnd=[Math]::Max(0,$controls.NarrowText.DesiredSize.Width-$width)
  $script:scrollOffset=if($sameScroll){[Math]::Min($script:scrollOffset,$script:scrollEnd)}else{0}
  $controls.NarrowText.RenderTransform.X=-$script:scrollOffset
 }
 $script:lineElapsed=0;$script:playbackPhase='playing';$script:playbackLastTick=Get-PlaybackNow
}
function Wake-NarrowPlayback {
 try{Log-OverlayState 'wake'}catch{}
 if($script:collapsed){Set-Collapsed $false -PreserveMode;Set-NarrowMetrics;$window.UpdateLayout()}
 $controls.NarrowCanvas.BeginAnimation([Windows.UIElement]::OpacityProperty,$null);$controls.NarrowCanvas.Opacity=1
 $script:playbackLastTick=Get-PlaybackNow;$modeClock.Start()
}
function Finish-Playback {
 $script:activePlayback=$null;$script:playbackPhase='idle';$script:lineElapsed=0;$script:playbackAccelerated=$false
}
function Reset-Playback {
 Finish-Playback;$script:playbackQueue.Clear();$script:subtitleLines=@();$script:subtitleIndex=0;Clear-PlaybackRows;$modeClock.Stop()
}
function Remove-InvalidPlayback($revoked,$now) {
 for($i=$script:playbackQueue.Count-1;$i -ge 0;$i--){
  $item=$script:playbackQueue[$i]
  if(([string]$item.id -in $revoked) -or ($item.expiresAt -and $now -ge [double]$item.expiresAt)){$script:playbackQueue.RemoveAt($i)}
 }
 $item=$script:activePlayback
 if($item -and (([string]$item.id -in $revoked) -or ($item.expiresAt -and $now -ge [double]$item.expiresAt))){
  Finish-Playback;Clear-PlaybackRows
  if($script:synth){$script:synth.SpeakAsyncCancelAll()}
 }
}
function Add-PlaybackMessage($message){
 if($message.expiresAt -and (Get-PlaybackNow) -ge [double]$message.expiresAt){return}
 $normalized=([string]$message.text).Trim()
 if(!$normalized){return}
 if($script:activePlayback -and ([string]$script:activePlayback.text).Trim() -eq $normalized -and [int]$script:activePlayback.priority -eq [int]$message.priority){return}
 foreach($pending in $script:playbackQueue){if(([string]$pending.text).Trim() -eq $normalized -and [int]$pending.priority -eq [int]$message.priority){return}}
 if([int]$message.priority -ge 2){Finish-Playback;Clear-PlaybackRows;$script:playbackQueue.Insert(0,$message)}
 else{$script:playbackQueue.Add($message);if($script:activePlayback){$script:playbackAccelerated=$true}}
 if($script:displayMode -eq 'narrow'){Wake-NarrowPlayback;Playback-Tick}
}
function Playback-Tick {
 if($script:displayMode -ne 'narrow' -or $script:closing){$modeClock.Stop();return}
 $now=Get-PlaybackNow
 if($settingsMenu.IsOpen -or $quickConfirm.IsOpen -or ($script:overlayModeMenu -and $script:overlayModeMenu.IsOpen) -or $script:dragging){$script:playbackLastTick=$now;return}
 $delta=[Math]::Max(0,$now-$script:playbackLastTick);$script:playbackLastTick=$now
 if(!$script:activePlayback -and $script:playbackQueue.Count){
  $script:awaitingPlayback=$false
  $script:activePlayback=$script:playbackQueue[0];$script:playbackQueue.RemoveAt(0);$script:playbackAccelerated=$script:playbackQueue.Count -gt 0
  Prepare-PlaybackLayout;$delta=0
 }elseif($script:activePlayback -and $script:playbackLayoutDirty){Prepare-PlaybackLayout $true;$delta=0}
 if(!$script:activePlayback){
  if($script:awaitingPlayback -and !$script:collapsed){
   Clear-PlaybackRows
   $controls.NarrowText.Width=(Get-NarrowWidth);$controls.NarrowText.TextAlignment='Center'
   [Windows.Controls.Canvas]::SetTop($controls.NarrowText,0);[Windows.Controls.Canvas]::SetLeft($controls.NarrowText,0)
   # 没有新播报时保留上一条消息，不显示「等待新的对局建议…」占位。
   $modeClock.Stop();return
  }
  $modeClock.Stop();Clear-PlaybackRows
  # 空闲时保持用户选定的形态：这里以前会 Set-Collapsed，播报一停就缩走，
  # 下一条播报又自动展开，表现为「消失一会儿又自己恢复」。
  if($script:displayMode -eq 'narrow'){
   try{
    # 空闲时保留上一条消息，不再写「金宝待命中」占位。
    $controls.NarrowText.Foreground='#DDE5EE'
    $controls.NarrowCanvas.BeginAnimation([Windows.UIElement]::OpacityProperty,$null)
    $controls.NarrowCanvas.Opacity=1
   }catch{}
  }
  return
 }
 # 按积压条数分级加速：一条积压略快，多积压明显缩短，避免长句把整队拖住。
 $backlog=$script:playbackQueue.Count
 $script:paceFactor=if($backlog -ge 3){1.9}elseif($backlog -eq 2){1.55}elseif($backlog -eq 1){1.25}else{1.0}
 $previousElapsed=$script:lineElapsed;$script:lineElapsed+=$delta
 if($script:playbackPhase -eq 'playing'){
  if($script:subtitleMode){
   if(!$script:subtitleLines.Count){$script:playbackPhase='linger';$script:lineElapsed=0;return}
   $line=$script:subtitleLines[$script:subtitleIndex]
   $hold=[Math]::Max(900,[double]$script:subtitleBaseHold/$script:paceFactor)
   if($script:lineElapsed -ge $hold){
    if($script:subtitleIndex+1 -lt $script:subtitleLines.Count){$script:subtitleIndex++;Push-Subtitle $script:subtitleLines[$script:subtitleIndex];$script:lineElapsed=0}
    else{$script:playbackPhase='linger';$script:lineElapsed=0}
   }
  }else{
   # 长句必须留够阅读时间（回归用例明确要求 600 字的滚动不能被"抢进度"冲完），
   # 所以速度只跟积压走：基础 52px/s，按积压因子加速。
   $delay=if($script:paceFactor -gt 1){180}else{400}
   $speed=52*$script:paceFactor
   $travel=[Math]::Max(0,$script:lineElapsed-$delay)-[Math]::Max(0,$previousElapsed-$delay)
   $script:scrollOffset=[Math]::Min($script:scrollEnd,$script:scrollOffset+$travel/1000*$speed)
   $controls.NarrowText.RenderTransform.X=-$script:scrollOffset
   if($script:scrollOffset -ge $script:scrollEnd){$script:playbackPhase='linger';$script:lineElapsed=0}
  }
 }elseif($script:playbackPhase -eq 'linger'){
  $readHold=if(!$script:subtitleMode -and $script:scrollEnd -eq 0){[Math]::Max(1600,[Math]::Min(5000,800+([string]$script:scrollText).Length*100))}else{1200}
  if($script:playbackQueue.Count -and $script:lineElapsed -ge $readHold){Finish-Playback;Playback-Tick}
  elseif(!$script:playbackQueue.Count -and $script:lineElapsed -ge 3000){
   $script:playbackPhase='fade';$script:lineElapsed=0
   if(!$SelfTest){$fade=New-Object Windows.Media.Animation.DoubleAnimation;$fade.From=1;$fade.To=0;$fade.Duration=[TimeSpan]::FromMilliseconds(280);$controls.NarrowCanvas.BeginAnimation([Windows.UIElement]::OpacityProperty,$fade)}
  }
 }elseif($script:playbackPhase -eq 'fade'){
  if($script:playbackQueue.Count){Finish-Playback;Playback-Tick}
  elseif($script:lineElapsed -ge 280){
   Finish-Playback;Clear-PlaybackRows
   # 用户主动收起成字幕条时，播完保持条状并显示占位；之前这里会 Set-Collapsed，
   # 于是播完自动缩走、下一条播报又自动弹回来，看起来像"消失又自己恢复"。
   if($script:displayMode -eq 'narrow'){
    try{# 播完保留最后一条消息的外观，只把透明度恢复。
     $controls.NarrowCanvas.BeginAnimation([Windows.UIElement]::OpacityProperty,$null);$controls.NarrowCanvas.Opacity=1}catch{}
    $modeClock.Stop()
   }else{Set-Collapsed $true -PreserveMode;$modeClock.Stop()}
  }
 }
}
