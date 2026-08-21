'use strict';

import { state } from './state.js';

/*
 * Glorenzelg, High-Blade of the Silver Hand (item 50730).
 *
 * Every value is the real one from item_template rather than an approximation: Flags 8 is the
 * heroic bit, delay 3600 is speed 3.60, sellprice 332775 copper is 33g 27s 75c, the three colour-2
 * sockets are red, and the stat ids are Strength (4), Stamina (7), crit rating (32) and expertise
 * rating (37). The icon is what ItemDisplayInfo.dbc gives for display 64397.
 */
function seedExample()
{
    Object.assign(state, {
        name: 'Glorenzelg, High-Blade of the Silver Hand',
        quality: 4,
        heroic: true,
        binding: 'bop',
        unique: 'none',
        slot: 'Two-Hand',
        itemType: 'Sword',
        hasWeapon: true,
        dmgMin: 991,
        dmgMax: 1487,
        speed: 3.6,
        durability: 120,
        reqLevel: 80,
        itemLevel: 284,
        icon: 'inv_sword_153',
        stats: [
            { type: 'Strength', value: 198 },
            { type: 'Stamina', value: 222 }
        ],
        sockets: ['red', 'red', 'red'],
        socketBonus: '+8 Strength',
        effects: [
            { kind: 'Equip', preset: 'Improves critical strike rating by {N}.', value: 122, text: '' },
            { kind: 'Equip', preset: 'Increases your expertise rating by {N}.', value: 114, text: '' }
        ],
        flavor: 'Paragon of the Light, lead our armies against the coming darkness.',
        sellGold: 33,
        sellSilver: 27,
        sellCopper: 75
    });
}

export { seedExample };
