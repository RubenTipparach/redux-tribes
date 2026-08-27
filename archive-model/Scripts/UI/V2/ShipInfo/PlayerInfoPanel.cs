using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PlayerInfoPanel : MonoBehaviour
{

    public ShipInfo targetShipInfo;
    public List<SubsystemButton> subsystems;

    public SubsystemButton templateButton;
    public ShipController shipController;

    public Transform subsystemListPanel;

    void Start()
    {
        gameObject.SetActive(false);
        subsystems = new List<SubsystemButton>();
    }

    public void SetPlayer(ShipController ship)
    {
        gameObject.SetActive(true);
        shipController = ship;

        targetShipInfo.SetShipButton(ship);

        InitiateSubsystems();
    }

    public void Deselect()
    {
        gameObject.SetActive(false);
    }

    public void ClearSubsystemSelection(SubsystemButton exceptButton)
    {
        for (int i = subsystems.Count - 1; i >= 0; i--)
        {
            if (exceptButton != subsystems[i])
            {
                subsystems[i].SetButtonSelected(false);
            }
        }
    }


    private void DeleteSubsystems()
    {
        for (int i = subsystems.Count - 1; i >= 0; i--)
        {
            Destroy(subsystems[i].gameObject);
        }
        subsystems.Clear();
    }

    public void InitiateSubsystems(){
        DeleteSubsystems();
        var selectedShip = GameManager.Instance.shipSelected;
        if(selectedShip == null)
        {
            return;
        }


        foreach (var system in selectedShip.AllSubsystems)
        {
            // Add in weapon controllers.

            var subsystem = Instantiate(templateButton, subsystemListPanel);
            subsystem.AssignSubsystemUI(system, GameManager.Instance.shipSelected, true);
            subsystems.Add(subsystem);
            if (GameManager.Instance.shipSelected.targettingSubsystem == system)
            {
                subsystem.SetButtonSelected(true);
            }
        }
        // create main hull...

        var mainHull = Instantiate(templateButton, subsystemListPanel);
        mainHull.AssignSubsystemUI(null, GameManager.Instance.shipSelected, true);
        subsystems.Add(mainHull);
        if (GameManager.Instance.shipSelected.targettingSubsystem == null)
        {
            //mainHull.SetButtonSelected(true);
        }
    }
}
