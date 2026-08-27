using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Unity.VisualScripting;
using UnityEngine;

public class CampaignMenu : MonoBehaviour
{

    public static CampaignMenu Instance
    {
        get
        {
            if (_instance != null)
            {
                return _instance;
            }
            else
            {

                var gm = FindObjectOfType<CampaignMenu>(); // should only be one in existance

                return gm;
            }
        }
        set
        {
            _instance = value;
        }
    }

    private static CampaignMenu _instance;

    public ICampaignPanel selectedPanel;

    public NavigationV2 navigationPanel;
    public FleetPanel fleetPanel;
    public CrewPanel crewPanel;
    public DiplomacyPanel diplomacyPanel;
    public StarportPanel starportPanel;
    public InventoryPanel inventoryPanel;
    public MissionPanel missionPanel;
    public COptionsPanel cOptionsPanel;

    public GameObject main_panel;

    public FactionInfo myFaction;

    public FactionInfoLibrary factionInfoLibrary;

    public FactionReputation factionReputationSettings;
    public Dictionary<ShipFaction, FactionStatus> factionRepState;

    public WarningPanelMessages warningPanelMessages;

    public WarningPanel warningPanel;

    public EncounterMissionLoader encounterMissionLoader;

    List<ShipSave> myShips;

    public List<ShipSave> MyShips => myShips;

    //public CampaignSaveFile SaveFile => campaignSaveFile;
    CampaignSaveFile campaignSaveFile;

    public GenerateShipDataBlock generateShipDataBlock;

    public int credits = 1000;
    public string CurrentStarId => currentStarId;
    private string currentStarId = "";

    public DataInfo dataInfo;

    public FloatingPlanetMenu floatingPlanetMenu;

    public GameObject loadingScreen;

    public void StartLoadingLevel()
    {
        loadingScreen.SetActive(true);
    }

    public void ClosePanel()
    {
        main_panel.SetActive(false);
        CloseAll();
    }

    private void Awake()
    {


        factionRepState = new Dictionary<ShipFaction, FactionStatus>();

        foreach (var f in factionReputationSettings.factionStatus)
        {
            factionRepState.Add(f.shipFaction, f.CopyFaction());
        }
        // just initializing it the lazy way
        warningPanelMessages.GetWarning(WarningType.PLAYER_SHIP_DESTROYED);

        //myShips = new List<ShipSave>(); // load this in later.
        campaignSaveFile = new CampaignSaveFile();

        LoadGame(); // if possible?
    }

    public void TriggerWarning(WarningType warningType)
    {
        var wr = warningPanelMessages.GetWarning(warningType);
        warningPanel.SetWarning(wr);
        warningPanel.gameObject.SetActive(true);
    }

    public void StartBattle()
    {
        SaveGame();
        //encounterMissionLoader.SetupMission(navigationPanel.starmapShip.selectedStar, campaignSaveFile);
        //todo setup mission
        Debug.Log("starting mission!");
    }

    // Start is called before the first frame update
    void Start()
    {

        CloseAll();
        SetNavigationWindow();
    }

    public void CloseAll()
    {
        //navigationPanel?.Close();
        fleetPanel?.Close();
        crewPanel?.Close();
        diplomacyPanel?.Close();
        starportPanel?.Close();
        inventoryPanel?.Close();
        missionPanel?.Close();
        cOptionsPanel?.Close();

        main_panel?.SetActive(false);
    }

    // Update is called once per frame
    void Update()
    {

    }

    public bool UpdateMoney(int cost)
    {
        if (credits >= cost)
        {
            credits -= cost;
            fleetPanel.money.text = $"$ {credits}";
            return true;
        }
        else
        {
            return false;
        }
    }

    public void SaveGame(bool initial = false)
    {
        var stars = FindObjectsByType<CampaignV2.SolarSystem>(FindObjectsSortMode.InstanceID);

        campaignSaveFile.credits = credits;
        campaignSaveFile.shipFaction = myFaction.shipFaction;
        fleetPanel.money.text = $"$ {credits}";

        // stars status
        campaignSaveFile.starSaveData = stars.Select(p =>
            new StarSaveData()
            {
                //todo need starId
                starId = p.guid,
                controllingFaction = p.factionControl,
                //garrisonStr = p.garrisonStrength,
                planetSaveData = p.planets.Select(q =>
                    new PlanetSaveData
                    {
                        planetId = q.guid,
                        // garrisonFleet = new GarrisonFleet
                        // {
                        //     Gunships = q.garrisonFleet.Gunships,
                        //     Frigates = q.garrisonFleet.Frigates,
                        //     Destroyers = q.garrisonFleet.Destroyers,
                        //     BattleShips = q.garrisonFleet.BattleShips,
                        // },
                        controllingFaction = q.factionControl,
                        hasStation = q.hasStation,
                        //hasGarrison = q.hasGarrison,
                        visited = q.visited,
                        planetType = q.planetType,
                        surfaceType = q.surfaceType,
                        atmosphereType = q.atmosphereType
                    }).ToArray()

            }
        ).ToArray();

        // ships status
        if (initial)
        {
            campaignSaveFile.shipSave = new ShipSave[] { generateShipDataBlock.shipSave_default };
            Debug.Log("initial save file!");
            myShips = campaignSaveFile.shipSave.ToList();
        }
        else
        {
            campaignSaveFile.shipSave = myShips.ToArray();
            Debug.Log("continuing save file!");
        }

        //campaignSaveFile.currentStarId = navigationPanel.starmapShip.selectedStar.ID;// todo replace with name
        
        // reputation status
        campaignSaveFile.reputationSave = factionRepState.Select(p => new ReputationSave()
        {
            shipFaction = p.Key,
            reputationScore = p.Value.factionScore
        }).ToArray();
        var shipString = string.Join(',', campaignSaveFile.shipSave.Select(p =>
            JsonUtility.ToJson(p)));
        Debug.Log($"Save game - logging ship status: {shipString}");

        CampaignSaveSystem.Save(campaignSaveFile); // todo update this!
    }

    public void LoadGame()
    {
        Debug.Log($"Saving.. {CampaignSaveSystem.savePath}");
        campaignSaveFile = CampaignSaveSystem.Load();
        if (campaignSaveFile == null)
        {
            campaignSaveFile = new CampaignSaveFile();
            //currentStarId = navigationPanel.starmapShip.selectedStar.ID;
            SaveGame(true);

            Debug.Log("no campaign detected, so I made a new one");


        }
        else
        {
            //campaignSaveFile = new CampaignSaveFile();
            // being populating stuff.
            var shipString = string.Join(',', campaignSaveFile.shipSave.Select(p =>
                JsonUtility.ToJson(p)));
            Debug.Log($"Load Game - Campaign save file found!  {shipString}");

            myShips = new List<ShipSave>();
            myShips.AddRange(campaignSaveFile.shipSave);
            credits = campaignSaveFile.credits;
            fleetPanel.money.text = $"$ {credits}";
            currentStarId = campaignSaveFile.currentStarId;

        }

        // delay the start so ui elements can be setup
        StartCoroutine(DelayedStarLoad());

    }

    IEnumerator DelayedStarLoad()
    {
        yield return new WaitForEndOfFrame();
        //navigationPanel.starmapShip.SetCurrentStar(currentStarId);

        // foreach (var loadedStar in campaignSaveFile.starSaveData)
        // {
        //     navigationPanel.findStarById(loadedStar.starId).SetGarrisonStr(loadedStar.garrisonStr);
        // }

    }

    public void ResetCampaignSave()
    {
        CampaignSaveSystem.DeleteSaveFile();
    }

    public void SetNavigationWindow()
    {
        CloseAll();
        //selectedPanel = navigationPanel.Open();
    }

    public void SetFleetWindow()
    {
        CloseAll();
        if (selectedPanel != fleetPanel as ICampaignPanel)
        {
            main_panel.SetActive(true);
            selectedPanel = fleetPanel.Open();
        }
    }

    public void SetCrewWindow()
    {
        selectedPanel?.Close();

        if (selectedPanel != crewPanel as ICampaignPanel)
        {
            main_panel.SetActive(true);
            selectedPanel = crewPanel.Open();
        }
    }

    public void SetDiplomacyWindow()
    {
        CloseAll();
        if (selectedPanel != diplomacyPanel as ICampaignPanel)
        {
            main_panel.SetActive(true);
            selectedPanel = diplomacyPanel.Open();
        }
    }

    public void SetStarportWindow()
    {
        CloseAll();
        selectedPanel = starportPanel.Open();
        if (selectedPanel == starportPanel as ICampaignPanel)
        {
            main_panel.SetActive(true);
            selectedPanel = starportPanel.Open();
        }
    }

    public void SetInventoryWindow()
    {
        CloseAll();
        if (selectedPanel != inventoryPanel as ICampaignPanel)
        {
            main_panel.SetActive(true);
            selectedPanel = inventoryPanel.Open();
        }
    }

    public void SetMissionWindow()
    {
        CloseAll();
        if (selectedPanel != missionPanel as ICampaignPanel)
        {
            main_panel.SetActive(true);
            selectedPanel = missionPanel.Open();
        }
    }

    public void SetOptionsWindow()
    {
        CloseAll();
        if (selectedPanel != cOptionsPanel as ICampaignPanel)
        {
            main_panel.SetActive(true);
            selectedPanel = cOptionsPanel.Open();
        }
    }

    public void SetObjectSelection(GameObject selectedObject)
    {
        if (selectedObject != null)
        {
            if (selectedObject.GetComponent<CampaignV2.Planet>() != null)
            {
                var planet = selectedObject.GetComponent<CampaignV2.Planet>();
                dataInfo.SetSelection(planet.planetName);
            }
        }
        else
        {
            dataInfo.SetSelection(null);
        }
    }


    public void SetObjectSelectedLocation(Celestial location, bool canTravel)
    {
        if (location != null)
        {
            if (location.Type == CelestialType.Planet)
            {
                var planet = location as CampaignV2.Planet;
                dataInfo.SetTravelToSelection(planet, canTravel);
            }

            if (location.Type == CelestialType.Star)
            {
                var star = location as CampaignV2.SolarSystem;
                dataInfo.SetTravelToSelectionStar(star, canTravel);
            }
        }
        else
        {
            dataInfo.SetTravelToSelection(null, false);
        }
    }

    public void TraveledToLocationReset()
    {
        dataInfo.travelButton.interactable = false;
        dataInfo.SetSelection(null);
        dataInfo.SetTravelToSelection(null);
        dataInfo.UpdateShipLocation(false);
    }
}