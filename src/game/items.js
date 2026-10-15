/**
 * 아이템 획득 효과 (원작 p_inter.c P_TouchSpecialThing 와 같은 수치).
 * touchSpecial() 이 true 를 돌려주면 획득 성공 → 아이템이 사라진다. false 면(꽉 차서 등) 그대로 남는다.
 */
export const MAX_HEALTH = 200;
export const POWER_TICS = { invuln: 30 * 35, invis: 60 * 35, radsuit: 60 * 35, lightamp: 120 * 35 };

const CLIP_AMMO = { clip: 10, shell: 4, cell: 20, rocket: 1 };      // 탄약 1 묶음의 양
const BASE_MAX = { clip: 200, shell: 50, cell: 300, rocket: 50 };
const WEAPON_AMMO = { shotgun: 'shell', chaingun: 'clip', rocketLauncher: 'rocket', plasmaGun: 'cell', bfg: 'cell', chainsaw: null };

export const newAmmo = () => ({ clip: 50, shell: 0, cell: 0, rocket: 0 });
export const newMaxAmmo = () => ({ ...BASE_MAX });

const giveAmmo = (p, type, clips) => {
  if (p.ammo[type] >= p.maxAmmo[type]) return false;
  p.ammo[type] = Math.min(p.maxAmmo[type], p.ammo[type] + CLIP_AMMO[type] * clips);
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
  blueCard: ['blue', 'blue keycard'], yellowCard: ['yellow', 'yellow keycard'], redCard: ['red', 'red keycard'],
  blueSkull: ['blue', 'blue skull key'], yellowSkull: ['yellow', 'yellow skull key'], redSkull: ['red', 'red skull key'],
};

export function touchSpecial(game, p, m) {
  const say = (t) => game.say(t);
  switch (m.pickup) {
    // 체력 / 방어구
    case 'stimpack': if (!giveBody(p, 10)) return false; say('Picked up a stimpack.'); return true;
    case 'medikit': {
      const before = p.health; // 체력이 25 미만일 때 집으면 특별한 메시지
      if (!giveBody(p, 25)) return false;
      say(before < 25 ? 'Picked up a medikit that you REALLY need!' : 'Picked up a medikit.');
      return true;
    }
    case 'healthBonus': p.health = Math.min(MAX_HEALTH, p.health + 1); say('Picked up a health bonus.'); return true;
    case 'armorBonus':
      p.armor = Math.min(200, p.armor + 1);
      if (!p.armorType) p.armorType = 1;
      say('Picked up an armor bonus.');
      return true;
    case 'greenArmor': if (!giveArmor(p, 1)) return false; say('Picked up the armor.'); return true;
    case 'blueArmor': if (!giveArmor(p, 2)) return false; say('Picked up the MegaArmor!'); return true;
    case 'soulsphere': p.health = Math.min(MAX_HEALTH, p.health + 100); say('Supercharge!'); return true;

    // 파워업
    case 'invulnerability': p.powers.invuln = POWER_TICS.invuln; say('Invulnerability!'); return true;
    case 'berserk':
      giveBody(p, 100); p.powers.berserk = true; p.pendingWeapon = 'fist'; say('Berserk!');
      return true;
    case 'invisibility': p.powers.invis = POWER_TICS.invis; say('Partial Invisibility'); return true;
    case 'radsuit': p.powers.radsuit = POWER_TICS.radsuit; say('Radiation Shielding Suit'); return true;
    case 'automap': p.powers.automap = true; say('Computer Area Map'); return true;
    case 'lightamp': p.powers.lightamp = POWER_TICS.lightamp; say('Light Amplification Visor'); return true;

    // 탄약
    case 'clip': if (!giveAmmo(p, 'clip', m.dropped ? 0.5 : 1)) return false; say('Picked up a clip.'); return true;
    case 'clipBox': if (!giveAmmo(p, 'clip', 5)) return false; say('Picked up a box of bullets.'); return true;
    case 'shells': if (!giveAmmo(p, 'shell', 1)) return false; say('Picked up 4 shotgun shells.'); return true;
    case 'shellBox': if (!giveAmmo(p, 'shell', 5)) return false; say('Picked up a box of shotgun shells.'); return true;
    case 'rocket': if (!giveAmmo(p, 'rocket', 1)) return false; say('Picked up a rocket.'); return true;
    case 'rocketBox': if (!giveAmmo(p, 'rocket', 5)) return false; say('Picked up a box of rockets.'); return true;
    case 'cell': if (!giveAmmo(p, 'cell', 1)) return false; say('Picked up an energy cell.'); return true;
    case 'cellPack': if (!giveAmmo(p, 'cell', 5)) return false; say('Picked up an energy cell pack.'); return true;
    case 'backpack':
      if (!p.backpack) { p.backpack = true; for (const k of Object.keys(p.maxAmmo)) p.maxAmmo[k] *= 2; }
      for (const k of Object.keys(CLIP_AMMO)) giveAmmo(p, k, 1);
      say('Picked up a backpack full of ammo!');
      return true;

    // 무기
    case 'shotgun': if (!giveWeapon(p, 'shotgun', m.dropped)) return false; say('You got the shotgun!'); return true;
    case 'chaingun': if (!giveWeapon(p, 'chaingun', m.dropped)) return false; say('You got the chaingun!'); return true;
    case 'rocketLauncher': if (!giveWeapon(p, 'rocketLauncher', m.dropped)) return false; say('You got the rocket launcher!'); return true;
    case 'plasmaGun': if (!giveWeapon(p, 'plasmaGun', m.dropped)) return false; say('You got the plasma gun!'); return true;
    case 'bfg': if (!giveWeapon(p, 'bfg', m.dropped)) return false; say('You got the BFG9000!  Oh, yes.'); return true;
    case 'chainsaw': if (!giveWeapon(p, 'chainsaw', m.dropped)) return false; say('A chainsaw!  Find some meat!'); return true;

    // 열쇠
    default: {
      const k = KEY_NAMES[m.pickup];
      if (!k) return false;
      if (p.keys[k[0]]) return false;
      p.keys[k[0]] = true;
      say(`Picked up a ${k[1]}.`);
      return true;
    }
  }
}
