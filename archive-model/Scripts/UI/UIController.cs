using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.VirtualTexturing;
using UnityEngine.UI;

public class UIController : MonoBehaviour
{

    public GameObject TutorialMenu;
    [Header("Command Queue")]
    public Button endTurnButton;

    public Slider timerSlider;
    public Slider stepSlider;
    public List<ActionQueueUI> queueUI;
    public WeaponControllerUI weaponControllerUIPrefab;
    public ShipController shipControllerSelected;
    public GameObject noTargetSign;
    public float healthSliderYOffset = 10;

    [Header("UI Element Parents")]
    public GameObject targetSubsystems;
    public GameObject playerSubsystems;
    public GameObject subsystemHealthUIHolder;
    public Transform shipWeaponVerticalLayout;

    [Header("PREFABS")]
    public SubsystemUI subsystemUIPrefab;
    public SubsystemHealthUI subsystemHealthUIPrefab;
    public ShipHealthUI templatShipHealthUI;

    [Header("Togglables")]
    public Toggle weaponTargets;
    public Toggle shipTargets;
    public Toggle shipManuevers;
    public List<SubsystemHealthUI> selectedSubsystemHealthUIs;

    public List<SubsystemHealthUI> targettedSubsystemHealthUIs;

    public List<WeaponControllerUI> weaponControllersUI = new List<WeaponControllerUI>();
    public List<SubsystemUI> selectedSubsystemsUi = new List<SubsystemUI>();
    public List<SubsystemUI> targetSubsystemsUi = new List<SubsystemUI>();

    [Header("ShipCards")]
    public GameObject enemyShipCardsPanel;
    public GameObject playerShipCardsPanel;
    public ShipCard playerShipCard;
    public ShipCard enemyShipCard;
    public List<ShipCard> playerShipCards;
    public List<ShipCard> enemyShipCards;

    public GameObject elementsHolder;

    public InteractionButtons interactionButtons;

    public TextMeshProUGUI distanceIndicatorText;

    public Button boardingButton;

    public TextMeshProUGUI missionText;

    public MovementSelection movementSelection;

    public void SelectShipMovementMode(ShipMoveModes shipMoveModes)
    {
        var selectedShip = GameManager.Instance.shipSelected;
        if( selectedShip != null && selectedShip.isPlayerShip)
        {

        }
    }

    public void GenerateMissionText(){
        missionText.text = GameManager.Instance.missionGoals.GetMissionText();

    }

    public void ClearSubsystemSelection()
    {
        for (int i = targetSubsystemsUi.Count - 1; i >= 0; i--)
        {
            targetSubsystemsUi[i].SetButtonSelected(false);
        }
    }

    public void UpdateWeaponSelection(ShipController ship, int queueSecond)
    {
        //var weaponQueue = ship.QueueWeaponAttack

        for (int i = 0; i < weaponControllersUI.Count; i++)
        {

            var attackOrder =
                weaponControllersUI[i].controller.attackInfoOrder;
            if (attackOrder != null && attackOrder.secondSlot == queueSecond)
            {
                weaponControllersUI[i].SetButtonSelected(true);
            }
            else
            {
                weaponControllersUI[i].SetButtonSelected(false);
            }
        }
    }

    public void Select(ShipController ship)
    {
        shipControllerSelected = ship;

        // cleear weapons and generate new stuff.
        if (ship.isPlayerShip)
        {
            if(!ship.ConfirmedMove)
            {
                if (GameManager.Instance.simulationController.SimulationState != SimulationState.Simulating)
                {
                    EnterMovementMode();
                }

            }else{
                interactionButtons.PlayerShipSelected();
            }

            for (int i = weaponControllersUI.Count - 1; i >= 0; i--)
            {
                Destroy(weaponControllersUI[i].gameObject);
            }

            weaponControllersUI.Clear();
            foreach (var weapon in ship.weapons)
            {
                var weaponUI = Instantiate(weaponControllerUIPrefab, shipWeaponVerticalLayout);
                weaponUI.AssignWeaponUI(weapon, ship, this);

                //Debug.Log($"ship weapons {weapon.gameObject.name}");
                weaponControllersUI.Add(weaponUI);
            }

            UpdateDisplayShipWeapons(ship);

            UpdateAttackQueueUI(ship.attackOrders);

            // I think this diplays targetted ship subsystems on the screen? should only be availible for players


            for (int i = selectedSubsystemsUi.Count - 1; i >= 0; i--)
            {
                Destroy(selectedSubsystemsUi[i].gameObject);
            }

            //SetTargetSubsystems();
        }
        else
        {
            //DisplayShipSubsystems(ship, ref targettedSubsystemHealthUIs);
        }

        //if(GameManager.Instance.shipSelected == ship)
        //{
        Debug.Log("displaying subsystems for ship (populate) " + ship.transform.name);
        //DisplayShipSubsystems(ship, ref selectedSubsystemHealthUIs);
        //}

        movementSelection.ResetButtonStatus();
        //TODO need a weapons queueing system to repair weapons.

        // generate target subsystem stuff.
        // if (ship.isPlayerShip)
        // {
        // }
        // else
        // {
        // }

    }


    public void DisplayEnemySusbsytems()
    {
        //SetTargetSubsystems();
    }

    // /// <summary>
    // /// This is for the little UI pieces that hover over the ships.
    // /// </summary>
    // /// <param name="shipController"></param>
    // /// <param name="healthUI"></param>
    // private void DisplayShipSubsystems(ShipController shipController, ref List<SubsystemHealthUI> healthUI)
    // {
    //     if (healthUI != null)
    //     {
    //         CleanupHealthUIs(healthUI);
    //     }
    //     healthUI = new List<SubsystemHealthUI>(shipController.AllSubsystems.Length);

    //     //Debug.Log("subsystems selected " + shipController.shipSubsystems.Length);
    //     for (int j = 0; j < shipController.AllSubsystems.Length; j++)
    //     {
    //         var sub = Instantiate(subsystemHealthUIPrefab, subsystemHealthUIHolder.transform);
    //         sub.AssignSubsystem(shipController, shipController.AllSubsystems[j]);

    //         healthUI.Add(sub);

    //         //Debug.Log("added " + shipController.shipSubsystems[j].transform.name);
    //     }
    // }

    private void CleanupHealthUIs(List<SubsystemHealthUI> healthUI)
    {
        for (int i = healthUI.Count - 1; i >= 0; i--)
        {
            var cleanup = healthUI[i];
            if (!cleanup.IsDestroyed())
            {
                Destroy(cleanup.gameObject);
                healthUI.Remove(cleanup);
            }
        }

        healthUI.Clear();
    }

    /// <summary>
    /// This is the UI buttons that you shoot at.
    /// </summary>
    public void SetTargetSubsystems()
    {

        for (int i = targetSubsystemsUi.Count - 1; i >= 0; i--)
        {
            Destroy(targetSubsystemsUi[i].gameObject);
        }
        targetSubsystemsUi.Clear();

        var selectedShip = GameManager.Instance.shipSelected;
        if(selectedShip == null)
        {
            return;
        }

        var ship = selectedShip.Targeting;

        if (ship == null) { return; }

        foreach (var system in ship.AllSubsystems)
        {
            // Add in weapon controllers.

            var subsystem = Instantiate(subsystemUIPrefab, targetSubsystems.transform);
            subsystem.AssignSubsystemUI(system, GameManager.Instance.shipSelected, this);
            targetSubsystemsUi.Add(subsystem);
            if (GameManager.Instance.shipSelected.targettingSubsystem == system)
            {
                subsystem.SetButtonSelected(true);
            }
        }
        // create main hull...

        var mainHull = Instantiate(subsystemUIPrefab, targetSubsystems.transform);
        mainHull.AssignSubsystemUI(null, GameManager.Instance.shipSelected, this);
        targetSubsystemsUi.Add(mainHull);
        if (GameManager.Instance.shipSelected.targettingSubsystem == null)
        {
            mainHull.SetButtonSelected(true);
        }
    }



    public void UpdateDisplayShipWeapons(ShipController ship)
    {
        var transformChildren = shipWeaponVerticalLayout.childCount;

        if (ship.Targeting == null)
        {
            //noTargetSign.SetActive(true);
            for (int i = transformChildren - 1; i >= 0; i--)
            {
                if (shipWeaponVerticalLayout.GetChild(i).gameObject != noTargetSign)
                {
                    shipWeaponVerticalLayout.GetChild(i).gameObject.SetActive(false);
                }
            }
        }
        else
        {
            //noTargetSign.SetActive(false);

            for (int i = transformChildren - 1; i >= 0; i--)
            {
                if (shipWeaponVerticalLayout.GetChild(i).gameObject != noTargetSign)
                {
                    shipWeaponVerticalLayout.GetChild(i).gameObject.SetActive(true);
                }
            }
        }
    }

    void DisplayShipHealth(ShipController ship)
    {
        var camera = GameManager.Instance.cameraController.mainCamera;
        var isVisible = IsVisible(camera, ship.gameObject);
        if (ship.shipHealthUI != null && !ship.destroyed)
        {
            if (isVisible)
            {
                ship.shipHealthUI.gameObject.SetActive(true);

                RectTransform CanvasRect = GetComponent<RectTransform>();

                //then you calculate the position of the UI element
                //0,0 for the canvas is at the center of the screen, whereas WorldToViewPortPoint treats the lower left corner as 0,0. Because of this, you need to subtract the height / width of the canvas * 0.5 to get the correct position.

                Vector2 screenPosition = GetScreebPosition(ship.transform.position + Vector3.up * healthSliderYOffset, 0, camera);

                ((RectTransform)ship.shipHealthUI.healthSlider.transform).anchoredPosition = screenPosition;


            }
            else
            {
                ship.shipHealthUI.gameObject.SetActive(false);


            }

            //if (ship == GameManager.Instance.shipSelected )
            {
                //Debug.Log($"displaying subsystems for ship B {ship.transform.name} {isVisible}");

                UpdateSubsystems(ship, selectedSubsystemHealthUIs, camera, isVisible);

                //UpdateSubsystems(targettedSubsystemHealthUIs, camera, isVisible);
            }
        }
    }

    private void UpdateSubsystems(ShipController ship, List<SubsystemHealthUI> healthUIs, Camera camera, bool isShipVisible)
    {
        if (healthUIs != null && healthUIs.Count > 0)
        {
            // if(healthUIs[0].ship.shipHealth.IsDead)
            // {
            //     CleanupHealthUIs(healthUIs);
            // }
            if (healthUIs[0].IsDestroyed())
            {
                healthUIs.Clear();
            }
            else
            {
                foreach (var sub in healthUIs)
                {

                    if (ship == sub.ship)
                    {
                        if (isShipVisible)
                        {
                            sub.gameObject.SetActive(true);
                            Vector2 subSysScreenPosition = GetScreebPosition(sub.shipSubsystem.targetLocation.position, 5, camera);

                            ((RectTransform)sub.transform).anchoredPosition = subSysScreenPosition;

                        }
                        else
                        {
                            sub.gameObject.SetActive(false);
                        }
                    }
                }
            }
        }
    }

    public Vector2 GetScreebPosition(Vector3 objectPosition, float sliderY, Camera cam)
    {
        RectTransform CanvasRect = GetComponent<RectTransform>();

        Vector2 viewportPosition = cam.WorldToViewportPoint(objectPosition);
        return new Vector2(
        ((viewportPosition.x * CanvasRect.sizeDelta.x) - (CanvasRect.sizeDelta.x * 0.5f)),
        ((viewportPosition.y * CanvasRect.sizeDelta.y) - (CanvasRect.sizeDelta.y * 0.5f)))
                + new Vector2(0, sliderY);

    }

    private bool IsVisible(Camera c, GameObject target)
    {
        var planes = GeometryUtility.CalculateFrustumPlanes(c);
        var point = target.transform.position;

        foreach (var plane in planes)
        {
            if (plane.GetDistanceToPoint(point) < 0)
            {
                return false;
            }
        }
        return true;
    }

    public void MarkUI(int timeSelected)
    {
        queueUI[timeSelected].AttackMark();

        //Debug.Log
    }

    public void UpdateAttackQueueUI(
        Dictionary<int, List<AttackInformation>> attackQueue
        )
    {
        for (int i = 0; i < 11; i++)
        {
            queueUI[i].ClearUI();
            if (attackQueue.ContainsKey(i) && attackQueue[i].Count > 0)
            {
                queueUI[i].ActivateUI(attackQueue[i]);
            }

        }

        //LogWaponQueue(attackQueue);
    }

    public void LogWaponQueue(Dictionary<int, List<AttackInformation>> attackQueue)
    {
        string queueLog = "";
        for (int i = 0; i < 10; i++)
        {
            if (attackQueue.ContainsKey(i) && attackQueue[i].Count > 0)
            {
                queueLog += $" quueues {i} weapons {attackQueue[i].Count} | ";
            }
        }

        if (!string.IsNullOrWhiteSpace(queueLog)) Debug.Log(queueLog);
    }

    public void OnStartTurn()
    {
        endTurnButton.interactable = true;
        stepSlider.interactable = true;

        // ship selected UI state updates.
        if (ShipSelected != null && ShipSelected.isPlayerShip)
        {
            if (ShipSelected.CanBoardTarget())
            {
                boardingButton.interactable = true;
                //Debug.Log("Can board target");
            }
            else
            {
                boardingButton.interactable = false;
                //Debug.Log("Can NOT board target");
            }
        }
    }

    public void OnEndTurn()
    {
        endTurnButton.interactable = false;
        stepSlider.interactable = false;
    }

    public void UpdateTurnProgress(float progress)
    {
        timerSlider.value = progress;
        UpdateDistanceIndicator();
    }

    public void UpdateDistanceIndicator()
    {
        if (ShipSelected != null && ShipSelected.Targeting != null && !ShipSelected.Targeting.Destroyed)
        {
            distanceIndicatorText.text = ShipSelected.GetDisantceToTarget.ToString("0.00") + " km";
        }
        else
        {
            distanceIndicatorText.text = "-";
        }
    }

    public void PreviewTurnProgress(float progress)
    {
        timerSlider.value = progress;
        GameManager.Instance.selectedTime = progress;
        Debug.Log("time selected " + progress);

        foreach (var wep in weaponControllersUI)
        {
            if (timerSlider.value == 10)
            {
                wep.button.interactable = false;
            }
            else
            {
                wep.button.interactable = true;
            }
        }


        if (shipControllerSelected!= null && shipControllerSelected.isPlayerShip)
        {
            UpdateWeaponSelection(shipControllerSelected, Mathf.RoundToInt(progress));
        }

    }

    // Start is called before the first frame update
    void Start()
    {


        GameManager.Instance.showWeaponTarget = weaponTargets.isOn;
        GameManager.Instance.showShipTarget = shipTargets.isOn;
        GameManager.Instance.showShipTrajectories = shipManuevers.isOn;

        selectedSubsystemHealthUIs = new List<SubsystemHealthUI>();
        targettedSubsystemHealthUIs = new List<SubsystemHealthUI>();

        // playerShipCards = new List<ShipCard>();
        // enemyShipCards = new List<ShipCard>();


        foreach (var ship in GameManager.Instance.ships)
        {
            SetupShipUI(ship);

            Debug.Log("setting up ui for" + ship.gameObject.name);
        }

        TutorialMenu.SetActive(true);

        //interactionButtons.UIReset();
        GenerateMissionText();

        //GameManager.Instance.encounterMissionLoader.OnMapLoadCompleted();

        StartCoroutine(SelectInit());
    }

    IEnumerator SelectInit()
    {
        yield return new WaitForNextFrameUnit();
        if (playerShipCards != null && playerShipCards.Count > 0)
        {
            GameManager.Instance.SelectShip(playerShipCards[0].ship, false);
        }
    }

    public void SetupShipUI(ShipController ship) {
        if (!ship.uiInitialized)
        {
            var hSlider = Instantiate(templatShipHealthUI, elementsHolder.transform);
            ship.uiInitialized = true;
            ship.shipHealthUI = hSlider;
            ship.shipHealthUI.Initialize(ship.isPlayerShip, ship.gameObject.name);
            InitializeShipCards(ship);
        }
    }

    private void InitializeShipCards(ShipController ship)
    {

        if (ship.isPlayerShip)
        {
            var shipCard = Instantiate(playerShipCard, playerShipCardsPanel.transform);
            shipCard.AssignShip(ship);
            playerShipCards.Add(shipCard);
            shipCard.boardingPartyUI.UpdateAttackDefenseStatus(ship.marines, 0, ship.shipFaction);
        }
        else
        {
            var shipCard = Instantiate(enemyShipCard, enemyShipCardsPanel.transform);
            shipCard.AssignShip(ship);
            enemyShipCards.Add(shipCard);
            shipCard.boardingPartyUI.UpdateAttackDefenseStatus(ship.marines, 0, ship.shipFaction);
        }
    }

    // Update is called once per frame
    void Update()
    {
        // foreach (var ship in GameManager.Instance.ships)
        // {
        //     if (ship.gameObject.activeInHierarchy && !ship.Destroyed)
        //     {
        //         DisplayShipHealth(ship);
        //     }
        // }
    }

    public void OnTargetSelected(ShipController selectedTarget)
    {

    }

    // TODO: reuse this for queueing up multi attacks?
    public void MarkkAttack(ShipController shipSelected)
    {
        //if(shipSelected == null) return;

        //int timeSelected = Mathf.RoundToInt(GameManager.Instance.selectedTime);
        //queueUI[timeSelected].AttackMark();
        //shipSelected.QueueWeaponAttack(Mathf.RoundToInt(GameManager.Instance.selectedTime));
        // TODO repurpose this for all weapons.
    }

    public void ClearEnemyCardSelect()
    {
        foreach (var ship in enemyShipCards)
        {
            ship.ClearSelection();

        }
    }

    public void EnterMovementMode(){

        //interactionButtons.EnterMoveMode();
        var nav = GameManager.Instance.navController;
        GameManager.Instance.shipSelected.EnterMoveMode(nav);
    }

    public void ConfirmMoveMode(){
        //interactionButtons.ConfirmMoveMode();
        var nav = GameManager.Instance.navController;
        GameManager.Instance.shipSelected.ConfirmMoveMode(nav);
    }

    public void EnemySelected()
    {
        //interactionButtons.EnemySelected();
    }

    public void EnterSimulation(){
        //interactionButtons.EnterSimulation();
    }

    public void NextShip(){
        // todo all buttons should be invisible at start
        if(ShipSelected != null && ShipSelected.isPlayerShip)
        {
            int i = playerShipCards.IndexOf(ShipSelected.shipUiCard);
            i = (i + 1) % playerShipCards.Count;
            GameManager.Instance.SelectShip(playerShipCards[i].ship, false);
        }
    }

    public void PreviousShip(){
        if(ShipSelected != null && ShipSelected.isPlayerShip)
        {
            int i = playerShipCards.IndexOf(ShipSelected.shipUiCard);
            i = (i - 1) % playerShipCards.Count;
            if (i == -1) i = playerShipCards.Count - 1;
            GameManager.Instance.SelectShip(playerShipCards[i].ship, false);
        }
    }

    public void SwapEnemyToPlayer(ShipController shipController)
    {
        enemyShipCards.Remove(shipController.shipUiCard);

        playerShipCards.Add(shipController.shipUiCard);
        shipController.shipUiCard.transform.SetParent(playerShipCardsPanel.transform);
        shipController.shipHealthUI.Initialize(true, shipController.gameObject.name);
        shipController.shipHealthUI.healthSlider.value = shipController.shipHealth.Percent;
    }

    public ShipController ShipSelected => GameManager.Instance.shipSelected;


}


[Serializable]
public class InteractionButtons{
    public GameObject endTurn;

    public GameObject enterMove;
    public GameObject confirmMove;

    public GameObject Next;
    public GameObject Previous;

    // public GameObject shipCardsPlayer;
    // public GameObject shipCardsEnemny;

    public GameObject Weapons;
    public GameObject Subsystems;
    public GameObject EnemySubsystems;
    public GameObject Toggleables;


    public GameObject disengage;
    public GameObject rotateToTarget;

    public GameObject boardingButton;

    public GameObject distanceIndicator;

    public GameObject movementModes;

    // this should also be set on restart
    public void UIReset(){
        var active = false;

        confirmMove.SetActive(active);
        movementModes.SetActive(active);

       // endTurn.SetActive(active);
        enterMove.SetActive(active);
        // Next.SetActive(active);
        // Previous.SetActive(active);
        ///shipCardsPlayer.SetActive(active);
        //shipCardsEnemny.SetActive(active);
        Weapons.SetActive(active);
        Subsystems.SetActive(active);
        EnemySubsystems.SetActive(active);
       // Toggleables.SetActive(active);

        disengage.SetActive(active);
        rotateToTarget.SetActive(active);
        boardingButton.SetActive(active);
        //distanceIndicator.SetActive(active);
    }

    public void EnterMoveMode(){
        var active = false;

        confirmMove.SetActive(true);
        movementModes.SetActive(true);

        //endTurn.SetActive(active);
        enterMove.SetActive(active);
        // Next.SetActive(active);
        // Previous.SetActive(active);
        //shipCardsPlayer.SetActive(active);
        //shipCardsEnemny.SetActive(active);
        //Weapons.SetActive(active);
        //Subsystems.SetActive(active);
        EnemySubsystems.SetActive(active);
        //Toggleables.SetActive(active);
        Debug.Log("begin move");

        disengage.SetActive(true);
        rotateToTarget.SetActive(true);

        // boardingButton.SetActive(active);
        //distanceIndicator.SetActive(active);
    }


    public void EnterSimulation (){
        var active = false;

        confirmMove.SetActive(false);
        movementModes.SetActive(false);

        //endTurn.SetActive(active);
        enterMove.SetActive(active);

        // Next.SetActive(true);
        // Previous.SetActive(true);

        // shipCardsPlayer.SetActive(active);
        // shipCardsEnemny.SetActive(active);
        //Weapons.SetActive(active);
        //Subsystems.SetActive(active);
        EnemySubsystems.SetActive(active);
        //Toggleables.SetActive(active);
        //Debug.Log("begin move");

        disengage.SetActive(false);
        rotateToTarget.SetActive(false);

         boardingButton.SetActive(active);
        //distanceIndicator.SetActive(active);
    }

    public void PlayerShipSelected(){
        enterMove.SetActive(true);
    }

    public void EnemySelected(){
        var active = false;

        confirmMove.SetActive(active);
        movementModes.SetActive(active);

        enterMove.SetActive(active);
        // Next.SetActive(active);
        // Previous.SetActive(active);

        boardingButton.SetActive(active);
        //distanceIndicator.SetActive(active);
        /*
        Weapons.SetActive(active);
        Subsystems.SetActive(active);
        Toggleables.SetActive(active);
        */
    }

    public void ConfirmMoveMode(){
        var active = true;

        confirmMove.SetActive(false);
        movementModes.SetActive(false);

        //endTurn.SetActive(active);
        enterMove.SetActive(active);
        // Next.SetActive(active);
        // Previous.SetActive(active);
        // shipCardsPlayer.SetActive(active);
        // shipCardsEnemny.SetActive(active);
        Weapons.SetActive(active);
        Subsystems.SetActive(active);
        EnemySubsystems.SetActive(active);
        //Toggleables.SetActive(active);
        boardingButton.SetActive(active);
        // distanceIndicator.SetActive(active);

        disengage.SetActive(true);
        rotateToTarget.SetActive(true);

        Debug.Log("confirm move");
    }

}

public static class GameObjectExtensions
{
        /// <summary>
        /// Checks if a GameObject has been destroyed.
        /// </summary>
        /// <param name="gameObject">GameObject reference to check for destructedness</param>
        /// <returns>If the game object has been marked as destroyed by UnityEngine</returns>
        public static bool IsDestroyed(this GameObject gameObject)
        {
            // UnityEngine overloads the == opeator for the GameObject type
            // and returns null when the object has been destroyed, but
            // actually the object is still there but has not been cleaned up yet
            // if we test both we can determine if the object has been destroyed.
            return gameObject == null && !ReferenceEquals(gameObject, null);
        }
 }