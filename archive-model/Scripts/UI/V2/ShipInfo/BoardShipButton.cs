using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class BoardShipButton : MonoBehaviour
{
    public int boardingReady = 0;
    public ShipController boardingFrom;
    public ShipController boardingTo;

    public const string BoardingReady = "Begin Boarding";
    public const string BoardingInProgress = "Boarding in Progress";
    public const string CancelBoarding = "Cancel Boarding"; // TODO cancel boarding lol

    void Start(){
        GetComponent<Button>().onClick.AddListener(()=>{
            BoardTarget();
        });
    }
    public void BoardTarget(){

        boardingFrom = GameManager.Instance.shipSelected;
        boardingTo = boardingFrom.Targeting;

        if (boardingFrom != null && boardingTo != null && boardingTo != boardingFrom)
        {
            int boardingParty = boardingFrom.BoardTarget();
            boardingReady = boardingParty;

            GameManager.Instance.uiManagerV2.targetInfoPanel.boardingButton.interactable = false;
        }
    }
}
