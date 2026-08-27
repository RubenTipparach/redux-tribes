using System;
using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.UI;

public class UIManagerV2 : MonoBehaviour
{
    public WeaponsPanel weaponsPanel;
    public TimeSliderController timeSliderController;
    public ShipControlsPanel shipControlsPanel;
    public SpeedControls speedControls;

    // TOOD: organize this crap?
    public Button endTurnButton;

    public PlayerInfoPanel playerInfoPanel;
    public TargetInfoPanel targetInfoPanel;

    public InfoBox infoBox;

    public ShipListPanel playerShipListPanel;
    public ShipListPanel enemyShipListPanel;

    [Header("PREFAB Templates")]
    public SubsystemHealthUI subsystemHealthUIPrefab;
    public ShipHealthUI templatShipHealthUI;

    [Header("UI Element Parents")]
    public GameObject subsystemHealthUIHolder;

    public List<SubsystemHealthUI> selectedSubsystemHealthUIs;
    public float healthSliderYOffset = 10;

    public AnimationCurve subsystemVisibility;

    public Transform anchoredWeaponSelection;
    public Transform anchoredPlayerSubsystemSelection;
    public Transform anchoredTargetSubsystemSelection;

    private void Start() {
        shipControlsPanel.gameObject.SetActive(false);
        infoBox.gameObject.SetActive(false);


        selectedSubsystemHealthUIs = new List<SubsystemHealthUI>();
    }

    void Update()
    {
        shipControlsPanel.CheckControls();
        weaponsPanel.CheckControls();
        speedControls.CheckControls();
    }

    void FixedUpdate()
    {
        foreach (var ship in GameManager.Instance.ships)
        {
            if (ship.gameObject.activeInHierarchy && !ship.Destroyed)
            {
                DisplayShipHealth(ship);
            }
        }
    }

    public void ShowInfoBox(string message){
        infoBox.gameObject.SetActive(true);
        infoBox.SetText(message);
    }
    
    public void HideInfoBox() {
        infoBox.gameObject.SetActive(false);
    }

    public void SelectShip(ShipController ship)
    {
        weaponsPanel.SetWeapons(ship);
        // update weapon button states.

        if (ship.isPlayerShip)
        {
            shipControlsPanel.gameObject.SetActive(true);
            if (GameManager.Instance.simulationController.SimulationState != SimulationState.Simulating)
            {
                //shipControlsPanel.SetMoveMenu();

                if (!ship.ConfirmedMove)
                {
                    EnterMovementMode();
                    shipControlsPanel.SetMoveMenu(false);
                }
                else
                {
                    //shipControlsPanel.SetWeaponsMenu();
                    //interactionButtons.PlayerShipSelected();
                    //ConfirmMoveMode();
                    shipControlsPanel.SetMoveMenu(true);
                }
            }

            playerInfoPanel.SetPlayer(ship);

            if(ship.Targeting!=null)
            {
                SetPlayerTargetShip(ship.Targeting, ship.targettingSubsystem);
            }else{
                targetInfoPanel.Deselect();
            }
        }
        else
        {
            shipControlsPanel.gameObject.SetActive(false);
        }
        Debug.Log("Selecting ship........ " + ship.gameObject.name);
        DisplayShipSubsystems(ship, ref selectedSubsystemHealthUIs);
    }

    public void SetPlayerTargetShip(ShipController ship,  ShipSubsystem targetSubsystem = null){
        targetInfoPanel.SetTarget(ship, targetSubsystem); // todo... add subsystem
    }

    public void DeselectShip()
    {
        var selectedShip = GameManager.Instance.shipSelected;
        playerInfoPanel.Deselect();

    }

    public void EndTurn(){
        //shipControlsPanel.gameObject.SetActive(false);
        ConfirmMoveMode();
        endTurnButton.interactable = false;
        timeSliderController.handle.interactable = false;
    }

    public void StartTurn(){
        //shipControlsPanel.gameObject.SetActive(false);
        endTurnButton.interactable = true;
        timeSliderController.handle.interactable = true;
        ResetTimeline();
        targetInfoPanel.OnStartTurn();
    }

    public void UpdateUIStatus(ShipController ship){
        weaponsPanel.UpdateDisplayShipWeapons(ship);
    }

    public void EnterMovementMode(){

        //interactionButtons.EnterMoveMode();
        var nav = GameManager.Instance.navController;
        GameManager.Instance.shipSelected.EnterMoveMode(nav);
    }

    public void ConfirmMoveMode(){
        //interactionButtons.ConfirmMoveMode();
        var nav = GameManager.Instance.navController;
        if(GameManager.Instance.shipSelected == null)
        {
            return;
        }
        
        GameManager.Instance.shipSelected.ConfirmMoveMode(nav);
    }

    public void UpdateTurnProgress(float progress)
    {
        timeSliderController.mainSlider.value = progress;
        UpdateDistanceIndicator();
    }

    public void UpdateDistanceIndicator()
    {
        var shipSelected = GameManager.Instance.shipSelected;
        if (shipSelected != null && shipSelected.Targeting != null && !shipSelected.Targeting.Destroyed)
        {
            targetInfoPanel.distanceTracker.text = shipSelected.GetDisantceToTarget.ToString("0.00") + " km";
        }
        else
        {
            targetInfoPanel.distanceTracker.text = "-";
        }
    }

    public void ResetTimeline(){
        timeSliderController.SetTime(0);
        timeSliderController.SetTime(timeSliderController.handle.value);
    }

     private void DisplayShipSubsystems(ShipController shipController, ref List<SubsystemHealthUI> healthUI)
    {
        if (healthUI != null)
        {
            CleanupHealthUIs(healthUI);
        }
        healthUI = new List<SubsystemHealthUI>(shipController.AllSubsystems.Length);

        //Debug.Log("subsystems selected " + shipController.shipSubsystems.Length);
        for (int j = 0; j < shipController.AllSubsystems.Length; j++)
        {
            var sub = Instantiate(subsystemHealthUIPrefab, subsystemHealthUIHolder.transform);
            sub.AssignSubsystem(shipController, shipController.AllSubsystems[j]);

            healthUI.Add(sub);

            //Debug.Log("added " + shipController.shipSubsystems[j].transform.name);
        }
    }

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


    private void UpdateSubsystems(ShipController ship, List<SubsystemHealthUI> healthUIs, Camera camera, bool isShipVisible)
    {
        //Debug.Log("updating health uis " + healthUIs.Count);
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

                            var zoomRatio = GameManager.Instance.cameraController.ZoomRatio;
                            var alphaHealthBar = subsystemVisibility.Evaluate(zoomRatio);
                            sub.canvasGroup.alpha = alphaHealthBar;

                            Vector2 subSysScreenPosition = GetScreenPosition(sub.shipSubsystem.targetLocation.position, 5, camera);

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

                Vector2 screenPosition = GetScreenPosition(ship.transform.position + Vector3.up * healthSliderYOffset, 0, camera);

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

            }
        }
    }

    public Vector2 GetScreenPosition(Vector3 objectPosition, float sliderY, Camera cam)
    {
        RectTransform CanvasRect = GetComponent<RectTransform>();

        Vector2 viewportPosition = cam.WorldToViewportPoint(objectPosition);
        return new Vector2(
        ((viewportPosition.x * CanvasRect.sizeDelta.x) - (CanvasRect.sizeDelta.x * 0.5f)),
        ((viewportPosition.y * CanvasRect.sizeDelta.y) - (CanvasRect.sizeDelta.y * 0.5f)))
                + new Vector2(0, sliderY);

    }


    public Vector2 GetScreenPosition(Vector3 objectPosition, float sliderY)
    {
        RectTransform CanvasRect = GetComponent<RectTransform>();
        var camera = GameManager.Instance.cameraController.mainCamera;

        Vector2 viewportPosition = camera.WorldToViewportPoint(objectPosition);
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
}

