'use strict';

/*
 * Sorting 6,300 client icons into something browsable.
 *
 * Blizzard's icon names are prefixed by what the art is for, and that prefix is the only
 * classification the client ships — there is no category column in any DBC. So the categories are
 * derived from the names, most specific rule first.
 *
 * The order matters. `inv_` covers nearly half the set and means only "an inventory item", so the
 * armour and weapon rules have to be tested before it or everything lands in Misc. Anything that
 * matches nothing falls through to Misc rather than being hidden.
 */

const CATEGORIES = [
    {
        key: 'all',
        label: 'All',
        match: () => true
    },
    {
        key: 'armor',
        label: 'Armor',
        match: (n) => /^inv_(helmet|chest|shoulder|boots|bracer|belt|pants|gauntlets|shirt|cape|shield|robe|misc_cape)_/.test(n)
            || /^inv_(chest|helm)_/.test(n)
    },
    {
        key: 'weapons',
        label: 'Weapons',
        match: (n) => /^inv_(axe|sword|mace|staff|spear|weapon|hammer|knife|wand|bow|musket|crossbow|throwingaxe|throwingknife)_/.test(n)
            || /^ability_(warrior|rogue)_.*(strike|slash)/.test(n)
    },
    {
        key: 'achievements',
        label: 'Achievements',
        // Tested before abilities, which would otherwise claim achievement_boss_* for itself.
        match: (n) => /^achievement_/.test(n)
    },
    {
        key: 'abilities',
        label: 'Abilities',
        match: (n) => /^(ability|racial|warrior|rogue|priest|paladin|shaman|druid|hunter|warlock|mage|deathknight|class|talent)_/.test(n)
    },
    {
        key: 'spells',
        label: 'Spells',
        match: (n) => /^spell_/.test(n)
    },
    {
        key: 'trade',
        label: 'Trade & crafting',
        match: (n) => /^(trade|inv_enchant|inv_ore|inv_ingot|inv_fabric|inv_stone|inv_potion|inv_scroll|inv_gizmo|inv_elemental|inv_drink|inv_food|inv_crate|inv_misc_herb|inv_misc_gem|inv_misc_leatherscrap|inv_misc_pelt|inv_jewelcrafting|inv_inscription|inv_alchemy)_/.test(n)
    },
    {
        key: 'misc',
        label: 'Misc',
        match: () => true
    }
];

/** The categories offered as filters, in order. Custom is added by the picker itself. */
const FILTERS = CATEGORIES.filter((c) => c.key !== 'misc').concat(
    CATEGORIES.filter((c) => c.key === 'misc'));

/**
 * The category an icon belongs to.
 *
 * `all` is skipped because everything matches it, and `misc` is the last resort, so the search
 * runs over the real rules in between.
 */
function categoryOf(name)
{
    const lower = String(name).toLowerCase();

    for (const category of CATEGORIES)
    {
        if (category.key === 'all' || category.key === 'misc')
        {
            continue;
        }

        if (category.match(lower))
        {
            return category.key;
        }
    }

    return 'misc';
}

function inCategory(name, key)
{
    return key === 'all' || categoryOf(name) === key;
}

export { CATEGORIES, FILTERS, categoryOf, inCategory };
