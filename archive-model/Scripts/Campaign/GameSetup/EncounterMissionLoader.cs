using System.Collections;
using System.Collections.Generic;
using DevLocker.Utils;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;
using System.Linq;
using Unity.VisualScripting;
using CampaignV2;


public enum EncounterType
{
    Skirmish = 0, //<-
    Freighter_Escort = 1,//<-
    Hit_And_Run = 2,
    Planetary_Assault = 3,
    Ship_Salvaging = 4, // maybe active or in active ships. <-
    Starbase_Assault = 5,
    
    Special = 90
}

public class EncounterMissionLoader : MonoBehaviour
{

    public List<ShipController> enemyShips;

    public List<ShipController> playerShips;

    public FactionInfo playerFaction; 
    public FactionInfo enemyFaction;

    public int attackingEnemyShipsQuantity = 1;
    public int playerShipsQuantity = 1;

    public static EncounterMissionLoader Instance;

    public SceneReference templateScene1;

    public CampaignSaveFile campaignSaveFile;

    bool canSave = true;
    public bool CanSave => canSave;
    public void Awake()
    {
        Instance = this;
        DontDestroyOnLoad(this.gameObject);
    }

    public void Start()
    {
    }

    public void SetupMission(StarItemUI star, CampaignSaveFile saveFile)
    {
        enemyShips = new List<ShipController>();
        playerShips = new List<ShipController>();

        campaignSaveFile = saveFile;
        // this mission is based on the current star system
        // TODO: will need to revisit this system so I can make missions more based on planets.

        playerFaction = CampaignMenu.Instance.myFaction;
        enemyFaction = star.controllingFaction;
        attackingEnemyShipsQuantity = star.garrisonStrength;// * 2;
        playerShipsQuantity = campaignSaveFile.shipSave.Length;
        canSave = true;

        // TODO: how does this relate to how many ships?
        // and... how does it affect the outcome and result from the outcome of this battle?

        // Finally after all that, load in the scene.
        SceneManager.LoadSceneAsync(templateScene1.ScenePath);
    }


    // V2 Map generator!
    public void SetupMission(EncounterMaps encounterMaps, Celestial location, CampaignSaveFile saveFile)
    {
        enemyShips = new List<ShipController>();
        playerShips = new List<ShipController>();

        campaignSaveFile = saveFile;
        // this mission is based on the current star system
        // TODO: will need to revisit this system so I can make missions more based on planets.

        playerFaction = CampaignMap.Instance.playerFaction;
        enemyFaction = CampaignMap.Instance.factionInfoLibrary.GetFactionInfo(location.factionControl);
        
        if (location.battleGroups.Count > 0)
        {
            attackingEnemyShipsQuantity = location.battleGroups.FirstOrDefault().ships.Count;//star.garrisonStrength;// * 2;

            playerShipsQuantity = campaignSaveFile.shipSave.Length;
            canSave = true;
            Debug.Log($"player ships {playerShipsQuantity} enemy ships {attackingEnemyShipsQuantity}");
            // TODO: how does this relate to how many ships?
            // and... how does it affect the outcome and result from the outcome of this battle?

            // Finally after all that, load in the scene.
            SceneManager.LoadSceneAsync(encounterMaps.scenes[0].ScenePath);
        }
        else
        {
            // no ships? don't do stuff? idk...
            attackingEnemyShipsQuantity = 0;
        }
    }

    public void SetupMissionFromRaw()
    {
        enemyShips = new List<ShipController>();
        playerShips = new List<ShipController>();

        campaignSaveFile = new CampaignSaveFile();

        //SaveGame(true);
        Debug.Log("no campaign detected, so I made a new one");

        // this mission is based on the current star system
        // TODO: will need to revisit this system so I can make missions more based on planets.

        playerFaction = CampaignMenu.Instance.myFaction;
        //enemyFaction = star.controllingFaction;
        //attackingEnemyShipsQuantity = star.garrisonStrength;// * 2;
        //playerShipsQuantity = campaignSaveFile.shipSave.Length;
        // TODO: how does this relate to how many ships?
        // and... how does it affect the outcome and result from the outcome of this battle?

        canSave = false;

        // Finally after all that, load in the scene.
        SceneManager.LoadSceneAsync(templateScene1.ScenePath);
    }

    public void OnMapLoadCompleted()
    {
        // this function switches context into the GameManager now.
        var spawner = GameManager.Instance.gameSpawnPoints;

        for (int i = 0; i < playerShipsQuantity; i++)
        {

            var tParams = spawner.GetNextOffset(i, player: true);
            // find the ship based on their home faction
            var faction = GameManager.Instance.factionInfoLibrary.GetFactionInfo(campaignSaveFile.shipSave[i].originalFaction);
            var ship = faction.allShips.AsEnumerable().Single(p => p.id == campaignSaveFile.shipSave[i].shipId);
            var loadedShip = campaignSaveFile.shipSave[i];
            var newShip = Instantiate(ship.shipSpawner, tParams.position, tParams.rotation);
            newShip.LoadShipDamage(loadedShip);
            // Todo: Load in ship state.
            playerShips.Add(newShip);
            newShip.isPlayerShip = true;

        }

        for (int i = 0; i < attackingEnemyShipsQuantity; i++)
        {
            var tParams = spawner.GetNextOffset(i, player: false);
            enemyShips.Add(Instantiate(enemyFaction.defaultShip.shipSpawner, tParams.position, tParams.rotation));
        }
        
        Debug.Log($"LOADED: player ships {playerShipsQuantity} enemy ships {attackingEnemyShipsQuantity}");

    }

    public void GoBackToCampaignMenu(){
        enemyShips = new List<ShipController>();
        playerShips = new List<ShipController>();
    }
}
