using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(fileName = "FactionInfoLibrary", menuName = "ShipData/FactionInfoLibrary", order = 0)]
public class FactionInfoLibrary : ScriptableObject
{
    public List<FactionInfo> factionInfo;

    Dictionary<ShipFaction, FactionInfo> factionInfoLookup;

    public List<WeaponIcon> weaponIcons;

    Dictionary<WeaponIconType, WeaponIcon> weaponLookup;

    public FactionInfo GetFactionInfo(ShipFaction faction)
    {
        if(factionInfoLookup == null)
        {
            factionInfoLookup = new Dictionary<ShipFaction, FactionInfo>();
            foreach(var f in factionInfo)
            {
                factionInfoLookup.Add(f.shipFaction, f);
            }
        }
        //Debug.Log(faction.ToString() + " loading");
        return factionInfoLookup[faction];
    }

    public WeaponIcon GetWeaponInfo(WeaponIconType weaponIconType)
    {
        if(weaponLookup == null)
        {
            weaponLookup = new Dictionary<WeaponIconType, WeaponIcon>();
            foreach(var w in weaponIcons)
            {
                weaponLookup.Add(w.weaponIconType, w);
            }
        }

        return weaponLookup[weaponIconType];
    }
}