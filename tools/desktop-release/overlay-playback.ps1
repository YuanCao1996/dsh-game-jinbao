# A message owns its playback cursor until completed, explicitly interrupted by
# urgency, or the match changes. Queue age is not a playback timeout.
$script:playbackPhase='idle';$script:lineElapsed=0.0;$script:playbackLastTick=0L
$script:scrollOffset=0.0;$script:scrollEnd=0.0;$script:playbackAccelerated=$false
$script:subtitleRows=New-Object 'Collections.Generic.List[string]'
$script:renderedSubtitleMode=$true;$script:playbackLayoutDirty=$false;$script:playbackInitialized=$false;$script:narrowBarShown=$false;$script:barHideTimer=$null
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
  if($width -lt 160){$pad=40;if($script:narrowPetVisible){$pad+=$script:narrowPetSize+14};try{$width=[double]$window.Width-$pad}catch{$width=0}}
  return [Math]::Max(160,$width)
}
function Set-NarrowMetrics {
 # 只有窄条模式才允许改窗口尺寸：大框期间任何迟到的调用都不能把窗口缩成 126 宽。
 if($script:displayMode -ne 'narrow'){return}
 $size=[double]$controls.FontSlider.Value
 # 字幕/跑马灯比正文大半号：收起后只有这一行，抬一眼就要看清（原来完全跟随正文字号，最小只有 11）。
 $subtitleSize=[Math]::Min(24,$size+1)
 foreach($name in @('NarrowText','PreviousSubtitle','OutgoingSubtitle')){if($controls[$name]){$controls[$name].FontSize=$subtitleSize}}
 $script:subtitleRowHeight=[Math]::Ceiling($subtitleSize*1.6+4)
 # 气泡现在垂直居中了，Canvas 必须显式给高度：否则 Canvas 期望高度是 0，
 # Border 只剩 padding，文字全被 ClipToBounds 裁掉（实测「看不到文字」）。
 try{$controls.NarrowCanvas.Height=if($script:subtitleMode){2*$script:subtitleRowHeight}else{$script:subtitleRowHeight}}catch{}
 # 收起时如果是字幕模式，也要排字幕条尺寸（原来收起后不再排版，结果停在 56×56）。
 if($script:displayMode -eq 'narrow' -and (!$script:collapsed -or $script:subtitleMode)){
  # 全身模式需要更宽，否则人物会挤掉文字；头肩保持原来的最小宽度。
  # 气泡收起时窗口只包住形象，并贴屏幕最左边；有消息再向右展开。
  $petW=if($script:narrowPetDisplay -gt 0){[double]$script:narrowPetDisplay}else{[double]$script:narrowPetSize}
  if($script:narrowPetFrame -ne 'head'){$petW=[Math]::Round($petW*0.523)}
  $showBar=($script:narrowBarShown -or -not $script:narrowPetVisible)
  if($showBar){
    if($script:narrowPetFrame -eq 'full'){$minWidth=[Math]::Min([Math]::Max(300,[double]$script:narrowPetDisplay+300),$area.Width-20)}else{$minWidth=[Math]::Min(260,$area.Width-20)}
    $window.MinWidth=$minWidth;$window.MinHeight=40
    $window.Width=[Math]::Min([Math]::Max($window.MinWidth,$script:narrowWidth),$area.Width-20)
  }else{
    $window.MinWidth=[Math]::Max(48,$petW+16);$window.MinHeight=40
    $window.Width=$window.MinWidth
  }
  $window.Left=[double]([Math]::Max($area.Left,$area.Right-$window.Width))
  $rowHeight=if($script:subtitleMode){2*$script:subtitleRowHeight+24}else{$script:subtitleRowHeight+24}
  # 形象比一行字高：不把窗口撑开的话，调到 56/72 会被条子裁掉一半
  # 形象高度：局外全身更高，但气泡本身保持文字高度（NarrowBubble 居中）
  $petHeight=if($script:narrowPetDisplay -gt 0){$script:narrowPetDisplay}else{$script:narrowPetSize}
  if($script:narrowPetVisible){$rowHeight=[Math]::Max($rowHeight,[double]$petHeight+22)}

  # 全身模式下气泡贴住人物头部；否则垂直居中会落到腰上，看着离人很远。
  try {
    if ($script:narrowPetVisible -and $script:narrowPetFrame -eq 'full') {
      $controls.NarrowBubble.VerticalAlignment = 'Top'
      $controls.NarrowBubble.Margin = New-Object Windows.Thickness(0,16,4,0)
    } else {
      $controls.NarrowBubble.VerticalAlignment = 'Center'
      $controls.NarrowBubble.Margin = New-Object Windows.Thickness(0,1,4,1)
    }
  } catch {}
  $window.Height=$rowHeight
  $controls.MainBorder.Padding=if($script:subtitleMode){'8,6'}else{'12,8'}
  if($script:subtitleMode){$controls.MainBorder.Background=[Windows.Media.Brushes]::Transparent;$controls.MainBorder.BorderThickness=0}
  else{Set-BackgroundOpacity;$controls.MainBorder.BorderThickness=1}
  $window.Left=[Math]::Max($area.Left,[Math]::Min($window.Left,$area.Right-$window.Width))
  $window.Top=[Math]::Max($area.Top,[Math]::Min($window.Top,$area.Bottom-$window.Height))
 }
 $script:playbackLayoutDirty=$true
}
function Set-NarrowBarShown {
  param([bool]$show,[switch]$Instant)
  if($script:displayMode -ne 'narrow'){return}
  # 没有形象时必须保留条子，否则整层什么都看不见（占位逻辑继续用）。
  if(-not $script:narrowPetVisible){ return }
  if($show){
    if($script:barHideTimer){try{$script:barHideTimer.Stop()}catch{};$script:barHideTimer=$null}
    # 标记为 true 也要继续重算宽度：标记和窗口可能不同步（active/playing 但停在 126 宽）。
    $wasShown=[bool]$script:narrowBarShown
    $script:narrowBarShown=$true
    try{
      $controls.NarrowBubble.Visibility='Visible'
      if($script:narrowPetTail){$script:narrowPetTail.Visibility='Visible'}
    }catch{}
    Set-NarrowMetrics
    if($wasShown){return}
    try{
      $duration=[Windows.Media.Duration]::new([TimeSpan]::FromMilliseconds(240))
      $ease=New-Object Windows.Media.Animation.CubicEase
      $ease.EasingMode=[Windows.Media.Animation.EasingMode]::EaseOut
      $fade=New-Object Windows.Media.Animation.DoubleAnimation(0,1,$duration)
      $fade.EasingFunction=$ease
      $controls.NarrowCanvas.Opacity=0
      $controls.NarrowCanvas.BeginAnimation([Windows.UIElement]::OpacityProperty,$fade)
      $slide=New-Object Windows.Media.Animation.DoubleAnimation(-14,0,$duration)
      $slide.EasingFunction=$ease
      $transform=New-Object Windows.Media.TranslateTransform
      $controls.NarrowBubble.RenderTransform=$transform
      $transform.BeginAnimation([Windows.Media.TranslateTransform]::XProperty,$slide)
    }catch{}
    return
  }
  # 有正在播/排队的消息时绝不收起：否则 show 之后可能被迟到的 hide 缩回 72 宽。
  if($script:activePlayback -or $script:playbackQueue.Count){$script:narrowBarShown=$true;return}
  if(-not $script:narrowBarShown){return}
  $script:narrowBarShown=$false
  if($Instant){ try{Clear-PlaybackRows}catch{}; Set-NarrowMetrics; return }
  # 先淡出，200ms 后再把窗口收成只剩形象（宽度收起不跳脸）。
  try{
    $fade=New-Object Windows.Media.Animation.DoubleAnimation(1,0,[Windows.Media.Duration]::new([TimeSpan]::FromMilliseconds(180)))
    $controls.NarrowCanvas.BeginAnimation([Windows.UIElement]::OpacityProperty,$fade)
  }catch{}
  if($script:barHideTimer){try{$script:barHideTimer.Stop()}catch{}}
  $timer=New-Object Windows.Threading.DispatcherTimer
  $timer.Interval=[TimeSpan]::FromMilliseconds(200)
  $timer.Add_Tick({
    try{
      if($script:narrowBarShown){$timer.Stop();return}
      if($script:activePlayback -or $script:playbackQueue.Count){$script:narrowBarShown=$true;Set-NarrowMetrics;$timer.Stop();return}
      Clear-PlaybackRows
      Set-NarrowMetrics
    }catch{}
    $timer.Stop()
  })
  $script:barHideTimer=$timer
  $timer.Start()
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

# 打字机效果：当前这句逐字出现，读完再整句高亮。
# 只用在字幕形态（真·人物说话的场景）：跑马灯是横向滚动，逐字出现会和滚动打架。
function Get-TypingText([string]$text, [int]$count) {
  if (-not $text) { return '' }
  $total = $text.Length
  if ($count -ge $total) { return $text }
  if ($count -le 0) { return '' }
  return $text.Substring(0, $count)
}

$script:typingTimer = $null
$script:typingControl = $null
$script:typingText = ''
$script:typingIndex = 0

function Stop-Typing {
  if ($script:typingTimer) { $script:typingTimer.Stop(); $script:typingTimer = $null }
  $script:typingControl = $null
  $script:typingText = ''
  $script:typingIndex = 0
}

function Show-TypedText {
  param($Control, [string]$Text, [int]$IntervalMs = 26)
  if (-not $Control) { return }
  Stop-Typing
  if (-not $Text) { $Control.Text = ''; return }
  # 太短的句子直接出，别让人等
  if ($Text.Length -le 3) { Set-HighlightedText $Control $Text; return }
  $script:typingControl = $Control
  $script:typingText = $Text
  $script:typingIndex = 0
  $Control.Text = ''
  $script:typingTimer = New-Object Windows.Threading.DispatcherTimer
  $script:typingTimer.Interval = [TimeSpan]::FromMilliseconds([Math]::Max(12, $IntervalMs))
  $script:typingTimer.Add_Tick({
    if (-not $script:typingControl) { Stop-Typing; return }
    $script:typingIndex += 1
    $script:typingControl.Text = Get-TypingText $script:typingText $script:typingIndex
    if ($script:typingIndex -ge $script:typingText.Length) {
      $finished = $script:typingControl
      $whole = $script:typingText
      Stop-Typing
      Set-HighlightedText $finished $whole
    }
  })
  $script:typingTimer.Start()
}

function Push-Subtitle([string]$line,[bool]$animate=$true){
 $characters=0;$elements=[Globalization.StringInfo]::GetTextElementEnumerator($line);while($elements.MoveNext()){$characters++}
  # 句号/问号结尾多停一会儿，逗号处略停，读起来更像说话。
 $tailBonus=if($line -match '[。！？]$'){600}elseif($line -match '[，；：]$'){250}else{0}
 $script:subtitleBaseHold=[Math]::Max(900,[Math]::Min(4200,950+$characters*75+$tailBonus))
 Stop-Typing
 $script:subtitleRows.Add($line);while($script:subtitleRows.Count -gt 3){$script:subtitleRows.RemoveAt(0)}
 $height=$script:subtitleRowHeight;$duration=if($script:playbackAccelerated){120}else{240}
 $names=@('OutgoingSubtitle','PreviousSubtitle','NarrowText');$count=$script:subtitleRows.Count
 for($i=0;$i -lt 3;$i++){
  $view=$controls[$names[$i]];if(!$view){continue};$index=$count-3+$i
  $view.BeginAnimation([Windows.UIElement]::OpacityProperty,$null);$view.RenderTransform=New-Object Windows.Media.TranslateTransform
  if($index -lt 0){$view.Text='';$view.Tag=$null;continue}
  # 字幕模式只显示两行：最旧那行（Outgoing）留空，视线上只有上一句和当前句。
  if($i -eq 0 -and $script:subtitleMode){$view.Text='';$view.BeginAnimation([Windows.UIElement]::OpacityProperty,$null);$view.Opacity=0;continue}
  $rowText=$script:subtitleRows[$index]
  # 字幕形态用打字机逐字出现；跑马灯是横向滚动，保持整句。
  if($script:subtitleMode -and !$SelfTest -and $i -eq 2){Show-TypedText -Control $view -Text $rowText -IntervalMs 26}else{Set-HighlightedText $view $rowText}
  $view.Width=(Get-NarrowWidth);$view.TextAlignment=if($script:narrowPetVisible){'Left'}else{'Center'}
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
 if($script:displayMode -eq 'narrow' -and $script:collapsed){Set-Collapsed $false -PreserveMode;Set-NarrowMetrics;$window.UpdateLayout()}
 $controls.NarrowCanvas.BeginAnimation([Windows.UIElement]::OpacityProperty,$null);$controls.NarrowCanvas.Opacity=1
 $script:playbackLastTick=Get-PlaybackNow;$modeClock.Start()
}
# 每条真正上屏的消息都落一条日志（started/completed），排查“为什么没显示/显示错”时直接对照。
function Write-OverlayMessageLog([string]$event,$item,[hashtable]$extra){
 try{
  $text=if($item){[string]$item.text}elseif($extra.ContainsKey('text')){[string]$extra.text}else{''}
  $row=@{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();event=$event;text=$text;id=if($item){[string]$item.id}else{[string]$extra.id};priority=if($item){[int]$item.priority}else{0};kind=if($item){[string]$item.kind}else{''};mode=[string]$script:displayMode;w=[double]$window.Width;h=[double]$window.Height}
  foreach($key in $extra.Keys){if($key -notin @('text','id')){$row[$key]=$extra[$key]}}
  $dir=Join-Path $StateDir 'logs';[IO.Directory]::CreateDirectory($dir)|Out-Null
  $line=($row|ConvertTo-Json -Compress -Depth 4)+[Environment]::NewLine
  [IO.File]::AppendAllText((Join-Path $dir 'overlay-messages.jsonl'),$line,[Text.UTF8Encoding]::new($false))
 }catch{}
}
function Finish-Playback {
 if($script:activePlayback){Write-OverlayMessageLog 'completed' $script:activePlayback @{shownMs=[Math]::Round((Get-PlaybackNow)-[double]$script:playbackStartedAt)}}
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
# 空条必须有字。清空后不补占位的话，玩家看到的是一个透明的空条，
# 会以为悬浮窗消失了（回归用例 emptyModeShowsVisibleWaitingText 盯的就是这个）。
function Show-NarrowPlaceholder {
 try{
  if(([string]$controls.NarrowText.Text).Trim()){return}
  Set-HighlightedText $controls.NarrowText ''
  $controls.NarrowText.FontSize=[Math]::Max(13,$controls.NarrowText.FontSize)
  $controls.NarrowText.Foreground='#9CAABA'
 }catch{}
}
function Playback-Tick {
 if($script:displayMode -ne 'narrow' -or $script:closing){$modeClock.Stop();return}
 $now=Get-PlaybackNow
 # 拖拽标记只应在按住左键时有效：鼠标在窗口外松开时 MouseUp 可能收不到，
   # 标记一旦卡住，播报会一直排在队列里（能听到语音、字幕不出来）。
   if($script:dragging -and [Windows.Input.Mouse]::LeftButton -ne [Windows.Input.MouseButtonState]::Pressed){$script:dragging=$false;try{Log-OverlayState 'drag-reset' @{phase=[string]$script:playbackPhase}}catch{}}
   if($settingsMenu.IsOpen -or $quickConfirm.IsOpen -or ($script:overlayModeMenu -and $script:overlayModeMenu.IsOpen) -or $script:dragging){$script:playbackLastTick=$now;return}
 $delta=[Math]::Max(0,$now-$script:playbackLastTick);$script:playbackLastTick=$now
 # 播报期间每 tick 强制保持展开：迟到的 hide/度量不能把它缩回 102/126。
 if($script:activePlayback -and $script:displayMode -eq 'narrow' -and $script:narrowPetVisible){try{Set-NarrowBarShown $true}catch{}}
 if(!$script:activePlayback -and $script:playbackQueue.Count){
  $script:awaitingPlayback=$false
  $script:activePlayback=$script:playbackQueue[0];$script:playbackQueue.RemoveAt(0);$script:playbackAccelerated=$script:playbackQueue.Count -gt 0
  $script:playbackStartedAt=$now;Write-OverlayMessageLog 'started' $script:activePlayback @{queue=$script:playbackQueue.Count}
  Set-NarrowBarShown $true;Prepare-PlaybackLayout;$delta=0
 }elseif($script:activePlayback -and $script:playbackLayoutDirty){Prepare-PlaybackLayout $true;$delta=0}
 if(!$script:activePlayback){
  if($script:awaitingPlayback -and !$script:collapsed){
   # 没有新播报时保留上一条消息的外观；只有真的空着才补占位，别把最后一条擦掉。
   $controls.NarrowText.Width=(Get-NarrowWidth);$controls.NarrowText.TextAlignment=if($script:narrowPetVisible){'Left'}else{'Center'}
   [Windows.Controls.Canvas]::SetTop($controls.NarrowText,0);[Windows.Controls.Canvas]::SetLeft($controls.NarrowText,0)
   if($script:narrowPetVisible){Set-NarrowBarShown $false}else{Show-NarrowPlaceholder}
   $modeClock.Stop();return
  }
  $modeClock.Stop()
  # 空闲时保持用户选定的形态：这里以前会 Set-Collapsed，播报一停就缩走，
  # 下一条播报又自动展开，表现为「消失一会儿又自己恢复」。
  if($script:displayMode -eq 'narrow'){
   try{
    # 空闲时保留上一条消息，没有内容才写占位。
    $controls.NarrowText.Foreground='#DDE5EE'
    $controls.NarrowCanvas.BeginAnimation([Windows.UIElement]::OpacityProperty,$null)
    $controls.NarrowCanvas.Opacity=1
    if($script:narrowPetVisible){Set-NarrowBarShown $false}else{Show-NarrowPlaceholder}
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
   # 不在这里 Clear-PlaybackRows：清了就只剩一个透明空条，看着像悬浮窗没了。
   Finish-Playback
   if($script:displayMode -eq 'narrow'){
    try{
     $controls.NarrowCanvas.BeginAnimation([Windows.UIElement]::OpacityProperty,$null);$controls.NarrowCanvas.Opacity=1
     if($script:narrowPetVisible){Set-NarrowBarShown $false}else{Show-NarrowPlaceholder}
    }catch{}
    $modeClock.Stop()
   }else{Set-Collapsed $true -PreserveMode;$modeClock.Stop()}
  }
 }
}
