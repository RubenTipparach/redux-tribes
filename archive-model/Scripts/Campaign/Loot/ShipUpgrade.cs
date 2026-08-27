

// by default missiles and shields are always a thing
// todo scriptable objectify this.

using UnityEngine;

[CreateAssetMenu(
    fileName = "GameLoot",
    menuName = "GameLoot/Ship_Upgrade_Loot", order = 0)]
public class ShipUpgrade : ScriptableObject
{
    
    [ReadOnly]
    public ShipUpgradeType shipUpgradeType;

    [ReadOnly]
    public int quantity;

}


public enum ShipUpgradeType
{
    Additional_Health = 0,
    Armor = 1,
    Shield = 2, // absorbs n number of hits from energy, requires n number of turns to regen.

    Weapon_Component,
    Weapon_Modifier, // applies to all weapons
    Marine_Capacity,
    Boarding_Cannon,
    Thruster_Engines,
    Hull_Regen,
    Missiles_Quantity,//
    Ship_Fuel
    
}

// add health
// add more armor
// add shields
// add new weapon type.
// weapon buff modifier
// add more marines
// upgrade transporter.
// upgrade engines // range, max range ratios?
// add healing
// missile count
// ship fuel