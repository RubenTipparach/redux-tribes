using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.UIElements;

[ExecuteAlways]
public class GenerateShipDataBlock : MonoBehaviour
{


    public ShipController defaultShipPrefabONLY;

    public ShipSave shipSave_default;

    public bool generateDis = false;
    // Start is called before the first frame update
    void Start()
    {
        
        
    }

    // Update is called once per frame
    void Update()
    {
        if(generateDis == true) {
            generateDis = false;
            shipSave_default = CopyOverShipDataBlock(defaultShipPrefabONLY, true); // prefabs don't initialize current health.
        }
        
    }
    public static void LoadShipData(ShipSave saveFile, ShipController target)
    {
        // VERY IMPORTANT! Instantiate ship before loading this! or else!
    }

    public void CopyOverShipData(ShipController target)
    {

        bool initial = true;
        WeaponSaveData[] weaponSaves = new WeaponSaveData[target.weapons.Count];
        for (int i = 0; i < target.weapons.Count; i++)
        {
            var wep = target.weapons[i];
            weaponSaves[i] = new WeaponSaveData
            {
                CustomShipWeaponId = wep.weaponData.GetCustomShipWeaponId(target, i),
                healthRemaining = initial ?
                    new Health { value = wep.weaponData.weaponHealth, initial = wep.weaponData.weaponHealth }
                    :
                    wep.SubsystemHealth.ToHealthSave(),
                weaponName = wep.SubsystemName,
                weaponSuffix = $"Mount {i}",
                ammo = wep.ammo
            };

        }

        shipSave_default = new ShipSave
        {
            shipId = target.shipCardData.id,
            shipHealthRemaining = target.shipHealth.ToHealthSave(initial),
            shipClass = target.shipCardData.shipType,
            mainThruster = new SubsystemSaveData
            {
                subsystemId = target.shipMainSystems.thrusterSystem.id,
                subsystemName = target.shipMainSystems.thrusterSystem.SubsystemName,
                healthRemaining = target.shipMainSystems.thrusterSystem.SubsystemHealth.ToHealthSave(initial)
            }, //primary functions ALL ships should share

            subsystemSaves = target.SecondarySubsystems.Select(
               p => new SubsystemSaveData
               {
                   subsystemId = p.id,
                   subsystemName = p.SubsystemName,
                   healthRemaining = p.SubsystemHealth.ToHealthSave(initial)
               }
           ).ToArray(), // does this inlcludes weaponnns? ans: no

            weaponControllerSaves = weaponSaves, // weapons
            remainingCrew = target.crewRemaining,
            remainingMarines = target.marines,
            shipFaction = target.shipFaction, // this will allow us to generate ship data at a star level! Wow!
            originalFaction = target.shipCardData.shipFaction

        };

        // return shipSave;
    }


    public static ShipSave CopyOverShipDataBlock(ShipController target, bool initial = false)
    {

        WeaponSaveData[] weaponSaves = new WeaponSaveData[target.weapons.Count];
        for (int i = 0; i < target.weapons.Count; i++)
        {
            var wep = target.weapons[i];
            weaponSaves[i] = new WeaponSaveData
            {
                CustomShipWeaponId = wep.weaponData.GetCustomShipWeaponId(target, i),
                healthRemaining = initial ?
                    new Health { value = wep.weaponData.weaponHealth, initial = wep.weaponData.weaponHealth }
                    :
                    wep.SubsystemHealth.ToHealthSave(),
                weaponName = wep.SubsystemName,
                weaponSuffix = $"Mount {i}",
                ammo = wep.ammo
            };

        }

        var shipSave = new ShipSave
        {
            shipId = target.shipCardData.id,
            shipHealthRemaining = target.shipHealth.ToHealthSave(initial),
            shipClass = target.shipCardData.shipType,
            mainThruster = new SubsystemSaveData
            {
                subsystemId = target.shipMainSystems.thrusterSystem.id,
                subsystemName = target.shipMainSystems.thrusterSystem.SubsystemName,
                healthRemaining = target.shipMainSystems.thrusterSystem.SubsystemHealth.ToHealthSave(initial)
            }, //primary functions ALL ships should share

            subsystemSaves = target.SecondarySubsystems.Select(
                p => new SubsystemSaveData
                {
                    subsystemId = p.id,
                    subsystemName = p.SubsystemName,
                    healthRemaining = p.SubsystemHealth.ToHealthSave(initial)
                }
            ).ToArray(), // does this inlcludes weaponnns? ans: no

            weaponControllerSaves = weaponSaves, // weapons
            remainingCrew = target.crewRemaining,
            remainingMarines = target.marines,
            shipFaction = target.shipFaction, // this will allow us to generate ship data at a star level! Wow!
            originalFaction = target.shipCardData.shipFaction

        };

        return shipSave;
    }
}
