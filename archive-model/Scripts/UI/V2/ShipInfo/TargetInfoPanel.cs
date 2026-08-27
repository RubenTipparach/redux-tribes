using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class TargetInfoPanel : MonoBehaviour
{

    public ShipInfo targetShipInfo;
    public List<SubsystemButton> subsystems;

    public Button boardingButton;
    public TextMeshProUGUI distanceTracker;

    public SubsystemButton templateButton;
    public ShipController shipController;

    public Transform subsystemListPanel;

    public Image shipImage;
    
    void Start(){
        gameObject.SetActive(false);
        subsystems = new List<SubsystemButton>();
    }

    public void OnStartTurn()
    {
        CheckIfCanBoard();
    }

    private void CheckIfCanBoard(){
        var shipSelected = GameManager.Instance.shipSelected;

        // ship selected UI state updates.
        if (shipSelected != null && shipSelected.isPlayerShip)
        {
            if (shipSelected.CanBoardTarget())
            {
                boardingButton.interactable = true;
                Debug.Log("Can board target");
            }
            else
            {
                boardingButton.interactable = false;
                Debug.Log("Can NOT board target");
            }
        }
    }

    public void SetTarget(ShipController ship, ShipSubsystem targetSubsystem)
    {
        shipController = ship;
        targetShipInfo.SetShipButton(ship);
        gameObject.SetActive(true);
        //boardingButton.interactable = false;// we'll need to check distance to determine if it is valid.
        SetTargetSubsystems();
        CheckIfCanBoard();
        shipImage.sprite = ship.shipCardData.shipSprite;
        shipImage.color = ship.shipCardData.factionColor;
    }

    public void Deselect()
    {
        gameObject.SetActive(false);
    }
    

    public void ClearSubsystemSelection()
    {
        for (int i = subsystems.Count - 1; i >= 0; i--)
        {
            subsystems[i].SetButtonSelected(false);
        }
    }

    /// <summary>
    /// This is the UI buttons that you shoot at.
    /// </summary>
    public void SetTargetSubsystems()
    {

        for (int i = subsystems.Count - 1; i >= 0; i--)
        {
            Destroy(subsystems[i].gameObject);
        }
        subsystems.Clear();

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

            var subsystem = Instantiate(templateButton, subsystemListPanel);
            subsystem.AssignSubsystemUI(system, GameManager.Instance.shipSelected, false);
            subsystems.Add(subsystem);
            if (GameManager.Instance.shipSelected.targettingSubsystem == system)
            {
                subsystem.SetButtonSelected(true);
            }
        }
        // create main hull...

        var mainHull = Instantiate(templateButton, subsystemListPanel);
        mainHull.AssignSubsystemUI(null, GameManager.Instance.shipSelected, false);
        subsystems.Add(mainHull);
        if (GameManager.Instance.shipSelected.targettingSubsystem == null)
        {
            mainHull.SetButtonSelected(true);
        }
    }

}
