import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'D:/work/DSH/publish/jinbao-desktop-public/tools/desktop-release';
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function load(name) {
  const raw = readFileSync(`${ROOT}/${name}`);
  const hasBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  const text = raw.subarray(hasBom ? 3 : 0).toString('utf8');
  return { name, text, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

function patch(file, steps) {
  let { text, eol } = file;
  for (const [label, from, to] of steps) {
    const src = from.replace(/\n/g, eol);
    const dst = to.replace(/\n/g, eol);
    const hits = text.split(src).length - 1;
    if (hits !== 1) throw new Error(`${file.name}: anchor "${label}" matched ${hits} times`);
    text = text.replace(src, dst);
  }
  // Exactly one BOM, whatever the source had.
  writeFileSync(`${ROOT}/${file.name}`, Buffer.concat([BOM, Buffer.from(text, 'utf8')]));
  return text;
}

const H = '#2E3742';   // ball border, idle
const HOVER = '#FF9F2F';
const GLYPH = '&#x25C9;';

const overlay = load('strategy-overlay.ps1');
patch(overlay, [
  // 1. The collapsed pill becomes the App-style circle: 52 px ball plus a 20 px badge.
  ['bubble-xaml',
`   <Grid x:Name="Bubble" Visibility="Collapsed" Background="#01000000" Cursor="SizeAll">
    <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
    <TextBlock x:Name="BubbleLabel" Text="金宝" Foreground="#93C5FD" FontSize="14" VerticalAlignment="Center" ToolTip="点击展开；按住拖动"/>
    <Button x:Name="BubbleClose" Grid.Column="1" Content="×" Padding="4,0" Margin="0" ToolTip="退出悬浮窗"/>`,
`   <Grid x:Name="Bubble" Visibility="Collapsed" Background="#01000000" Cursor="Hand" Width="56" Height="56" ToolTip="单击展开；按住拖动">
    <Border x:Name="BubbleBall" Width="52" Height="52" CornerRadius="26" HorizontalAlignment="Center" VerticalAlignment="Center" Background="#F224272B" BorderBrush="${H}" BorderThickness="1">
    <Border.Effect><DropShadowEffect BlurRadius="16" ShadowDepth="0" Opacity="0.5" Color="#000000"/></Border.Effect>
    <TextBlock x:Name="BubbleLabel" Text="${GLYPH}" Foreground="#FF9F2F" FontSize="20" FontWeight="Bold" HorizontalAlignment="Center" VerticalAlignment="Center" IsHitTestVisible="False"/>
    </Border>
    <Border x:Name="BubbleBadge" Width="20" Height="20" CornerRadius="10" HorizontalAlignment="Right" VerticalAlignment="Top" Background="#FF9F2F" BorderBrush="#30343A" BorderThickness="1" Visibility="Collapsed">
    <TextBlock x:Name="BubbleBadgeText" Text="" Foreground="#FFFFFF" FontSize="11" FontWeight="Bold" HorizontalAlignment="Center" VerticalAlignment="Center" IsHitTestVisible="False"/>
    </Border>`],
  // 2. Register the new controls, drop the removed one.
  ['controls',
    "'CloseButton','Bubble','BubbleClose'",
    "'CloseButton','Bubble','BubbleBall','BubbleBadge','BubbleBadgeText'"],
  // 3. No close button on the ball: a click expands, the tray menu still exits.
  ['bubble-close-handler',
    '$controls.BubbleClose.Add_Click({$window.Close()})',
    '# The collapsed ball deliberately has no close button: a click expands it and the tray menu exits.'],
  // 4. Ball footprint (56 px window leaves room for the badge overhang).
  ['collapsed-size',
    '$window.MinWidth=0;$window.MinHeight=0;$window.Width=110;$window.Height=52',
    '$window.MinWidth=0;$window.MinHeight=0;$window.Width=56;$window.Height=56'],
  // 5/6. Round the frame while collapsed so no square panel shows behind the ball.
  ['collapsed-radius',
    "$window.ResizeMode='NoResize';$controls.Expanded.Visibility='Collapsed';$controls.Bubble.Visibility='Visible';$controls.ResizeGrip.Visibility='Collapsed'",
    "$window.ResizeMode='NoResize';$controls.Expanded.Visibility='Collapsed';$controls.Bubble.Visibility='Visible';$controls.ResizeGrip.Visibility='Collapsed';$controls.MainBorder.CornerRadius='28';$controls.MainBorder.Padding='0'"],
  ['expanded-radius',
    "$window.MinWidth=420;$window.MinHeight=220;$window.ResizeMode='CanResize';$controls.ResizeGrip.Visibility='Visible'",
    "$window.MinWidth=420;$window.MinHeight=220;$window.ResizeMode='CanResize';$controls.ResizeGrip.Visibility='Visible';$controls.MainBorder.CornerRadius='14'"],
  // 7. Keep the frame transparent behind the ball regardless of opacity settings.
  ['transparent-frame',
    "if($script:displayMode -eq 'narrow' -and $script:subtitleMode -and !$script:collapsed)",
    "if($script:collapsed -or ($script:displayMode -eq 'narrow' -and $script:subtitleMode))"],
  // 8. Hover feedback, matching the App ball which lights up under the finger.
  ['hover',
    '$controls.Bubble.Add_MouseLeftButtonDown({param($sender,$eventArgs) Start-Drag $sender $eventArgs})',
    `$controls.Bubble.Add_MouseLeftButtonDown({param($sender,$eventArgs) Start-Drag $sender $eventArgs})
$controls.Bubble.Add_MouseEnter({if($script:collapsed){$controls.BubbleBall.BorderBrush='${HOVER}'}})
$controls.Bubble.Add_MouseLeave({if($script:collapsed){$controls.BubbleBall.BorderBrush='${H}'}})`],
  // 9. The self-test now pins the ball geometry instead of the old pill.
  ['selftest',
    "$script:testResult.silentMode=$script:collapsed -and $controls.Bubble.Visibility -eq 'Visible'",
    "$script:testResult.silentMode=$script:collapsed -and $controls.Bubble.Visibility -eq 'Visible' -and [Math]::Round($window.Width) -eq 56 -and [Math]::Round($window.Height) -eq 56 -and $controls.BubbleBall.Visibility -eq 'Visible'"]
]);

const modes = load('overlay-modes.ps1');
patch(modes, [
  // 10. The unread count moves from the label text to the corner badge.
  ['unread-badge',
    "$controls.BubbleLabel.Text=if($script:snapshot.confirmation){'金宝 !'}elseif($script:unread){'金宝 '+$script:unread}else{'金宝'}",
    `if($controls.BubbleBadge){$script:bubbleCount=[Math]::Min(99,[int]$script:unread);$controls.BubbleBadgeText.Text=if($script:snapshot.confirmation){'!'}else{[string]$script:bubbleCount};$controls.BubbleBadge.Visibility=if($script:snapshot.confirmation -or $script:bubbleCount -gt 0){'Visible'}else{'Collapsed'}}`]
]);

console.log('patched: strategy-overlay.ps1, overlay-modes.ps1');
