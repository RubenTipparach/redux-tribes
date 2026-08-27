using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;


public static class CampaignSaveSystem
{
    public readonly static string savePath = Application.persistentDataPath + "/campaign_1.json";


    public static void Save(CampaignSaveFile saveData)
    {
        Debug.Log($"savePath = {savePath}");
        // Save the unique ID of the ScriptableObject
        string json = JsonUtility.ToJson(saveData, true);
        File.WriteAllText(savePath, json);
    }

    public static bool SaveFileExists()
    {
        return File.Exists(savePath);
    }
    
    public static CampaignSaveFile Load()
    {
        if (File.Exists(savePath))
        {
            // Read the saved data from the file
            string json = File.ReadAllText(savePath);
            CampaignSaveFile saveData = JsonUtility.FromJson<CampaignSaveFile>(json);

            saveData.InitReferences();
            // Use the unique ID to find and return the correct ScriptableObject reference
            return saveData;//FindScriptableObjectById(saveData.scriptableObjectId);
        }
        else
        {
            Debug.LogWarning("Save file not found!");
            return null;
        }
    }

    public static void DeleteSaveFile(){
        if (File.Exists(savePath))
        {
            Debug.LogError("WARNING FILE IS BEING DELETED!");
            var date = DateTime.Now.ToUniversalTime().Subtract(
                new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)
                ).TotalMilliseconds;
            File.Copy(savePath, Application.persistentDataPath + $"/campaign_1_backup{date}.json");// backup files for whatever reasons.
            File.Delete(savePath);
        }

    }

    private static CampaignSaveFile FindScriptableObjectById(string id)
    {
        // Load all ScriptableObjects of type ScriptableObjectReference in the Resources folder
        var shipCards = Resources.LoadAll<ShipCardData>("");

        foreach (var shipCard in shipCards)
        {
            if (shipCard.id == id)
            {
                //return reference;
            }
        }

        //Debug.LogWarning("No ScriptableObject found with ID: " + id);
        return null;
    }
}

[Serializable]
public class CampaignSaveFile
{

    public string campaignName = "epic_campaign_lol";

    public int credits = 1000;

    public ShipFaction shipFaction;

    // ships currently in my inventory
    public string[] starsVisited;

    public StarSaveData[] starSaveData;

    public ShipSave[] shipSave;

    public ReputationSave[] reputationSave;

    public string currentStarId = "";
    public string currentPlanetId = "";

    Dictionary<string, StarSaveData> starById;

    public List<string> planetsDefeated;
    public List<string> starsDefeated;
    public List<string> locationsDefeated;

    public StarSaveData findPlanetById(string starId)
    {
        if (starById == null)
        {
            starById = new Dictionary<string, StarSaveData>();
            foreach (var star in starSaveData)
            {
                starById.Add(star.starId, star);
            }

        }

        Debug.Log("Saving star by ID = " + starId);
        return starById[starId];
    }

    public void InitReferences()
    {
    }

}

[Serializable]
public class ReputationSave{
    public ShipFaction shipFaction;
    public int reputationScore;
}

[Serializable]
public class ShipSave {

    public string shipId;
    public string customShipName = "default ship";

    public ShipType shipClass;

    public Health shipHealthRemaining;

    public SubsystemSaveData mainThruster;

    public SubsystemSaveData[] subsystemSaves;

    public WeaponSaveData[] weaponControllerSaves;


    public int remainingCrew;
    public int remainingMarines;

    public ShipFaction originalFaction;
    public ShipFaction shipFaction;

    //public ShipCardData shipCardData;// this data will be persisted using a custom GUID
}

[Serializable]
public class WeaponSaveData{
    public string CustomShipWeaponId;
    public string weaponName;
    public string weaponSuffix;
    public Health healthRemaining;
    public int ammo = -1;// this is unlimited
}

[Serializable]
public class SubsystemSaveData{
    public string subsystemId;
    public string subsystemName;
    public Health healthRemaining;
}

[Serializable]
public class StarSaveData {
    public string starId; // currently we will use star Name as default.
    public ShipFaction controllingFaction; // 
    public int garrisonStr;

    public PlanetSaveData[] planetSaveData;

    // todo break down what things are on individual planets.
}

[Serializable]
public class PlanetSaveData{
    public string planetId;
    
    public List<BattleGroup> fleets;

    // usually one key planet will decide control of the system. Since majority of livable space will be in one place.
    // not much room for ties in space.
    public ShipFaction controllingFaction; // there will come time where planets will change sides

    public PlanetType planetType;
    public SurfaceType surfaceType;
    public AtmosphereType atmosphereType;

    public bool hasStation = false;
    //public bool hasGarrison = false;
    public bool visited = false;
}

[Serializable]
public class Health {
    public float value;
    public float initial;

    public float ToDamage => initial - value;

    public float ToPercent => value / initial;

    public bool FullHealth => value == initial;
}

[Serializable]
public class ShipMapInfo {
    public string shipId;
    public ShipType shipType;
    public string shipVariant;
    public float percentHealth;
}
[Serializable]
public class BattleGroup {
    public string battlegroupId;

    public ShipFaction faction;
    public List<ShipMapInfo> ships;
    public List<ShipMapInfo> civilianShips;
}
