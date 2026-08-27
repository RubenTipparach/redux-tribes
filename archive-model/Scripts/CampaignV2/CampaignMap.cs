using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using CampaignV2;
using DevLocker.Utils;
using Udar.SceneManager;
using UnityEditor;
using UnityEngine;

namespace CampaignV2
{
    public class CampaignMap : MonoBehaviour
    {
        public static CampaignMap Instance
        {
            get
            {
                if (_instance != null)
                {
                    return _instance;
                }
                else
                {

                    var gm = FindObjectOfType<CampaignMap>(); // should only be one in existance

                    return gm;
                }
            }
        }

        private static CampaignMap _instance;

        public CampaignMenu campaignMenu;
        public SolarSystem[] solarSystems;

        public StarmapShipV2 playerShip;

        public CameraMapController camController;

        public SelectionManager selectionManager;

        public FactionInfoLibrary factionInfoLibrary;

        public List<EncounterMaps> mapsList;

        public Dictionary<EncounterType, EncounterMaps> mapsTable;

        [Header("Save Data")]
        CampaignSaveFile campaignSaveFile;
        public GenerateShipDataBlock generateShipDataBlock;
        public int credits = 1000;
        public string CurrentStarId => playerShip.atLocation.system.guid;
        //private string currentStarId = "";
        //public FloatingPlanetMenu floatingPlanetMenu;

        [Header("Defaults")]
        public BattleGroup DefaultFleet;
        public FactionReputation factionReputationSettings;
        public Dictionary<ShipFaction, FactionStatus> factionRepState;
        public string defaultLocationId => playerShip.atLocation.guid;

        [Header("Game state")]
        public FactionInfo playerFaction;
        public List<ShipSave> playerFleet;
        public List<Celestial> allLocations;

        public List<CampaignV2.SolarSystem> stars;

        public SaveLoadSystem saveLoadSystem;

        [Header("Map Iconography Prefabs")]
        public SpaceStation stationPrefab;
        public ShipMapIcon shipMapIcon;


        public EncounterMissionLoader encounterMissionLoader;

        public Dictionary<string, Planet> allPlanets;

        public List<StarJson> starsJson;

        public void UpdateShip(ShipSave shipSave)
        {
            var ship = playerFleet.Find(p => p.shipId == shipSave.shipId);
            ship.shipHealthRemaining = shipSave.shipHealthRemaining;
            ship.remainingCrew = shipSave.remainingCrew;
            ship.remainingMarines = shipSave.remainingMarines;

            ship.subsystemSaves = shipSave.subsystemSaves;
            ship.weaponControllerSaves = shipSave.weaponControllerSaves;
            ship.mainThruster = shipSave.mainThruster;

            // what else? idk lol
        }

        void Awake()
        {
            _instance = this;
            CampaignMenu.Instance = campaignMenu;
            factionRepState = new Dictionary<ShipFaction, FactionStatus>();
            //this makes sure this doesnt get corrupt
            generateShipDataBlock.shipSave_default = GenerateShipDataBlock.CopyOverShipDataBlock(generateShipDataBlock.defaultShipPrefabONLY, true); // prefabs don't initialize current health.

            foreach (var f in factionReputationSettings.factionStatus)
            {
                factionRepState.Add(f.shipFaction, f.CopyFaction());
            }

            // get all possible locations
            allLocations = FindObjectsOfType<Celestial>().Where(p => p.gameObject.activeInHierarchy).ToList();
            allPlanets = new Dictionary<string, Planet>();
            foreach (var loc in allLocations)
            {
                if (loc is Planet)
                {
                    allPlanets.Add(loc.guid, (Planet)loc);
                }
            }

            mapsTable = new Dictionary<EncounterType, EncounterMaps>();
            foreach (var m in mapsList)
            {
                if (!mapsTable.ContainsKey(m.encounterType))
                {
                    mapsTable.Add(m.encounterType, m);
                }
            }

            // check if data exists first.
            campaignSaveFile = CampaignSaveSystem.Load();
            if (campaignSaveFile == null)
            {
                playerFleet = new List<ShipSave>() { generateShipDataBlock.shipSave_default };
                // generate initial save file using defaults (TBD)
                SaveData();
            }
            LoadData();


        }

        public void GainRewards()
        {

        }

        // Start is called before the first frame update
        void Start()
        {
            //solarSystems = FindObjectsOfType<SolarSystem>();

            camController.transform.position = playerShip.atLocation.transform.position;
        }

        public void LoadData()
        {
            campaignSaveFile = saveLoadSystem.LoadGame(); // if possible?
            //var starsJson = new List<StarJson>();
            playerFleet = new List<ShipSave>();
            playerFleet.AddRange(campaignSaveFile.shipSave);
            credits = campaignSaveFile.credits;
            //fleetPanel.money.text = $"$ {credits}";

            Debug.Log($"Loaded ship at star {campaignSaveFile.currentStarId}," +
                $" planet {campaignSaveFile.currentPlanetId}");
            //List<string> federationTakeOverPlanets = new List<string>();

            // this needs to happen before planet data is updated.
            foreach (var p in campaignSaveFile.planetsDefeated)
            {
                allPlanets[p].battleGroups.RemoveAt(0); // remove first always. This will probably blow up, worry about later lol.

                if (allPlanets[p].battleGroups.Count == 0)
                {
                    allPlanets[p].factionControl = ShipFaction.Terran;// hehehe I took it over!
                }
            }

            playerShip.SetLocation(allLocations.FirstOrDefault(p =>
            {

                if (campaignSaveFile.currentPlanetId != "" && p.guid == campaignSaveFile.currentPlanetId)
                {
                    return true;
                }
                else if (p.guid == campaignSaveFile.currentStarId)
                {
                    return true;
                }
                else
                {
                    return false;
                }
            }));

            // I forgot that I should be populating this at runtime for reasons lol.
            foreach (var s in solarSystems)
            {
                var fedPLanetCount = s.planets.Count(p => p.factionControl == ShipFaction.Terran);
                if (fedPLanetCount == s.planets.Length)
                {
                    s.factionControl = ShipFaction.Terran;
                }

                s.SetupFaction(factionInfoLibrary, false);

                var starJ = new StarJson()
                {
                    name = s.LocationName,
                    id = s.guid,
                    planets = new List<PlanetJson>()

                };
                //starsJson.Add(starJ);
                foreach (var p in s.planets)
                {
                    starJ.planets.Add(new PlanetJson()
                    {
                        name = p.LocationName,
                        id = p.guid
                    });

                    if (p.hasStation)
                    {
                        var station = Instantiate(stationPrefab, p.stationPoint);
                        station.transform.localPosition = Vector3.zero;
                    }

                    p.SetupFaction(factionInfoLibrary, false);

                    foreach (var shipGroup in p.battleGroups)
                    {
                        var fleetIcon = Instantiate(shipMapIcon, null);
                        var faction = factionInfoLibrary.GetFactionInfo(shipGroup.faction);
                        fleetIcon.SetFleetData(shipGroup.ships.Count, faction);
                        var spot = p.EnterDockingSpot(fleetIcon.gameObject);
                        fleetIcon.transform.position = spot.position;
                    }

                }
            }
            stars = allLocations.Where(p => p is CampaignV2.SolarSystem).Select(p => p as CampaignV2.SolarSystem).ToList();
            starsJson = allLocations.ToStarsJson(stars);
            var starJsonText = JsonUtility.ToJson(new MapJson() { stars = starsJson });
            Debug.LogWarning("=========LOADING=========");
            Debug.LogWarning(starJsonText);
        }

        public void SaveData()
        {
            if (campaignSaveFile == null)
            {
                campaignSaveFile = new CampaignSaveFile();
                campaignSaveFile.currentStarId = defaultLocationId;
            }
            else
            {
                var pLoc = playerShip.atLocation;
                if (pLoc is SolarSystem)
                {
                    campaignSaveFile.currentStarId = pLoc.guid;
                    campaignSaveFile.currentPlanetId = "";
                }
                else if (pLoc is Planet)
                {
                    campaignSaveFile.currentPlanetId = pLoc.guid;
                    campaignSaveFile.currentStarId = ((Planet)pLoc).orbitingStar.guid;
                } // todo rocks and lagrange points?
            }

            if (campaignSaveFile.planetsDefeated == null)
            {
                campaignSaveFile.planetsDefeated = new List<string>();
            }

            saveLoadSystem.SaveGame(
             stars: solarSystems,
             credits: credits,
             playerFaction: playerFaction,
             playerFleet: playerFleet,
             factionRepState: factionRepState,
             campaignSaveFile: campaignSaveFile
             //,bool initial = false
             );
        }

        // Update is called once per frame
        void Update()
        {

        }

        public void MoveShip()
        {
            campaignMenu.dataInfo.travelButton.interactable = false;
            playerShip.MoveToNextStar();
        }

        public void TraveledToLocationReset()
        {
            campaignMenu.TraveledToLocationReset();

            // TODO: save game
        }

        public void StartMission() // todo select mission?
        {
            // todo select from map rotation.
            SaveData();


            var currentLocation = playerShip.atLocation;
            var mapEncounter = mapsTable[currentLocation.encounterType];
            encounterMissionLoader.SetupMission(mapEncounter, currentLocation, campaignSaveFile);

            //todo setup mission
            Debug.Log("start mission");
            campaignMenu.StartLoadingLevel();
        }

#if UNITY_EDITOR
        public void GenearteIds()
        {
            solarSystems = FindObjectsOfType<SolarSystem>().Where(s => s.gameObject.activeInHierarchy).ToArray();
            foreach (var s in solarSystems)
            {
                if (string.IsNullOrEmpty(s.guid))
                {
                    s.guid = GUID.Generate().ToString();
                    EditorUtility.SetDirty(s);
                    PrefabUtility.RecordPrefabInstancePropertyModifications(s);
                }
                s.InitializeFromUI(factionInfoLibrary);

                foreach (var p in s.planets)
                {
                    if (string.IsNullOrEmpty(p.guid))
                    {
                        p.guid = GUID.Generate().ToString();
                        EditorUtility.SetDirty(p);
                        PrefabUtility.RecordPrefabInstancePropertyModifications(p);
                    }

                    p.InitializeFromUI(factionInfoLibrary);
                }
            }

            if (string.IsNullOrEmpty(playerShip.guid))
            {
                playerShip.guid = GUID.Generate().ToString();
            }
        }

        public void GenerateDummyShips()
        {

            foreach (var s in solarSystems)
            {
                foreach (var p in s.planets)
                {
                    p.battleGroups = new List<BattleGroup>(){
                        new BattleGroup(){
                            battlegroupId = GUID.Generate().ToString(),
                            faction = p.factionControl,
                            ships = DefaultFleet.ships.Select(dShip=> new ShipMapInfo()
                            {
                                shipId = GUID.Generate().ToString(),
                                shipType = dShip.shipType,
                                shipVariant = dShip.shipVariant,
                                percentHealth = dShip.percentHealth
                            }).ToList()
                        }
                    };
                    EditorUtility.SetDirty(p);
                    PrefabUtility.RecordPrefabInstancePropertyModifications(p);
                }
            }
        }

        public void GenerateSaveData()
        {

            playerFleet = new List<ShipSave>() { generateShipDataBlock.shipSave_default };
            factionRepState = new Dictionary<ShipFaction, FactionStatus>();
            foreach (var f in factionReputationSettings.factionStatus)
            {
                factionRepState.Add(f.shipFaction, f.CopyFaction());
            }
            // generate initial save file using defaults (TBD)
            SaveData();
        }


#endif
        public EncounterType GetRandomEncounter()
        {
            int randomCount = mapsList.Count - 1;
            int random = UnityEngine.Random.Range(0, randomCount);

            return mapsList[random].encounterType;
        }
    }
}

[Serializable]
public class MapJson
{
    public List<StarJson> stars;
}
[Serializable]
public class StarJson
{
    public string name;
    public string id;

    public List<PlanetJson> planets;

}

[Serializable]
public class PlanetJson
{
    public string name;
    public string id;
}

[Serializable]
public class MissionParams
{
    public EncounterType encounterType;
    public string celestialId;

    public Celestial battleLocation;
}

[Serializable]
public class EncounterMaps
{
    public EncounterType encounterType;

    //public UnityScene maps;
    public List<SceneReference> scenes;

    public string MissionTitle;// we'll need to parametize this 
    public string missionDescription;
}


[Serializable]
public class MissionRewards
{
    public int credits = 0;
    // only destroyed ships drop loot
    // captured ships you can whole sell or strip for parts.

    public ShipUpgrade shipUpgrade;
}

public static class StarUtilities
{
    public static List<StarJson> ToStarsJson(this List<Celestial> celestials, List<CampaignV2.SolarSystem> stars)
    {

        var starsD = new Dictionary<string, StarJson>();

        foreach (var s in stars)
        {
            starsD.Add(s.guid, new StarJson()
            {
                id = s.guid,
                name = s.name,
                planets =  new List<PlanetJson>()
            });
        }
        
        foreach (var c in celestials)
        {
            if (c is Planet)
            {
                var p = (Planet)c;
                starsD[p.orbitingStar.guid].planets.Add(
                    new PlanetJson()
                    {
                        id = p.guid,
                        name = p.name
                    }
                );
            }
        }

        return starsD.Select(p=>p.Value).ToList();
    }
}