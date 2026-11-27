import {readFileSync} from 'node:fs';

const aliases = JSON.parse(readFileSync(new URL('../dsh-onboarding/champion-aliases.json', import.meta.url), 'utf8'));
const kits = JSON.parse(readFileSync(new URL('./champion-kits.json', import.meta.url), 'utf8'));
const byAlias = new Map(kits.map((row) => [String(row.alias ?? '').toLowerCase(), row]));
const aliasByChinese = new Map(Object.entries(aliases).map(([name, alias]) => [String(name).replace(/\s+/g, ''), String(alias).toLowerCase()]));

function aliasOf(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  const candidates = [compact, compact.split('·').at(-1), compact.split(' ').at(-1), compact.slice(2)];
  for (const candidate of candidates) {
    const alias = aliasByChinese.get(candidate);
    if (alias) return alias;
  }
  const direct = kits.find((row) => row.alias?.toLowerCase() === compact.toLowerCase());
  return direct?.alias?.toLowerCase() ?? '';
}

export function championKit(name) {
  const alias = aliasOf(name);
  return alias ? byAlias.get(alias) ?? null : null;
}

// 只给模型一句能用的技能摘要，避免把整篇技能文本塞进 2000 字上限的提示词。
export function championKitBrief(name, {skills = 4, desc = 95} = {}) {
  const kit = championKit(name);
  if (!kit) return null;
  return {
    roles: Array.isArray(kit.roles) ? kit.roles : [],
    spells: (kit.spells ?? []).slice(0, skills).map((spell) => ({
      key: String(spell.key ?? ''),
      name: String(spell.name ?? ''),
      desc: String(spell.desc ?? '').slice(0, desc),
    })),
  };
}
