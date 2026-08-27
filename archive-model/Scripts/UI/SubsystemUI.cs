using System;
using System.Collections;
using System.Collections.Generic;
using JetBrains.Annotations;
using TMPro;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.UI;

public class SubsystemUI : MonoBehaviour
{

    public ShipSubsystem subsystem;

    public ShipController ship;

    UIController parentUI;

    public TextMeshProUGUI textUI;

    public Slider healthSlider;

    public ButtonColorProperties colorProperties;

    public Button button;
    public Image buttonImage;

    public void AssignSubsystemUI(ShipSubsystem shipSubsystem, ShipController origin, UIController uIController)
    {
        subsystem = shipSubsystem;
        ship = origin;
        parentUI = uIController;

        if (shipSubsystem != null)
        {
            textUI.text = shipSubsystem.SubsystemName;
        }
        else
        {
            textUI.text = "Main Hull";

        }
    }

    public void SelectSubsystem()
    {
        if (subsystem != null /*&& GameManager.Instance.simulationController.SimulationState != SimulationState.Simulating*/)
        {
            Debug.Log((subsystem as MonoBehaviour).transform.name + " selected ");

            ship.targettingSubsystem = subsystem;
        }
        else
        {
            ship.targettingSubsystem = null;
        }

        GameManager.Instance.uiController.ClearSubsystemSelection();
        SetButtonSelected(true);
    }

    public void SetButtonSelected(bool selected)
    {
        var bColor = button.colors;

        if (selected)
        {
            buttonImage.color = colorProperties.selectedColor;
        }
        else
        {
            buttonImage.color = colorProperties.unselectedColor;
        }
    }

    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }

}
