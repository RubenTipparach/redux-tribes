using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class NavButtons : MonoBehaviour
{

    public Button boostButton;
    public Button slideButton;
    public Button moveButton;
    public Button stopButton;
    public Button snapRotationToButton;
    public Button resetButton;

    public Sprite boost_u;
    public Sprite boost_s;
    public Sprite boost_g;

    public Sprite slide_u;
    public Sprite slide_s;
    public Sprite slide_g;

    public Sprite move_u;
    public Sprite move_s;
    public Sprite move_g;

    public Sprite stop_u;
    public Sprite stop_s;
    public Sprite stop_g;

    public Sprite snap_rotate_n;
    public Sprite snap_rotate_g;

    public void Setup()
    {
        //movement state machines
        boostButton.onClick.AddListener(() =>
        {
            SelectFullSpeedBoost();
        });

        slideButton.onClick.AddListener(() =>
        {
            SelectTurnAndSlide();
        });

        moveButton.onClick.AddListener(() =>
        {
            SelectMoveAndTurn();
        });

        stopButton.onClick.AddListener(() =>
        {
            SelectFullStop();
        });

        resetButton.onClick.AddListener(() =>
        {
            ResetMoves();
        });

        // special
        snapRotationToButton.onClick.AddListener(() =>
        {
            GameManager.Instance.SnapRotationToTarget();
        });
    }

    // public Button stopButton; // slows down the ship to a stop.  
    // public Button boostButton; // allows you to move double speed

    // todo: this will be limited to how much the ship can turn.
    // public Button moveButton; // allows manuevers + rotation, the only way to change directions.
    // public Button slideButton; // locks maneuvers, enables rotation.


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
        stopButton.interactable = false;
        boostButton.interactable = false;
        moveButton.interactable = false;
        slideButton.interactable = false;
        resetButton.interactable = false;

        boostButton.image.sprite = boost_s;
        stopButton.image.sprite = stop_s;
        moveButton.image.sprite = move_s;
        slideButton.image.sprite = slide_s;

        snapRotationToButton.image.sprite = snap_rotate_n;

        if (shipSelected != null && shipSelected.isPlayerShip)
        {
            if(shipSelected.CanMoveAndTurn)
            {
                moveButton.interactable = true;
                moveButton.image.sprite = move_s;
            } else {
                moveButton.interactable = false;
                moveButton.image.sprite = move_g;
            }

            if (shipSelected.CanFullStop)
            {
                stopButton.interactable = true;
                stopButton.image.sprite = stop_s;
            }
            else
            {
                stopButton.interactable = false;
                stopButton.image.sprite = stop_g;
            }


            if (shipSelected.CanTurnSlide)
            {
                slideButton.interactable = true;
                slideButton.image.sprite = slide_s;

            }
            else {
                slideButton.interactable = false;
                slideButton.image.sprite = slide_g;
            }


            if(shipSelected.CanFullSpeedBoost)
            {
                boostButton.interactable = true;
                boostButton.image.sprite = boost_s;
            }
            else
            {
                boostButton.interactable = false;
                boostButton.image.sprite = boost_g;
            }


            resetButton.interactable = true;


            switch(shipSelected.shipMoveModes){
                case ShipMoveModes.FULL_SPEED:
                    boostButton.image.sprite = boost_u;
                    snapRotationToButton.interactable = false;
                    snapRotationToButton.image.sprite = snap_rotate_g;
                    break;
                case ShipMoveModes.FULL_STOP:
                    stopButton.image.sprite = stop_u;
                    snapRotationToButton.interactable = false;
                    snapRotationToButton.image.sprite = snap_rotate_g;
                    break;
                case ShipMoveModes.MOVE_AND_TURN:
                    moveButton.image.sprite = move_u;
                    snapRotationToButton.interactable = true;
                    break;
                case ShipMoveModes.TURN_SLIDE:
                    slideButton.image.sprite = slide_u;
                    snapRotationToButton.interactable = true;
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
