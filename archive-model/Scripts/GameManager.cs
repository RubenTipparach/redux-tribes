using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.EventSystems;

public class GameManager : MonoBehaviour
{
    
    private static GameManager gm;

    public List<ITimedSimulator> simulators = new List<ITimedSimulator>();
    List<ITimedSimulator> removeSims;

    public List<ITimedSimulator> aiSimulators = new List<ITimedSimulator>();

    public ShipController shipSelected;
    public ShipController enemyShipSelected;

    private static GameInput gameInput = null;
    public NavMove navController;
    public OrbitShipCamera cameraController;
    public CubeController cubeController;
    public List<ShipController> ships;

    public SimulationController simulationController;

    public UIController uiController;
    public UIManagerV2 uiManagerV2;

    public float masterTime = 0;

    public int currentTurnNumber = 0;

    public float selectedTime = 0;


    public bool showShipTarget = false;

    public bool showWeaponTarget = false;

    public bool showShipTrajectories = false;

    public MusicManager musicManager;

    public TutorialMenu tutorialMenu;

    public bool GameIsOver = false;

    public MissionGoalProcessor missionGoals;

    public GameSave gameSave = new GameSave();

    public ShipPrefabLibrary shipPrefabLibrary;
    public FactionInfoLibrary factionInfoLibrary;

    public EncounterMissionLoader encounterMissionLoader;

    public GameSpawnPoints gameSpawnPoints;

    public bool runInCampaignMode;

    public MissionSaveLoadHelper missionSaveLoadHelper;

    public string currentStarId = "";
    public string currentPlanetId = "";

    public void SetShipTargetVisible(bool val)
    {
        showShipTarget = val;
    }

    public void SetWeaponTargetVisible(bool val){
        showWeaponTarget = val;
    }

    public void ShowAllShipTrajectories(bool val) {
        showShipTrajectories = val;
    }

    public int playerCount = 0;
    public int enemyCount = 0;

    public int nextLevelIndex = 0;

    public ShipFaction playerFaction = ShipFaction.Terran;// worry about changing this later.
    public ShipFaction enemyFaction = ShipFaction.None;
    public float gameSpeed = 1;

    public int Money;

    public int moneyPerShipDestroyed = 125;
    public int shipsDestroyed = 0;

    public static GameManager Instance
    {
        get
        {
            return gm;
        }
    }


    public static GameInput GameInput
    {
        get
        {
            return gameInput;
        }
    }

    public void UpdateNavCursor()
    {
        if (shipSelected != null)
        {
            navController.SetNewTurn(shipSelected);
        }
    }


    public void SelectShip(ShipController ship, bool shiftHeld,
        bool targetFromUICard = false,
        bool targetOnly = false)
    {
        if (!targetOnly)
        {
            Debug.Log("setting target with center camera");
            cubeController.SetFollowObj(ship.transform);
        }
        
        //cameraController.distance = cameraController.distanceMin * 2; // maybe define this using ship controller props
        if (shipSelected != null && ship.isPlayerShip)
        {
            shipSelected.shipUiCard.ClearSelection();
            uiController.ClearEnemyCardSelect();
            shipSelected.EnableEstimator(show: false, navController);

        }

        if(enemyShipSelected != null )
        {
            enemyShipSelected.EnableEstimator(false, navController);
        }

        gm.navController.gameObject.SetActive(true);

        // we should not take control away from player.
        if (ship.isPlayerShip)
        {
            shipSelected = ship;

            navController.controllingShip = ship;
            shipSelected.EnableEstimator(show: true, navController);

            navController.SetNewTurn(shipSelected);
            uiController.Select(ship);

            ship.shipUiCard.SetSelected();

            ship.Targeting?.shipUiCard.SetSelected();

            //uiController.interactionButtons.ConfirmMoveMode();
            //if (simulationController.SimulationState != SimulationState.Simulating)
            //{
                // if (!ship.confirmedMove)
                // {
                //     uiController.interactionButtons.EnterMoveMode();
                // } else {
                //     uiController.interactionButtons.ConfirmMoveMode();
                // }
            //}

        }
        // show subsystems
        else//(shiftHeld && !ship.isPlayerShip)
        {
            //shipSelected.EnableEstimator(true, navController);

            if (targetFromUICard)
            {
                uiController.ClearEnemyCardSelect();
         
                ship.shipUiCard.SetSelected();
                shipSelected?.SetTarget(ship);
                uiController.DisplayEnemySusbsytems();
            }
            else
            {
                navController.controllingShip = ship;
                ship.EnableEstimator(true, navController);
                uiController.Select(ship);
            }

            uiController.EnemySelected();
            enemyShipSelected = ship;
        }

        // Handle V2 stuff
        uiManagerV2?.SelectShip(ship);
    }
    
    public void DeselectCurrentSpaceship(){
        shipSelected?.EnableEstimator(false, navController);
        shipSelected?.shipUiCard.ClearSelection();

        shipSelected = null;
        cubeController.SetFollowObj(null);
        navController.controllingShip = null;

        uiManagerV2?.DeselectShip();
        
    }

    //internal Ship selectedShip;
    //public List<Ship> allShips;
    private void Awake()
    {
        gm = this;
        gameInput = new GameInput();

        simulators = new List<ITimedSimulator>();
        removeSims = new List<ITimedSimulator>();

        ships = new List<ShipController>();

        aiSimulators = new List<ITimedSimulator>();

        if (missionGoals == null)
        {
            missionGoals = FindObjectOfType<MissionGoalProcessor>();
        }

        runInCampaignMode = EncounterMissionLoader.Instance != null;
        //gameSave.LoadGame(); everything will be wrapped in the campaign save/load file.
        if (runInCampaignMode)
        {
            encounterMissionLoader = EncounterMissionLoader.Instance;
            if (encounterMissionLoader == null)
            {

                encounterMissionLoader = gameObject.AddComponent(typeof(EncounterMissionLoader)) as EncounterMissionLoader;
                encounterMissionLoader.SetupMissionFromRaw();
                Debug.Log("adding backup mission loader.");
            }
            encounterMissionLoader.OnMapLoadCompleted();

            var cSave = encounterMissionLoader.campaignSaveFile;
            currentStarId = cSave.currentStarId;
            currentPlanetId = cSave.currentPlanetId;
        }
        else
        {
            // run backup testing mode.
            var missionDefaults = missionGoals;
            var playerShips = missionGoals.playerShips;
            var enemyShips = missionGoals.enemyShips;
            if (gameSpawnPoints != null)
            {
                enemyFaction = gameSpawnPoints.defaultShipFaction;

                for (int i = 0; i < playerShips.Length; i++)
                {
                    var pSpawn = gameSpawnPoints.GetNextOffset(i, player: true);
                    Instantiate(playerShips[i], pSpawn.position, pSpawn.rotation);
                }

                for (int i = 0; i < enemyShips.Length; i++)
                {
                    // Instantiate(p, gameSpawnPoints.playerSpawnPoints[0]);
                    var eSpawn = gameSpawnPoints.GetNextOffset(i, player: false);
                    Instantiate(enemyShips[i], eSpawn.position, eSpawn.rotation);
                }
            }
        }

        missionGoals.InitializeMissions();

    }


    public void MarkAttack()
    {
        // todo also tell ship where its going to attack with what weapon?
        uiController.MarkkAttack(shipSelected);
    }

    public void SnapRotationToTarget(){
        if(shipSelected!= null && shipSelected.isPlayerShip && shipSelected.Targeting !=null
            && (shipSelected.shipMoveModes == ShipMoveModes.MOVE_AND_TURN || shipSelected.shipMoveModes == ShipMoveModes.TURN_SLIDE)
            )// TODO support subsystems. (maybe the next project is to fight a ship bigger than you!)
        {
            var direction = SnapRotationToTarget(shipSelected);
            navController.SetRotation(direction);
        }
        
    }

    public void SetSpeedScale(float speedScale)
    {
        gameSpeed = speedScale;
    }

    public Vector3 SnapRotationToTarget(ShipController ship)
    {
        var cursorTimeline = GameManager.Instance.selectedTime/10f;
        // var estimatedCursorPosition = ship.positionUpdate.GetPointOnRouteBeforeSim(
        //             ship.transform.position,
        //             ship.navOverlay.shipNavPreview.transform.position,
        //             cursorTimeline);
        var estimatedCursorPosition = ship.shipMovementEstimator.transform.position;
        var targetPosition = ship.Targeting.shipMovementEstimator.transform.position;

        //Debug.DrawLine(estimatedCursorPosition, targetPosition, Color.red, 10f);
        Vector3 direction = (targetPosition - estimatedCursorPosition).normalized;

        ship.shipMovementEstimator.transform.rotation = Quaternion.LookRotation(direction, ship.shipMovementEstimator.transform.up);
        ship.CommitRotation();
        return direction;
    }

    public void DisengageFromTarget(bool clearWeaponQueues = false){
        if(shipSelected!= null && shipSelected.isPlayerShip && simulationController.SimulationState != SimulationState.Simulating) 
        {
            shipSelected.ClearTargets(clearWeaponQueues);
            //uiController.UpdateAttackQueueUI(shipSelected.attackOrders); // todo display weapons on ship based on weapons currently active.
        }
    }

    public void AddSimulator(ITimedSimulator simulator)
    {
        simulator.OnStartSim();

        simulators.Add(simulator); //ships seem to add themselves?

        if(simulator is ShipController) {
            var shippy = simulator as ShipController;
            ships.Add(shippy);
            if(shippy.isPlayerShip)
            {
                playerCount++;
            }
            else{
                enemyCount++;
            }
        }
    }

    public void RemoveSimulator(ITimedSimulator simulator)
    {
        simulator.OnStopSim();


        if (simulator is ShipController)
        {
            removeSims.Add(simulator as ShipController);
        }
        else
        {

            removeSims.Add(simulator);
        }
    }


    // Start is called before the first frame update
    void Start()
    {
       // StartCoroutine(delayedLoading());
    }

    // IEnumerator delayedLoading(){
    //     yield return new WaitForNextFrameUnit();
    //     encounterMissionLoader.OnMapLoadCompleted();

    // }

    // Update is called once per frame
    void Update()
    {
        gameInput.UpdateInput();

        if(Input.GetKeyDown(KeyCode.Escape) && !GameIsOver)
        {
            if(tutorialMenu.inTutorialMode)
            {
                tutorialMenu.StartGame();

            }else{
                tutorialMenu.BringUpTutorialMenu();
            }
        }
    }

    public void EndTurn()
    {
        simulationController.StartSimulation();
        uiController.OnEndTurn();
        uiManagerV2?.EndTurn();

        if(shipSelected != null && shipSelected.isPlayerShip && !shipSelected.ConfirmedMove)
        {
            shipSelected.ConfirmMoveMode(navController);
        }

        uiController.EnterSimulation();
        masterTime += 10;

        //  Debug this

        // Debug.Log("cleaning up objects: " + removeSims.Count);  
        foreach (var remove in removeSims)
        {
            simulators.Remove(remove);
            remove.DestroySim();
        }

        removeSims.Clear();
    }

    public void OnTurnStart()
    {
        uiController.OnStartTurn();
        uiManagerV2?.StartTurn();

        if (shipSelected != null && shipSelected.isPlayerShip)
        {
            //shipSelected.EnterMoveMode(navController);
            SelectShip(shipSelected, false);
            //Debug.Log("enter move mode for selected ship.");
        }

        if (missionGoals.CheckMissionsCompleted())
        {
            Debug.Log("How did win? " + nextLevelIndex);

            tutorialMenu.Win();
            gameSave.levelsCompleted = Mathf.Max(gameSave.levelsCompleted, nextLevelIndex);
            if (runInCampaignMode)
            {
                var cSave = encounterMissionLoader.campaignSaveFile;


                //int minGarrison = Mathf.Max(1, cSave.findPlanetById(cSave.currentStarId).garrisonStr - 1);

                //cSave.findPlanetById(cSave.currentStarId).garrisonStr = minGarrison;
                cSave.planetsDefeated.Add(cSave.currentPlanetId);

                SaveGame();
            }
            else
            {
                //gameSave.SaveGame(); // dont save?
            }
        }
        
        // mission fail not properly working lol.
        if(missionGoals.CheckMissionFailed())
        {
            tutorialMenu.Loose();
        }

    }

    public void RemoveShip(ShipController shipController)
    {
        if(shipController.isPlayerShip)
        {
            playerCount--;
        }else{
            enemyCount--;
            shipsDestroyed++;
        }

    }

    public void ZoomToShip(ShipController ship)
    {
        cubeController.SetFollowObj(ship.transform);
    }

    private void SaveGame()
    {
        Money =  missionGoals.missionList.Select(p => p.FullMissionAward).Sum() + moneyPerShipDestroyed * shipsDestroyed;
        encounterMissionLoader.campaignSaveFile.credits += Money;
        tutorialMenu.SetCreditsAward(Money, encounterMissionLoader.campaignSaveFile.credits);
        MissionSaveLoadHelper.SaveShips(playerShips: ships.Where(p => p.isPlayerShip).ToList(), encounterMissionLoader.campaignSaveFile);
        CampaignSaveSystem.Save(encounterMissionLoader.campaignSaveFile);
    }
}

