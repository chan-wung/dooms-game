import { t } from '../app/i18n.js';
/**
 * 아이템 획득 효과 (원작 p_inter.c P_TouchSpecialThing 와 같은 수치).
 * touchSpecial() 이 true 를 돌려주면 획득 성공 → 아이템이 사라진다. false 면(꽉 차서 등) 그대로 남는다.
 */
export const MAX_HEALTH = 200;
export const POWER_TICS = { invuln: 30 * 35, invis: 60 * 35, radsuit: 60 * 35, lightamp: 120 * 35 };

const CLIP_AMMO = { clip: 10, shell: 4, cell: 20, rocket: 1 };      // 탄약 1 묶음의 양
const BASE_MAX = { clip: 200, shell: 50, cell: 300, rocket: 50 };
const WEAPON_AMMO = { shotgun: 'shell', chaingun: 'clip', rocketLauncher: 'rocket', plasmaGun: 'cell', bfg: 'cell', chainsaw: null, superShotgun: 'shell' };

export const newAmmo = () => ({ clip: 50, shell: 0, cell: 0, rocket: 0 });
export const newMaxAmmo = () => ({ ...BASE_MAX });

const giveAmmo = (p, type, clips) => {
  if (p.ammo[type] >= p.maxAmmo[type]) return false;
  p.ammo[type] = Math.min(p.maxAmmo[type], p.ammo[type] + CLIP_AMMO[type] * clips * (p.ammoMultiplier ?? 1));
  return true;
};

const giveBody = (p, amount) => {
  if (p.health >= 100) return false;
  p.health = Math.min(100, p.health + amount);
  return true;
};

const giveArmor = (p, type) => {
  const points = type === 1 ? 100 : 200;
  if (p.armor >= points) return false;
  p.armorType = type; p.armor = points;
  return true;
};

const giveWeapon = (p, weapon, dropped = false) => {
  const ammo = WEAPON_AMMO[weapon];
  const gaveAmmo = ammo ? giveAmmo(p, ammo, dropped ? 1 : 2) : false; // 떨어진 무기는 탄약이 절반
  let gaveWeapon = false;
  if (!p.weapons.has(weapon)) { p.weapons.add(weapon); p.pendingWeapon = weapon; p.grin = 70; gaveWeapon = true; }
  return gaveWeapon || gaveAmmo;
};

const KEY_NAMES = {
  blueCard: 'blue', yellowCard: 'yellow', redCard: 'red',
  blueSkull: 'blue', yellowSkull: 'yellow', redSkull: 'red',
};

export function touchSpecial(game, p, m) {
  const say = (t) => game.say(t);
  switch (m.pickup) {
    // 체력 / 방어구
    case 'stimpack': if (!giveBody(p, 10)) return false; say(t('pickup.stimpack')); return true;
    case 'medikit': {
      const before = p.health; // 체력이 25 미만일 때 집으면 특별한 메시지
      if (!giveBody(p, 25)) return false;
      say(t(before < 25 ? 'pickup.medikitNeed' : 'pickup.medikit'));
      return true;
    }
    case 'healthBonus': p.health = Math.min(MAX_HEALTH, p.health + 1); say(t('pickup.healthBonus')); return true;
    case 'armorBonus':
      p.armor = Math.min(200, p.armor + 1);
      if (!p.armorType) p.armorType = 1;
      say(t('pickup.armorBonus'));
      return true;
    case 'greenArmor': if (!giveArmor(p, 1)) return false; say(t('pickup.greenArmor')); return true;
    case 'blueArmor': if (!giveArmor(p, 2)) return false; say(t('pickup.blueArmor')); return true;
    case 'soulsphere': p.health = Math.min(MAX_HEALTH, p.health + 100); say(t('pickup.soulsphere')); return true;
    case 'megasphere': p.health = MAX_HEALTH; p.armor = 200; p.armorType = 2; say(t('pickup.megasphere')); return true;   // 둠2

    // 파워업
    case 'invulnerability': p.powers.invuln = POWER_TICS.invuln; say(t('pickup.invulnerability')); return true;
    case 'berserk':
      giveBody(p, 100); p.powers.berserk = 1; p.pendingWeapon = 'fist'; say(t('pickup.berserk'));
      return true;
    case 'invisibility': p.powers.invis = POWER_TICS.invis; say(t('pickup.invisibility')); return true;
    case 'radsuit': p.powers.radsuit = POWER_TICS.radsuit; say(t('pickup.radsuit')); return true;
    case 'automap': p.powers.automap = true; say(t('pickup.automap')); return true;
    case 'lightamp': p.powers.lightamp = POWER_TICS.lightamp; say(t('pickup.lightamp')); return true;

    // 탄약
    case 'clip': if (!giveAmmo(p, 'clip', m.dropped ? 0.5 : 1)) return false; say(t('pickup.clip')); return true;
    case 'clipBox': if (!giveAmmo(p, 'clip', 5)) return false; say(t('pickup.clipBox')); return true;
    case 'shells': if (!giveAmmo(p, 'shell', 1)) return false; say(t('pickup.shells')); return true;
    case 'shellBox': if (!giveAmmo(p, 'shell', 5)) return false; say(t('pickup.shellBox')); return true;
    case 'rocket': if (!giveAmmo(p, 'rocket', 1)) return false; say(t('pickup.rocket')); return true;
    case 'rocketBox': if (!giveAmmo(p, 'rocket', 5)) return false; say(t('pickup.rocketBox')); return true;
    case 'cell': if (!giveAmmo(p, 'cell', 1)) return false; say(t('pickup.cell')); return true;
    case 'cellPack': if (!giveAmmo(p, 'cell', 5)) return false; say(t('pickup.cellPack')); return true;
    case 'backpack':
      if (!p.backpack) { p.backpack = true; for (const k of Object.keys(p.maxAmmo)) p.maxAmmo[k] *= 2; }
      for (const k of Object.keys(CLIP_AMMO)) giveAmmo(p, k, 1);
      say(t('pickup.backpack'));
      return true;

    // 무기
    case 'shotgun': if (!giveWeapon(p, 'shotgun', m.dropped)) return false; say(t('pickup.shotgun')); return true;
    case 'superShotgun': if (!giveWeapon(p, 'superShotgun', m.dropped)) return false; say(t('pickup.superShotgun')); return true;
    case 'chaingun': if (!giveWeapon(p, 'chaingun', m.dropped)) return false; say(t('pickup.chaingun')); return true;
    case 'rocketLauncher': if (!giveWeapon(p, 'rocketLauncher', m.dropped)) return false; say(t('pickup.rocketLauncher')); return true;
    case 'plasmaGun': if (!giveWeapon(p, 'plasmaGun', m.dropped)) return false; say(t('pickup.plasmaGun')); return true;
    case 'bfg': if (!giveWeapon(p, 'bfg', m.dropped)) return false; say(t('pickup.bfg')); return true;
    case 'chainsaw': if (!giveWeapon(p, 'chainsaw', m.dropped)) return false; say(t('pickup.chainsaw')); return true;

    // 열쇠
    default: {
      const k = KEY_NAMES[m.pickup];
      if (!k) return false;
      if (p.keys[k]) return false;
      p.keys[k] = true;
      say(t(`pickup.${m.pickup}`));
      return true;
    }
  }
}
