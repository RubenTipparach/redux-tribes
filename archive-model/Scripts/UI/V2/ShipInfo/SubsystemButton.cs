using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class SubsystemButton : MonoBehaviour
{

    
    public ShipSubsystem subsystem;

    public ShipController ship;

    //UIController parentUI;

    public TextMeshProUGUI textUI;

    public Slider healthSlider;

    //public ButtonColorProperties colorProperties;

    public Button button;

    public Sprite buttonImage_unselected;
    public Sprite buttonImage_selected;

    public bool IsPlayer => isPlayer;

    public bool IsSelected => isSelected;

    [SerializeField]
    private bool isPlayer = false;

    [SerializeField]
    private bool isSelected = false;

    public InfoSubsystemButton infoSubsystemButton;

    public void AssignSubsystemUI(ShipSubsystem shipSubsystem, ShipController origin, bool isPlayerButton)
    {
        subsystem = shipSubsystem;
        ship = origin;
        //parentUI = uIController;
        isPlayer = isPlayerButton;
        infoSubsystemButton.subsystem = this;

        UpdateSubsystemData();
        if (subsystem != null) // this can be main hull if its null.
        {
            subsystem.onSubsystemHit = UpdateSubsystemData; // todo add more events?
        }

        button.onClick.AddListener(() =>
        {
            if (isPlayer)
            {
                GameManager.Instance.uiManagerV2.playerInfoPanel.ClearSubsystemSelection(this);
                GameManager.Instance.shipSelected.SetSubsystemRepairPriority(shipSubsystem);
            }else{
                // TODO fix a bug here, its doing something wonky.
                GameManager.Instance.uiManagerV2.targetInfoPanel.ClearSubsystemSelection();
                GameManager.Instance.shipSelected.SetSubsystemTarget(shipSubsystem);
            }

            SelectSubsystem();

        });


    }

    public void UpdateSubsystemData(){

        if (subsystem != null)
        {
            textUI.text = subsystem.SubsystemName;
            healthSlider.value = subsystem.HealthPercent;

            Debug.Log("updated subsystem info");
        }
        else
        {
            textUI.text = "Main Hull";
            healthSlider.value = ship.shipHealth.Percent;
        }
    }

    public void SelectSubsystem()
    {

        if (!ship.isPlayerShip)
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
        }

        //GameManager.Instance.UIManagerV2?.ClearSubsystemSelection();
        if(isSelected)
        {
            SetButtonSelected(false);
        } else {
            SetButtonSelected(true);
        }
    }

    public void SetButtonSelected(bool selected)
    {
        //var bColor = button.colors;

        if (selected)
        {
            button.image.sprite = buttonImage_selected;
            
        }
        else
        {
            button.image.sprite = buttonImage_unselected;
        }

        isSelected = selected;
        Debug.Log("selected = " + selected);
    }
}
