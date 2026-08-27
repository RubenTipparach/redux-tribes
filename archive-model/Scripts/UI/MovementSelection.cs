using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class MovementSelection : MonoBehaviour
{

    public Button FullStopButton; // slows down the ship to a stop.  
    public Button FullSpeedButton; // allows you to move double speed

    // todo: this will be limited to how much the ship can turn.
    public Button MoveAndTurnButton; // allows manuevers + rotation, the only way to change directions.
    public Button TurnSlideButton; // locks maneuvers, enables rotation.

    public Button ResetButton;

    public ButtonColorProperties colorSelected;

    private void OnEnable()
    {
        ResetButtonStatus();
    }

    public void ResetMoves(){
        var shipSelected = GameManager.Instance.shipSelected;

        if (shipSelected != null && shipSelected.isPlayerShip)
        {
            shipSelected.ResetMove();
        }
         ResetButtonStatus();

    }
    public void ResetButtonStatus(){
        var shipSelected = GameManager.Instance.shipSelected;

        // set defaults
        FullStopButton.interactable = false;
        FullSpeedButton.interactable = false;
        MoveAndTurnButton.interactable = false;
        TurnSlideButton.interactable = false;
        ResetButton.interactable = false;

        FullSpeedButton.GetComponent<Image>().color = colorSelected.unselectedColor;
        FullStopButton.GetComponent<Image>().color = colorSelected.unselectedColor;
        MoveAndTurnButton.GetComponent<Image>().color = colorSelected.unselectedColor;
        TurnSlideButton.GetComponent<Image>().color = colorSelected.unselectedColor;

        if (shipSelected != null && shipSelected.isPlayerShip)
        {
            MoveAndTurnButton.interactable = shipSelected.CanMoveAndTurn ? true : false;
            FullStopButton.interactable = shipSelected.CanFullStop ? true : false;
            TurnSlideButton.interactable = shipSelected.CanTurnSlide ? true : false;
            FullSpeedButton.interactable = shipSelected.CanFullSpeedBoost ? true : false;
            ResetButton.interactable = true;


            switch(shipSelected.shipMoveModes){
                case ShipMoveModes.FULL_SPEED:
                    FullSpeedButton.GetComponent<Image>().color = colorSelected.selectedColor;
                    break;
                case ShipMoveModes.FULL_STOP:
                    FullStopButton.GetComponent<Image>().color = colorSelected.selectedColor;
                    break;
                case ShipMoveModes.MOVE_AND_TURN:
                    MoveAndTurnButton.GetComponent<Image>().color = colorSelected.selectedColor;
                    break;
                case ShipMoveModes.TURN_SLIDE:
                    TurnSlideButton.GetComponent<Image>().color = colorSelected.selectedColor;
                    break;
                default:
                    break;
            }
        }

    }

    public void SelectMoveAndTurn()
    {
        GameManager.Instance.shipSelected.SelectMoveAndTurn();
        ResetButtonStatus();
    }

    public void SelectFullStop()
    {
        GameManager.Instance.shipSelected.SelectFullStop();
        ResetButtonStatus();
    }

    public void SelectTurnAndSlide()
    {
        GameManager.Instance.shipSelected.SelectTurnAndSlide();
        ResetButtonStatus();
    }

    public void SelectFullSpeedBoost()
    {
        GameManager.Instance.shipSelected.SelectFullSpeedBoost();
        ResetButtonStatus();
    }

}
