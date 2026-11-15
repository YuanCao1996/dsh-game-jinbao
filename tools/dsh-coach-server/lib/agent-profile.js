import { scopeOf } from '@deepseek-ai/dsh-scope';

const GAME_TOOLS = ['site_datasets', 'site_query', 'web_search', 'web_fetch'];

export function configureGameAgent(ctx, preset) {
  if (preset !== 'jinbao-game') return;
  // DSH 的 tools 服务在不同版本里 API 不同：presentAs / restrict / view 都是可选的。
  // 之前这里直接调 presentAs，在 0.2.2-rc.3 上抛 "ctx.tools.presentAs is not a function"，
  // 整个 coach-live 会话就建不起来（每次只报这一句，看不出是哪一步）。
  // 这里按能力检测降级：没有这些 API 也能跑，只是工具呈现方式用宿主默认。
  const tools = ctx.tools;
  if (!tools) return;
  const scope = scopeOf(ctx);
  const inherited = tools.view?.(scope)?.restrictableNames;
  const allow = GAME_TOOLS.filter(name => tools.get?.(name, scope) && (!inherited || inherited.has(name)));
  if (!allow.length) throw Error('Game retrieval tools are not available');
  if (typeof tools.restrict === 'function') tools.restrict({ allow });
  if (typeof tools.presentAs === 'function') tools.presentAs('native');
}
